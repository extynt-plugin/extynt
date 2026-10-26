// Tests that every line the plugin can send decodes into its exact type and that anything else is rejected with a reason.
import assert from "node:assert/strict";
import test from "node:test";
import { decode, decodeOrThrow } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import {
  HOST_ENTRIES, HOST_MUTATION_ENTRIES, batchResult, hostCallResult, isHostEntry, isMutationEntry, parseHostCallResult,
  parseResponseLine, parseWatchState, pingDirectResult, watchState, watchSubscribed,
} from "../src/index.js";

const timing = { queuedMs: 31.2, walkMs: 1, hashMs: 0, serializeMs: 0.5, totalMainThreadMs: 1.6, bytes: 12, getterCalls: 4, dispatchedBy: "idle" };
const focus = {
  epoch: 2, revision: 9264, items: 135, projectName: "CLAUDE_TEST.aep", projectPath: "/Users/x/DEMO/CLAUDE_TEST.aep",
  activeCompId: "229", activeCompName: "BAKERY", time: 6.625, selection: ["362"],
  selectedLayers: [{ id: "362", index: 4, name: "WOODEN_CRATE" }],
};
const change = { event: "change", seq: 17, at: 123456.7, ...focus, reason: ["revision", "selection"] };
const hostCall: JsonObject = {
  source: "native", entry: "aeApplyPlan", result: "{\"ok\":true}", scriptUs: 510, libraryLoaded: false, libraryLoadUs: 0, libraryVersion: "0.1.0+abc", projectEpoch: 2,
};
const batch: JsonObject = {
  source: "native",
  results: [
    { op: "host_call", id: "a", ok: true, result: hostCall, mainThreadMs: 1, getterCalls: 0 },
    { op: "read_comp", ok: false, error: { code: "COMP_NOT_FOUND", message: "no" }, mainThreadMs: 0, getterCalls: 1 },
  ],
  ran: 2, failed: 1, requested: 2, totalMainThreadMs: 1,
};
const ping: JsonObject = {
  pong: true, mainThread: false, pluginVersion: "0.1.0", aeVersion: "26.2.1", pid: 4242, arch: "arm64", idleAgeMs: null, idleTicks: 0, queueDepth: 0,
  oldestQueuedMs: null, watchers: 1, library: { version: null, entryFile: null },
};

function line(value: JsonObject): ReturnType<typeof parseResponseLine> {
  return parseResponseLine(JSON.stringify(value));
}

test("a success response line is a response with its timing", () => {
  const response = { ok: true, id: "7", op: "revision", result: { revision: 9 }, timing };
  assert.deepEqual(line(response), { kind: "response", value: response });
});

test("an error response line keeps code, message and aeErr", () => {
  const response = { ok: false, id: "8", op: "read_comp", error: { code: "HOST_ERROR", message: "AEGP call failed", aeErr: 5027 } };
  assert.deepEqual(line(response), { kind: "response", value: response });
});

test("a failure without aeErr omits it, and an empty id from a bad-json answer is accepted", () => {
  const response = { ok: false, id: "", op: "", error: { code: "BAD_JSON", message: "no" } };
  assert.deepEqual(line(response), { kind: "response", value: response });
});

test("a response without an op reads the op as empty", () => {
  const parsed = line({ ok: false, id: "9", error: { code: "BAD_JSON", message: "no" } });
  assert.equal(parsed.kind === "response" && parsed.value.op, "");
});

test("a change event line carries the full watch state and its reasons", () => {
  assert.deepEqual(line(change), { kind: "event", value: change });
});

test("absent nullable members of a change event read as null", () => {
  const sparse = { event: "change", seq: 1, at: 2, epoch: 0, projectName: "", selection: [], selectedLayers: [], reason: ["initial"] };
  const expected = { ...sparse, revision: null, items: null, projectPath: null, activeCompId: null, activeCompName: null, time: null };
  assert.deepEqual(line(sparse), { kind: "event", value: expected });
});

test("still, overflow and host-closing event lines parse", () => {
  const still = { event: "still", seq: 18, at: 124456.9, epoch: 2, revision: 9264 };
  const overflow = { event: "overflow", dropped: 12 };
  const closing = { event: "host-closing", seq: 19, at: 125000, reason: "death-hook" };
  for (const event of [still, overflow, closing]) assert.deepEqual(line(event), { kind: "event", value: event });
});

