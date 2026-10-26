/** The UI event stream: current state first, then changes, hub events, bounded streams, and clean teardown. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { HttpRoutesDeps } from "../src/server-http-state.js";
import { MAX_UI_STREAMS, streamUiEvents, uiEventsFor } from "../src/ui-events.js";
import { fieldOf, numberOf, parseJson, textOf } from "./http-json.js";
import { mutableSnapshot, pause } from "./sidecar-fixture.js";
import { openSse, raw, startUiSidecar, type SseClient } from "./ui-fixture.js";

const focus = (name: string) => ({ projectPath: null, projectName: name, epoch: null, revision: 1, activeCompositionId: "comp-1", activeCompositionName: "Main", selected: ["layer-1"], selectedLayers: [{ id: "layer-1", index: 1, name: "Original" }], receivedAt: Date.now() });

async function until(condition: () => boolean, label: string): Promise<void> {
  for (let waited = 0; waited < 300 && !condition(); waited += 1) await pause(10);
  assert.ok(condition(), label);
}

test("a stream starts from the current host, focus and change, with the SSE headers", async (t) => {
  const { port } = await startUiSidecar(t);
  const client = await openSse(port);
  t.after(() => client.close());
  assert.equal(client.status, 200);
  assert.equal(client.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(client.headers["cache-control"], "no-cache");
  assert.equal(client.headers.connection, "keep-alive");
  assert.equal(client.headers["x-accel-buffering"], "no");
  await client.waitFor((frame) => frame.event === "change");
  assert.ok(client.raw().startsWith("retry: 1000\n\n"));
  assert.deepEqual(client.frames.map((frame) => frame.event), ["host", "focus", "activity", "change"]);
  const [host, focusFrame, , change] = client.frames;
  assert.equal(textOf(host?.data, "host.state"), "offline");
  assert.deepEqual([fieldOf(host?.data, "hostInstanceId"), fieldOf(host?.data, "nativeAccessQuarantine"), fieldOf(host?.data, "type")], [null, null, undefined]);
  assert.deepEqual(focusFrame?.data, { focus: null });
  assert.deepEqual(change?.data, { seq: 1, reason: "state" });
});

test("a focus change and a notifyChange emit a focus event and a coalesced change", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const client = await openSse(port);
  t.after(() => client.close());
  await client.waitFor((frame) => frame.event === "change");
  sidecar.latest = { snapshot: mutableSnapshot("probe-events"), receivedAt: "2026-10-04T00:00:00.000Z", bytes: 1 };
  sidecar.liveFocus = focus("Fixture");
  for (let index = 0; index < 5; index += 1) sidecar.notifyChange();
  const changed = await client.waitFor((frame) => frame.event === "focus" && frame.data !== null && fieldOf(frame.data, "focus") !== null);
  assert.equal(textOf(changed.data, "focus.project"), "Fixture");
  assert.deepEqual(fieldOf(changed.data, "focus.layerNames"), ["Original"]);
  await pause(250);
  const changes = client.frames.filter((frame) => frame.event === "change");
  assert.ok(changes.length >= 2 && changes.length <= 3, `five wakes coalesce, saw ${changes.length}`);
  assert.equal(numberOf(changes.at(-1)?.data, "seq"), changes.length);
  const before = client.frames.length;
  sidecar.notifyChange();
  await client.waitFor((frame) => frame.event === "change" && numberOf(frame.data, "seq") === changes.length + 1);
  assert.equal(client.frames.slice(before).some((frame) => frame.event === "focus"), false, "an unchanged focus is not re-sent");
});

test("the host frame after a reserve is not blocked for the live apply, and is after the call is marked unknown", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const client = await openSse(port);
  t.after(() => client.close());
  await client.waitFor((frame) => frame.event === "change");
  sidecar.inFlight = { kind: "apply_plan", id: "plan-1", claimedAt: 0 };
  sidecar.nativeBridge.reserve("owner", { requestId: "req-1", kind: "mutation" }, { kind: "apply_plan", id: "plan-1" });
  sidecar.notifyChange();
  await client.waitFor((frame) => frame.event === "change" && numberOf(frame.data, "seq") === 2);
  assert.deepEqual(client.frames.filter((frame) => frame.event === "host").map((frame) => fieldOf(frame.data, "nativeAccessQuarantine")), [null], "no blocked host frame during a normal apply");
  sidecar.inFlight = { kind: "apply_plan", id: "plan-1", claimedAt: 0, nativeSettlement: "unknown", nativeErrorCode: "HOST_TIMEOUT", nativeAccessKind: "mutation" };
  sidecar.notifyChange();
  const blocked = await client.waitFor((frame) => frame.event === "host" && fieldOf(frame.data, "nativeAccessQuarantine") !== null);
  assert.equal(textOf(blocked.data, "nativeAccessQuarantine.state"), "unresolved");
});

test("events published on the hub reach the stream", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const client = await openSse(port);
  t.after(() => client.close());
  await client.waitFor((frame) => frame.event === "change");
  uiEventsFor(sidecar).publish({ type: "undo", planId: "plan-7", undo: { available: true, reason: null, steps: 2 } });
  uiEventsFor(sidecar).publish({ type: "thumbs", planId: "plan-7" });
  const undo = await client.waitFor((frame) => frame.event === "undo");
  assert.deepEqual(undo.data, { planId: "plan-7", undo: { available: true, reason: null, steps: 2 } });
  assert.deepEqual((await client.waitFor((frame) => frame.event === "thumbs")).data, { planId: "plan-7" });
});

test("a client that leaves leaves nothing behind", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const hub = uiEventsFor(sidecar);
  const resting = sidecar.changeWaiters.size;
  const client = await openSse(port);
  await client.waitFor((frame) => frame.event === "change");
  assert.equal(sidecar.changeWaiters.size, resting + 1);
  assert.equal(hub.subscriberCount(), 1);
  client.close();
  await until(() => sidecar.changeWaiters.size === resting && hub.subscriberCount() === 0 && hub.streams === 0, "stream cleaned up");
});

test("at most eight streams are open at once", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const clients: SseClient[] = [];
  for (let index = 0; index < MAX_UI_STREAMS; index += 1) clients.push(await openSse(port));
  t.after(() => { for (const client of clients) client.close(); });
  const ninth = await raw(port, { path: "/v1/ui/events", authorized: true });
  assert.equal(ninth.status, 429);
  assert.equal(textOf(parseJson(ninth.text), "error.code"), "UI_EVENTS_BUSY");
  clients[0]?.close();
  await until(() => uiEventsFor(sidecar).streams === MAX_UI_STREAMS - 1, "a slot is freed");
  const again = await openSse(port);
  t.after(() => again.close());
  assert.equal(again.status, 200);
});

test("the stream ends cleanly after its lifetime", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const deps: HttpRoutesDeps = { state: sidecar, dispatch: sidecar };
  const server = createServer((request, response) => streamUiEvents(deps, request, response, { lifetimeMs: 150 }));
  await new Promise<void>((listening) => { server.listen(0, "127.0.0.1", listening); });
  t.after(() => { server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const resting = sidecar.changeWaiters.size;
  const client = await openSse(address.port);
  await client.waitFor((frame) => frame.event === "change");
  await client.ended;
  assert.deepEqual(client.frames.map((frame) => frame.event).slice(0, 4), ["host", "focus", "activity", "change"]);
  assert.equal(sidecar.changeWaiters.size, resting);
  assert.equal(uiEventsFor(sidecar).subscriberCount(), 0);
  assert.equal(uiEventsFor(sidecar).streams, 0);
});

test("stopping the sidecar ends the stream", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const client = await openSse(port);
  await client.waitFor((frame) => frame.event === "change");
  await sidecar.stop();
  await client.ended;
  assert.equal(sidecar.changeWaiters.size, 0);
  assert.equal(uiEventsFor(sidecar).subscriberCount(), 0);
});
