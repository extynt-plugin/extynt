/** Tests the host client's call queue: FIFO order, JSON arguments and per-call outcomes. */
import assert from "node:assert/strict";
import test from "node:test";
import { chunked, late, ok, raw, refuse } from "../src/index.js";
import { until, withRig } from "./rig.js";

function line<V>(value: V): string {
  return `${JSON.stringify(value)}\n`;
}

const TIMING = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0, dispatchedBy: "idle" };

test("calls are sent one at a time in FIFO order and each outcome carries its own answer", async () => {
  let served = 0;
  const finished: number[] = [];
  await withRig(async ({ client, plugin }) => {
    const calls = [0, 1, 2].map((n) => client.request<{ n: number }>({ op: "ping" }).then((outcome) => { finished.push(n); return outcome; }));
    const outcomes = await Promise.all(calls);
    assert.deepEqual(finished, [0, 1, 2]);
    assert.deepEqual(outcomes.map((outcome) => outcome.kind === "ok" ? outcome.result.n : -1), [0, 1, 2]);
    const ids = plugin.requestsFor("ping").map((request) => request.id);
    assert.equal(new Set(ids).size, 3);
  }, { plugin: { handlers: { ping: () => late(served === 0 ? 40 : 0, ok({ n: served++ })) } } });
});

test("hostCall sends the arguments as a JSON string and parses the host result", async () => {
  await withRig(async ({ client, plugin }) => {
    const outcome = await client.hostCall("aeUndoPlan", { planId: "p1" });
    assert.equal(outcome.kind, "ok");
    if (outcome.kind === "ok") assert.equal(outcome.result.result, '{"undone":true}');
    assert.equal(plugin.requestsFor("host_call")[0]?.body.args, '{"planId":"p1"}');
  }, { plugin: { hostCalls: { aeUndoPlan: () => ok({ undone: true }) } } });
});

test("an error answer is refused with its code and aeErr, and SHUTTING_DOWN reads as lost", async () => {
  await withRig(async ({ client }) => {
    const refused = await client.request({ op: "read_comp", compId: "99" });
    assert.equal(refused.kind, "refused");
    if (refused.kind === "refused") assert.equal(refused.error.code, "COMP_NOT_FOUND");
    const hostError = await client.hostCall("aeApplyPlan", {});
    assert.equal(hostError.kind === "refused" && hostError.error.aeErr, 5027);
    const closing = await client.request({ op: "revision" });
    assert.deepEqual(closing.kind === "lost" && [closing.reason, closing.sent], ["shutting-down", false]);
  }, { plugin: { handlers: { revision: () => refuse("SHUTTING_DOWN", "quitting") }, hostCalls: { aeApplyPlan: () => refuse("HOST_ERROR", "failed", 5027) } } });
});

test("batch returns the parsed result with per-op entries, honouring stopOnError", async () => {
  await withRig(async ({ client }) => {
    const ops = [{ op: "ping" as const, id: "a" }, { op: "read_comp" as const, compId: "nope", id: "b" }, { op: "revision" as const, id: "c" }];
    const all = await client.batch(ops);
    assert.equal(all.kind, "ok");
    if (all.kind === "ok") assert.deepEqual([all.result.ran, all.result.failed, all.result.results.map((item) => item.ok)], [3, 1, [true, false, true]]);
    const stopped = await client.batch(ops, { stopOnError: true });
    if (stopped.kind === "ok") assert.deepEqual([stopped.result.ran, stopped.result.requested], [2, 3]);
    else assert.fail("batch should succeed");
  });
});

test("a response split mid-token across writes is reassembled", async () => {
  const text = line({ ok: true, id: "SELF", op: "ping", result: { split: "héllo" }, timing: TIMING });
  await withRig(async ({ client }) => {
    const outcome = await client.request<{ split: string }>({ op: "ping" });
    assert.equal(outcome.kind === "ok" && outcome.result.split, "héllo");
  }, { plugin: { handlers: { ping: (request) => {
    const full = text.replace("SELF", request.id);
    return chunked([full.slice(0, 9), full.slice(9, 40), full.slice(40)]);
  } } } });
});

test("a line that never completes times out as lost with sent true, and the next answer then corrupts the stream", async () => {
  let first = true;
  await withRig(async ({ client, closes }) => {
    const lostCall = await client.request({ op: "ping" }, { timeoutMs: 60 });
    assert.deepEqual(lostCall.kind === "lost" && [lostCall.reason, lostCall.sent], ["timeout", true]);
    const next = await client.request({ op: "ping" });
    assert.equal(next.kind === "lost" && next.reason, "protocol");
    await until(() => closes.length > 0);
    assert.deepEqual(closes, ["reset"]);
  }, { plugin: { handlers: { ping: () => { const was = first; first = false; return was ? raw('{"ok":true,"id":"1","op":"pi') : ok({}); } } } });
});