test("malformed or unknown events are invalid, never partially accepted", () => {
  const lines = [
    { event: "change", seq: 1, at: 1 },
    { ...change, reason: ["revision", "nonsense"] },
    { ...change, selectedLayers: [{ id: "1", index: "four", name: "x" }] },
    { event: "still", seq: 1, at: 1 },
    { event: "overflow", dropped: "many" },
    { event: "host-closing", seq: 1, at: 1, reason: "crash" },
    { event: "mystery" },
  ];
  for (const malformed of lines) assert.equal(line(malformed).kind, "invalid");
});

test("an invalid event line names the event", () => {
  const parsed = line({ event: "mystery" });
  assert.equal(parsed.kind === "invalid" && parsed.reason, "malformed or unknown event mystery");
});

test("garbage lines are invalid with a reason", () => {
  const lines = ["", "not json", "[1,2]", "42", "null", "{}", '{"ok":true}', '{"id":"1"}', '{"ok":true,"id":"1","op":"x","result":1}'];
  for (const garbage of lines) {
    const parsed = parseResponseLine(garbage);
    assert.equal(parsed.kind, "invalid", garbage);
    assert.notEqual(parsed.kind === "invalid" && parsed.reason, "");
  }
});

test("the reasons tell text that is not JSON from JSON that is not an object", () => {
  const reasons = ["not json", "[1,2]", "{}"].map((text) => parseResponseLine(text));
  assert.deepEqual(reasons, [
    { kind: "invalid", reason: "not JSON" },
    { kind: "invalid", reason: "not a JSON object" },
    { kind: "invalid", reason: "neither a response nor an event" },
  ]);
});

test("a success response with a malformed timing is invalid", () => {
  const broken = { ...timing, dispatchedBy: "thread" };
  assert.equal(line({ ok: true, id: "1", op: "ping", result: {}, timing: broken }).kind, "invalid");
});

test("the host_call allowlist is the fixed table and mutations are a subset", () => {
  assert.equal(HOST_ENTRIES.length, 14);
  assert.equal(new Set(HOST_ENTRIES).size, HOST_ENTRIES.length);
  for (const entry of HOST_MUTATION_ENTRIES) assert.ok(isHostEntry(entry) && isMutationEntry(entry));
});

test("only a listed entry is a host entry, and only a changing one is a mutation", () => {
  assert.equal(isHostEntry("evalScript"), false);
  assert.equal(isMutationEntry("aeCaptureFrame"), false);
  assert.equal(isMutationEntry("aeCollectEffectCreation"), true);
});

test("watch_state result narrows like the change body", () => {
  assert.deepEqual(decodeOrThrow(watchState, focus), focus);
  assert.equal(decode(watchState, { ...focus, selection: [1] }).ok, false);
  assert.equal(decode(watchState, "x").ok, false);
});

test("a watch subscription needs subscribed true and both intervals", () => {
  assert.deepEqual(decodeOrThrow(watchSubscribed, { subscribed: true, intervalMs: 100, stillMs: 1000 }), { subscribed: true, intervalMs: 100, stillMs: 1000 });
  assert.equal(decode(watchSubscribed, { subscribed: false }).ok, false);
});

test("a host_call result decodes whole", () => {
  assert.deepEqual(decodeOrThrow(hostCallResult, hostCall), hostCall);
});

test("a batch result decodes whole and a bad member rejects the whole value", () => {
  assert.deepEqual(decodeOrThrow(batchResult, batch), batch);
  assert.equal(decode(batchResult, { ...batch, results: [{ op: "x" }] }).ok, false);
});

test("the unknown-input entry points answer null for what does not fit", () => {
  assert.deepEqual(parseHostCallResult(hostCall), hostCall);
  assert.equal(parseHostCallResult({ ...hostCall, entry: "nope" }), null);
  assert.deepEqual(parseWatchState(focus), focus);
  assert.equal(parseWatchState({ ...focus, selection: [1] }), null);
});

test("ping_direct decodes with a null idle age before the first idle tick", () => {
  assert.deepEqual(decodeOrThrow(pingDirectResult, ping), { ...ping, host: null, waitingOnDialog: null });
});

test("ping_direct keeps a measured idle age and the library it reports", () => {
  const measured = decodeOrThrow(pingDirectResult, { ...ping, idleAgeMs: 33.5, library: { version: "1+x", entryFile: "/a/probe.jsx" } });
  assert.deepEqual([measured.idleAgeMs, measured.library], [33.5, { version: "1+x", entryFile: "/a/probe.jsx" }]);
});

test("ping_direct rejects a main-thread pong and a non-numeric queue depth", () => {
  assert.equal(decode(pingDirectResult, { ...ping, mainThread: true }).ok, false);
  assert.equal(decode(pingDirectResult, { ...ping, queueDepth: "0" }).ok, false);
});
