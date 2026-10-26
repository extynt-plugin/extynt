/** The lane's client: stall options on every call, and the wait-and-retry while After Effects' script engine is not ready. */
import assert from "node:assert/strict";
import test from "node:test";
import type { BatchEntry, BatchItem, BatchResult, CallOptions, CallOutcome, HostCallResult, HostEntry, PluginClient } from "@extynt/host-native";
import { linkHandleOf, offlineHostLink } from "../src/host/lane-types.js";
import { stallAware } from "../src/host/stall-client.js";
import { present } from "./present.js";

const TIMING = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0, dispatchedBy: "idle" as const };
const notReady = { kind: "refused" as const, error: { code: "SCRIPT_ENGINE_NOT_READY", message: "JSON is not defined yet" }, rttMs: 1 };
const hostOk: CallOutcome<HostCallResult> = { kind: "ok", result: { source: "native", entry: "aeHostCensus", result: "{}", scriptUs: 1, libraryLoaded: false, libraryLoadUs: 0, libraryVersion: "v", projectEpoch: 1 }, timing: TIMING, rttMs: 1 };
const RETRY = { stepMs: 5, budgetMs: 200 };

function stub(hostCalls: Array<CallOutcome<HostCallResult>>, batches: Array<CallOutcome<BatchResult>> = []): { client: PluginClient; seen: CallOptions[]; calls: () => number } {
  const seen: CallOptions[] = [];
  let calls = 0;
  const client: PluginClient = {
    endpoint: { path: "", port: 0, token: "", pid: null, pluginVersion: null, aeVersion: null },
    hostCall: (_entry: HostEntry, _args: Parameters<PluginClient["hostCall"]>[1], options?: CallOptions) => { calls += 1; seen.push(options ?? {}); return Promise.resolve(present(hostCalls[Math.min(calls - 1, hostCalls.length - 1)])); },
    batch: (_ops: readonly BatchEntry[], options?: CallOptions) => { calls += 1; seen.push(options ?? {}); return Promise.resolve(present(batches[Math.min(calls - 1, batches.length - 1)])); },
    request: () => Promise.reject(new Error("not used")),
    pingDirect: () => Promise.reject(new Error("not used")),
    close: () => undefined,
  };
  return { client, seen, calls: () => calls };
}

const link = () => ({ ...linkHandleOf(offlineHostLink(0)), callOptions: (extra: CallOptions = {}): CallOptions => ({ ...extra, stallAfterMs: 7 }) });

test("a host call refused as not ready is retried until the engine answers, and carries the link's call options each time", async () => {
  const { client, seen, calls } = stub([notReady, notReady, hostOk]);
  const outcome = await stallAware(client, link(), RETRY).hostCall("aeHostCensus", {});
  assert.equal(outcome.kind, "ok");
  assert.equal(calls(), 3);
  assert.ok(seen.every((options) => options.stallAfterMs === 7));
});

test("a host call that never becomes ready returns the refusal once the budget is spent", async () => {
  const { client, calls } = stub([notReady]);
  const outcome = await stallAware(client, link(), { stepMs: 5, budgetMs: 60 }).hostCall("aeHostCensus", {});
  assert.deepEqual(outcome.kind === "refused" && outcome.error.code, "SCRIPT_ENGINE_NOT_READY");
  assert.ok(calls() >= 3 && calls() <= 13, `${calls()} attempts`);
});

const item = (ok: boolean, code?: string): BatchItem => ({ op: "host_call", ok, mainThreadMs: 0, getterCalls: 0, ...(ok ? { result: {} } : { error: { code: code ?? "X", message: "m" } }) });
const batchOf = (...items: BatchItem[]): CallOutcome<BatchResult> => ({ kind: "ok", result: { source: "native", results: items, ran: items.length, failed: 0, requested: items.length, totalMainThreadMs: 0 }, timing: TIMING, rttMs: 1 });
const entry = (name: "aeApplyPlan" | "aeHostCensus"): BatchEntry => ({ op: "host_call", entry: name, args: "{}" });

test("a batch whose host call was refused as not ready is retried whole", async () => {
  const { client, calls } = stub([], [batchOf(item(false, "SCRIPT_ENGINE_NOT_READY")), batchOf(item(true))]);
  const outcome = await stallAware(client, link(), RETRY).batch([entry("aeApplyPlan")], { stopOnError: false });
  assert.equal(outcome.kind === "ok" && outcome.result.results[0]?.ok, true);
  assert.equal(calls(), 2);
});

test("a batch in which a mutation already ran is never retried", async () => {
  const { client, calls } = stub([], [batchOf(item(true), item(false, "SCRIPT_ENGINE_NOT_READY"))]);
  await stallAware(client, link(), RETRY).batch([entry("aeApplyPlan"), entry("aeHostCensus")]);
  assert.equal(calls(), 1);
});

test("a batch that failed for another reason is not retried", async () => {
  const { client, calls } = stub([], [batchOf(item(false, "SCRIPT_FAILED"))]);
  await stallAware(client, link(), RETRY).batch([entry("aeHostCensus")]);
  assert.equal(calls(), 1);
});
