/** Tests the host client's event link: the initial change event, framing and reconnects. */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { connectPlugin } from "@extynt/host-native";
import type { PluginEndpoint } from "@extynt/host-native";
import { hangUp, late, ok, stall } from "../src/index.js";
import { pause, rejectsWithCode, until, withRig } from "./rig.js";

test("the first event after connecting is a full initial change, and later events reach onEvent in order", async () => {
  await withRig(async ({ plugin, events }) => {
    await until(() => events.length === 1);
    assert.deepEqual(events[0]?.event === "change" && events[0].reason, ["initial"]);
    plugin.change({ revision: 101, selection: ["11"] });
    plugin.still();
    plugin.overflow(4);
    await until(() => events.length === 4);
    assert.deepEqual(events.map((event) => event.event), ["change", "change", "still", "overflow"]);
    const second = events[1];
    assert.deepEqual(second?.event === "change" && [second.reason, second.revision, second.selection], [["revision", "selection"], 101, ["11"]]);
  });
});

test("several events in one write and one event split across writes are all delivered", async () => {
  await withRig(async ({ plugin, events }) => {
    await until(() => events.length === 1);
    const still = (seq: number): string => `${JSON.stringify({ event: "still", seq, at: 1, epoch: 1, revision: 5 })}\n`;
    plugin.sendRaw(still(10) + still(11) + still(12));
    const text = still(13);
    await plugin.sendRawChunks([text.slice(0, 7), text.slice(7, 30), text.slice(30)]);
    await until(() => events.length === 5);
    assert.deepEqual(events.slice(1).map((event) => event.event === "still" && event.seq), [10, 11, 12, 13]);
  });
});

test("watch intervals are passed to the plugin", async () => {
  await withRig(async ({ plugin }) => {
    const request = plugin.requestsFor("watch")[0];
    assert.deepEqual([request?.body.intervalMs, request?.body.stillMs], [250, 2500]);
  }, { connect: { watch: { intervalMs: 250, stillMs: 2500 } } });
});

test("host-closing is delivered, loses the pending call as shutting-down, and closes the link with host-closing", async () => {
  await withRig(async ({ client, plugin, events, closes }) => {
    const pending = client.hostCall("aeApplyPlan", {});
    await until(() => plugin.requestsFor("host_call").length === 1);
    plugin.hostClosing();
    const outcome = await pending;
    assert.deepEqual(outcome.kind === "lost" && [outcome.reason, outcome.sent], ["shutting-down", true]);
    await until(() => closes.length > 0);
    await pause(150);
    assert.deepEqual(closes, ["host-closing"]);
    assert.equal(events.at(-1)?.event, "host-closing");
  }, { plugin: { hostCalls: { aeApplyPlan: () => stall() } } });
});

test("a dropped watch connection closes the link as a reset, once", async () => {
  await withRig(async ({ client, plugin, closes }) => {
    plugin.dropConnections("watchers");
    await until(() => closes.length > 0);
    await pause(150);
    assert.deepEqual(closes, ["reset"]);
    assert.equal((await client.request({ op: "ping" })).kind, "lost");
  });
});

test("a dropped command connection closes the link as a reset", async () => {
  await withRig(async ({ plugin, closes }) => {
    plugin.dropConnections("requesters");
    await until(() => closes.length > 0);
    assert.deepEqual(closes, ["reset"]);
  });
});

test("a call that makes the plugin hang up is lost closed", async () => {
  await withRig(async ({ client, closes }) => {
    const outcome = await client.request({ op: "ping" });
    assert.deepEqual(outcome.kind === "lost" && [outcome.reason, outcome.sent], ["closed", true]);
    await until(() => closes.length > 0);
  }, { plugin: { handlers: { ping: () => hangUp() } } });
});

test("garbage on the watch connection ends the link as a reset", async () => {
  await withRig(async ({ plugin, closes }) => {
    plugin.sendRaw("not json at all\n");
    await until(() => closes.length > 0);
    assert.deepEqual(closes, ["reset"]);
  });
});

test("close() reports closed-by-client once, fails pending calls as closed and stops further events", async () => {
  await withRig(async ({ client, plugin, events, closes }) => {
    const pending = client.request({ op: "ping" });
    await until(() => plugin.requestsFor("ping").length === 1);
    client.close();
    client.close();
    const outcome = await pending;
    assert.deepEqual(outcome.kind === "lost" && [outcome.reason, outcome.sent], ["closed", true]);
    assert.deepEqual(closes, ["closed-by-client"]);
    const seen = events.length;
    plugin.still();
    await pause(50);
    assert.equal(events.length, seen);
    await until(() => plugin.watcherCount === 0);
  }, { plugin: { handlers: { ping: () => late(500, ok({})) } } });
});

test("a wrong token is rejected at connect as UNAUTHORIZED", async () => {
  await withRig(async ({ plugin }) => {
    const endpoint: PluginEndpoint = { ...plugin.endpoint, token: "0".repeat(64) };
    await rejectsWithCode(connectPlugin({ endpoint, onEvent: () => undefined, onClose: () => undefined }), "UNAUTHORIZED");
  });
});

test("an out-of-range watch interval is refused at connect", async () => {
  await withRig(async ({ plugin }) => {
    const options = { endpoint: plugin.endpoint, watch: { intervalMs: 5 }, onEvent: () => undefined, onClose: () => undefined };
    await rejectsWithCode(connectPlugin(options), "WATCH_FAILED");
  });
});

test("connecting to a closed port fails with CONNECT_FAILED and reports no close", async () => {
  const probe = net.createServer();
  await new Promise<void>((resolve) => { probe.listen(0, "127.0.0.1", resolve); });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => { probe.close(() => resolve()); });
  const closes: string[] = [];
  const endpoint: PluginEndpoint = { path: "x", port, token: "t", pid: null, pluginVersion: null, aeVersion: null };
  await rejectsWithCode(connectPlugin({ endpoint, onEvent: () => undefined, onClose: (reason) => closes.push(reason) }), "CONNECT_FAILED");
  assert.deepEqual(closes, []);
});

test("createConnection supplies the sockets, one per connection", async () => {
  let made = 0;
  await withRig(async ({ plugin, closes }) => {
    const client = await connectPlugin({
      endpoint: plugin.endpoint, onEvent: () => undefined, onClose: (reason) => closes.push(reason),
      createConnection: (port) => { made += 1; return net.createConnection({ port, host: "127.0.0.1" }); },
    });
    assert.equal(made, 3);
    assert.equal((await client.request({ op: "ping" })).kind, "ok");
    client.close();
  });
});
