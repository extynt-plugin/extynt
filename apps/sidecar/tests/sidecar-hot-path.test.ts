/** The sidecar's hot path and its races: the native bridge lease cache, the byte figure, the host link, the leased call, the token compare, the pruned host facts. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { connectPlugin, isRecord } from "@extynt/host-native";
import type { CallOutcome, ConnectOptions, HostCallResult, PluginClient } from "@extynt/host-native";
import { startFakePlugin } from "@extynt/fake-plugin";
import { approximateBytes } from "../src/approximate-bytes.js";
import { leasedHostCall } from "../src/host/bridge-call.js";
import type { LeaseContext } from "../src/host/bridge-call.js";
import { newHostFacts, pruneHostFacts } from "../src/host/facts.js";
import { createHostLink } from "../src/host/link.js";
import type { ReceiverOutcome } from "../src/receiver-types.js";
import { layerHashIndex } from "../src/native-snapshot/index.js";
import { NativeBridgeLease } from "../src/native-bridge-lease.js";
import { bearerMatches } from "../src/server-http-state.js";
import { makeLayer, omit, readSetOf, withHashes } from "./native-fixtures.js";
import { sidecarForPlugin, token } from "./sidecar-fixture.js";

test("a journal another process rewrote is seen at once, and an unchanged one is not read again", () => {
  const directory = mkdtempSync(join(tmpdir(), "ws4-lease-"));
  try {
    const watcher = new NativeBridgeLease(directory), writer = new NativeBridgeLease(directory);
    assert.equal(watcher.accessQuarantine(), null);
    assert.equal(watcher.accessQuarantine(), null, "a second look at the same journal changes nothing");
    const { lease } = writer.reserve("owner-a", { requestId: "r1", kind: "mutation" });
    assert.equal(watcher.accessQuarantine()?.code, "NATIVE_BRIDGE_RESERVED", "the other process's mutation lease quarantines native access without a restart");
    assert.equal(writer.settle("owner-a", { lease, outcome: "callback-received" }).settled, true);
    assert.equal(watcher.accessQuarantine(), null, "and its settlement lifts it");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the byte figure tracks the JSON size without serializing", () => {
  const snapshot = { name: "a".repeat(100), layers: Array.from({ length: 50 }, (_, index) => ({ id: String(index), index, enabled: true, parent: null })) };
  const exact = JSON.stringify(snapshot).length, estimate = approximateBytes(snapshot);
  assert.ok(estimate > exact * 0.5 && estimate < exact * 2, `${estimate} should be near ${exact}`);
  assert.equal(approximateBytes(null) > 0, true);
  interface Nested { [key: string]: Nested }
  const deep: Nested = {};
  let cursor = deep;
  for (let depth = 0; depth < 20_000; depth += 1) { const next: Nested = {}; cursor.next = next; cursor = next; }
  assert.ok(approximateBytes(deep) > 0, "a very deep value does not overflow the stack");
});

test("a text layer is known by its type even when no property path was read", () => {
  const shallow = omit(makeLayer("11", 1, { type: "text" }), "propertyPaths");
  const index = layerHashIndex(withHashes(readSetOf({ layers: [shallow] }), { comp: "c", layers: { "11": "h" } }));
  assert.equal(index.compositions["5"]?.layers["11"]?.text, true);
  const solid = layerHashIndex(withHashes(readSetOf({ layers: [omit(makeLayer("11", 1), "propertyPaths")] }), { comp: "c", layers: { "11": "h" } }));
  assert.equal(solid.compositions["5"]?.layers["11"]?.text, false);
});

test("the bearer compare accepts exactly the session token", () => {
  const request = (authorization: string | undefined) => ({ headers: { authorization } });
  assert.equal(bearerMatches(request(`Bearer ${token}`), token), true);
  assert.equal(bearerMatches(request(`Bearer ${token}x`), token), false);
  assert.equal(bearerMatches(request(`Bearer ${token.slice(1)}`), token), false);
  assert.equal(bearerMatches(request(undefined), token), false);
  assert.equal(bearerMatches(request(token), token), false);
});

test("a new pairing forgets the stamps of the last session and the sources of plans no longer held", () => {
  const facts = newHostFacts();
  facts.afterStamps.set("p1", { epoch: 1, revision: 2 });
  facts.planSources.set("p1", "agent");
  facts.planSources.set("p2", "agent");
  pruneHostFacts(facts, ["p2"]);
  assert.equal(facts.afterStamps.size, 0);
  assert.deepEqual([...facts.planSources.keys()], ["p2"]);
});

type NativeBridgeBody = Parameters<LeaseContext["receivers"]["nativeBridge"]>[1];

function laneStub(settles: NativeBridgeBody[], state: LeaseContext["state"] = { inFlight: undefined }): LeaseContext {
  const nativeBridge = async (action: "reserve" | "settle", body: NativeBridgeBody): Promise<ReceiverOutcome> => {
    if (action === "settle") { settles.push(body); return { status: 200, outcome: "succeeded", body: { ok: true, settled: true } }; }
    const requestId = isRecord(body) ? body.requestId : undefined;
    return { status: 200, outcome: "succeeded", body: { ok: true, lease: { leaseId: "lease", settlementToken: "token", epoch: "epoch", owner: "owner", ...(requestId === undefined ? {} : { requestId }), kind: "mutation" } } };
  };
  return { receivers: { nativeBridge }, now: () => 0, log: () => undefined, state };
}

test("a call that throws before it starts settles its lease as not started and rethrows", async () => {
  const settles: NativeBridgeBody[] = [];
  await assert.rejects(leasedHostCall(laneStub(settles), { kind: "mutation" }, () => { throw new Error("boom"); }), /boom/);
  assert.equal(settles.length, 1);
  assert.ok(isRecord(settles[0]) && settles[0].outcome === "native-not-started");
});

test("a call that rejects after it started leaves a mutation lease open as unknown instead of throwing through", async () => {
  const settles: NativeBridgeBody[] = [], state: LeaseContext["state"] = { inFlight: undefined }, context = laneStub(settles, state);
  const rejected = async (): Promise<CallOutcome<HostCallResult>> => { throw new Error("socket"); };
  const result = await leasedHostCall(context, { kind: "mutation" }, rejected);
  assert.equal(result.status, "unknown");
  assert.equal(settles.length, 0, "an answer that never came is not settled");
  assert.ok(state.inFlight, "native access is quarantined until the lease is settled");
});

test("a socket that drops while the connect ping is in flight never reports the link online without a client", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ws4-link-")), plugin = await startFakePlugin({ stateDirectory: directory });
  const sidecar = sidecarForPlugin({ port: 0, token, discoveryPath: plugin.discoveryPath });
  let dropped = false;
  const connect = async (options: ConnectOptions) => {
    const real = await connectPlugin(options);
    const pingDirect: PluginClient["pingDirect"] = async (timeoutMs) => { if (!dropped) { dropped = true; options.onClose?.("reset"); } return real.pingDirect(timeoutMs); };
    return { endpoint: real.endpoint, request: real.request.bind(real), batch: real.batch.bind(real), hostCall: real.hostCall.bind(real), pingDirect, close: () => real.close() };
  };
  const link = createHostLink({ state: sidecar, discoveryPath: plugin.discoveryPath, connect, initialBackoffMs: 20, maxBackoffMs: 40 });
  const violations: string[] = [];
  let connectedCalls = 0;
  link.onChange((status) => { if (status.state === "online" && link.client() === undefined) violations.push("online without a client"); });
  link.onConnected(() => { connectedCalls += 1; });
  t.after(async () => { link.stop(); await plugin.close(); rmSync(directory, { recursive: true, force: true }); });
  link.start();
  const deadline = Date.now() + 5000;
  while (link.status().state !== "online" && Date.now() < deadline) await new Promise((resolve) => { setTimeout(resolve, 20); });
  assert.equal(link.status().state, "online", "the retry connects properly");
  assert.deepEqual(violations, []);
  assert.equal(connectedCalls, 1, "only the connection that survived is announced");
  assert.ok(dropped);
});