test("a timed-out call's late answer is skipped, even concatenated with the next answer", async () => {
  let calls = 0;
  await withRig(async ({ client, plugin }) => {
    const first = await client.request({ op: "ping" }, { timeoutMs: 40 });
    assert.equal(first.kind, "lost");
    const second = await client.request<{ n: number }>({ op: "ping" });
    assert.equal(second.kind === "ok" && second.result.n, 2);
    assert.equal(plugin.requestsFor("ping").length, 2);
  }, { plugin: { handlers: { ping: (request) => {
    calls += 1;
    if (calls === 1) return raw("");
    const firstId = String(Number(request.id) - 1);
    return raw(line({ ok: true, id: firstId, op: "ping", result: { n: 1 }, timing: TIMING }) + line({ ok: true, id: request.id, op: "ping", result: { n: 2 }, timing: TIMING }));
  } } } });
});

test("a call that times out while queued is lost with sent false", async () => {
  await withRig(async ({ client }) => {
    const slow = client.request({ op: "ping" }, { timeoutMs: 500 });
    const queued = await client.request({ op: "revision" }, { timeoutMs: 40 });
    assert.deepEqual(queued.kind === "lost" && [queued.reason, queued.sent], ["timeout", false]);
    assert.equal((await slow).kind, "ok");
  }, { plugin: { handlers: { ping: () => late(120, ok({})) } } });
});

test("a connection that closes mid-call loses the in-flight call (sent true) and the queued one (sent false)", async () => {
  let reached = false;
  await withRig(async ({ client, plugin, closes }) => {
    const inflight = client.hostCall("aeApplyPlan", {});
    const queued = client.request({ op: "revision" });
    await until(() => reached);
    plugin.dropConnections("requesters");
    const [a, b] = await Promise.all([inflight, queued]);
    assert.deepEqual(a.kind === "lost" && [a.reason, a.sent], ["closed", true]);
    assert.deepEqual(b.kind === "lost" && [b.reason, b.sent], ["closed", false]);
    await until(() => closes.length > 0);
    assert.deepEqual(closes, ["reset"]);
    const after = await client.request({ op: "ping" });
    assert.deepEqual(after.kind === "lost" && [after.reason, after.sent], ["closed", false]);
  }, { plugin: { hostCalls: { aeApplyPlan: () => { reached = true; return late(300, ok({})); } } } });
});

test("an answer with the wrong id is a protocol error that closes the link", async () => {
  await withRig(async ({ client, closes }) => {
    const outcome = await client.request({ op: "ping" });
    assert.deepEqual(outcome.kind === "lost" && outcome.reason, "protocol");
    await until(() => closes.length > 0);
    assert.deepEqual(closes, ["reset"]);
  }, { plugin: { handlers: { ping: () => raw(line({ ok: true, id: "zzz", op: "ping", result: {}, timing: TIMING })) } } });
});

test("garbage that is not JSON is a protocol error, and an answer with an empty id still settles the call", async () => {
  await withRig(async ({ client, closes }) => {
    const empty = await client.request({ op: "ping" });
    assert.equal(empty.kind === "refused" && empty.error.code, "BAD_JSON");
    const garbage = await client.request({ op: "revision" });
    assert.equal(garbage.kind === "lost" && garbage.reason, "protocol");
    await until(() => closes.length > 0);
  }, { plugin: { handlers: {
    ping: () => raw(line({ ok: false, id: "", op: "", error: { code: "BAD_JSON", message: "x" } })),
    revision: () => raw("this is not json\n"),
  } } });
});

test("a result that fails its narrower is lost as protocol without closing the link", async () => {
  await withRig(async ({ client, closes }) => {
    const outcome = await client.batch([{ op: "ping" }]);
    assert.equal(outcome.kind === "lost" && outcome.reason, "protocol");
    assert.equal((await client.request({ op: "revision" })).kind, "ok");
    assert.deepEqual(closes, []);
  }, { plugin: { handlers: { batch: () => ok({ nonsense: true }) } } });
});

test("a request line over 16 MiB is refused locally and never sent", async () => {
  await withRig(async ({ client, plugin }) => {
    const outcome = await client.hostCall("aeApplyPlan", { svg: "x".repeat(16 * 1024 * 1024) });
    assert.equal(outcome.kind === "refused" && outcome.error.code, "REQUEST_TOO_LARGE");
    assert.equal(plugin.requestsFor("host_call").length, 0);
  });
});

test("the default timeout is longer for a mutation than for a read", async () => {
  await withRig(async ({ client }) => {
    const read = await client.request({ op: "ping" }, { timeoutMs: 30 });
    assert.equal(read.kind === "lost" && read.reason, "timeout");
    const mutation = await client.hostCall("aeApplyPlan", {});
    assert.equal(mutation.kind, "ok");
  }, { plugin: { handlers: { ping: () => late(80, ok({})) }, hostCalls: { aeApplyPlan: () => late(80, ok({})) } } });
});
