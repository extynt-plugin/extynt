/** Batch settlement: job-scoped undo order, the turn log, ghost approvals, and what a seal waits for. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import { MockProvider } from "@extynt/llm";
import { decodeJson, jsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { SIDECAR_BUILD_ID } from "../src/server-build.js";
import { present } from "./agent-test-support.js";
import { fieldOf, flagOf, listOf, maybeFlagOf, maybeListOf, maybeTextOf, numberOf, readJson, recordOf, recordsOf, textOf } from "./http-json.js";
import { authorization, claimOver, mutableSnapshot, receiptResponse, sidecarFor, token, withVerificationAck, workflowStageStep } from "./sidecar-fixture.js";
import { startRig, type AppliedBatch, type Rig } from "./workflow-batch-fixtures.js";

async function applyTwoBatches(rig: Rig): Promise<{ first: AppliedBatch; second: AppliedBatch }> {
  await rig.post("/v1/snapshots", mutableSnapshot("start", ["layer-1"], "Start"));
  const first = await rig.sealAndApply("Countdown leader", undefined, "One");
  const second = await rig.sealAndApply("Countdown leader, numbers", first.jobId, "Two");
  assert.equal(second.jobId, first.jobId, "both batches are one job");
  assert.notEqual(second.planId, first.planId);
  return { first, second };
}

async function requestJobUndo(rig: Rig, batches: { first: AppliedBatch; second: AppliedBatch }): Promise<void> {
  const { first, second } = batches;
  const requested = await rig.agent("ae_undo_plan", { planId: second.planId, scope: "job" });
  assert.equal(requested.ok, true, JSON.stringify(requested));
  assert.equal(maybeTextOf(requested, "data.scope"), "job");
  assert.equal(maybeTextOf(requested, "data.planId"), second.planId);
  assert.deepEqual(listOf(requested, "data.batchOrder"), [second.planId, first.planId], "newest applied batch first, the earlier one after it");
  assert.equal(numberOf(requested, "data.batches"), 2);
  assert.deepEqual(listOf(requested, "data.skipped"), [], "a batch that applied is never skipped");
  assert.deepEqual(recordsOf(requested, "data.jobUndo.order").map((entry) => textOf(entry, "planId")), [second.planId, first.planId]);
  const itemOne = await rig.claim();
  assert.equal(maybeTextOf(itemOne, "planId"), second.planId, "the panel is handed one batch at a time");
  assert.equal(maybeTextOf(itemOne, "scope"), "job", "and it is told the undo belongs to a job");
  assert.equal(maybeTextOf(itemOne, "kind"), "undo_plan");
}

async function undoNewestBatch(rig: Rig, batches: { first: AppliedBatch; second: AppliedBatch }): Promise<void> {
  const { first, second } = batches;
  await rig.post("/v1/snapshots", mutableSnapshot("after-undo-2", ["layer-1"], "One"));
  const undidSecond = await rig.undoReceipt(second.planId);
  assert.equal(flagOf(undidSecond, "receipt.undo.restoredPreApplyFingerprint"), true);
  assert.deepEqual(maybeListOf(undidSecond, "receipt.jobUndo.order"), [second.planId, first.planId]);
  assert.deepEqual(maybeListOf(undidSecond, "receipt.jobUndo.undone"), [second.planId]);
  assert.equal(maybeFlagOf(undidSecond, "receipt.jobUndo.complete"), undefined, "the job is not finished after one of its two batches");
  const itemTwo = await rig.claim();
  assert.equal(maybeTextOf(itemTwo, "planId"), first.planId, "the earlier batch is undone after the later one");
}

async function undoEarliestBatch(rig: Rig, batches: { first: AppliedBatch; second: AppliedBatch }): Promise<void> {
  const { first, second } = batches;
  await rig.post("/v1/snapshots", mutableSnapshot("after-undo-1", ["layer-1"], "Start"));
  const undidFirst = await rig.undoReceipt(first.planId);
  assert.equal(maybeFlagOf(undidFirst, "receipt.jobUndo.complete"), true);
  assert.deepEqual(maybeListOf(undidFirst, "receipt.jobUndo.undone"), [second.planId, first.planId]);
  assert.deepEqual(maybeListOf(undidFirst, "receipt.jobUndo.remaining"), []);
  assert.equal(maybeTextOf(await rig.agent("ae_get_plan_status", { planId: first.planId }), "data.status"), "undone");
  assert.equal(maybeTextOf(await rig.agent("ae_get_plan_status", { planId: second.planId }), "data.status"), "undone");
  assert.equal(await rig.claimNow(), null, "nothing else is queued behind the job");
}

test("undo scope \"job\" walks every applied batch of a job, newest first, one settlement at a time", async (t) => {
  const rig = await startRig(t, "panel-job-undo");
  const batches = await applyTwoBatches(rig);
  await requestJobUndo(rig, batches);
  await undoNewestBatch(rig, batches);
  await undoEarliestBatch(rig, batches);
});

test("a job-scoped undo stops at the first batch that does not settle cleanly, and says which ones it did not attempt", async (t) => {
  const rig = await startRig(t, "panel-job-undo-stop");
  const { first, second } = await applyTwoBatches(rig);
  const requested = await rig.agent("ae_undo_plan", { planId: second.planId, scope: "job" });
  assert.equal(requested.ok, true);
  assert.equal(fieldOf(await rig.claim(), "planId"), second.planId);

  await rig.post("/v1/snapshots", mutableSnapshot("after-bad-undo", ["layer-1"], "Something Else"));
  const stopped = await rig.undoReceipt(second.planId);
  assert.match(String(maybeTextOf(stopped, "receipt.jobUndo.stopped")), /does not match the state that batch's apply started from/);
  assert.deepEqual(maybeListOf(stopped, "receipt.jobUndo.remaining"), [first.planId]);
  assert.match(String(maybeTextOf(stopped, "receipt.jobUndo.action")), /was not attempted|were not attempted/);
  assert.equal(await rig.claimNow(), null, "and nothing further was queued for the panel");
  assert.equal(maybeTextOf(await rig.agent("ae_get_plan_status", { planId: first.planId }), "data.status"), "verified", "the unattempted batch keeps the status it had; it was never requested");
});

function loggedLine(line: string): JsonValue | null {
  const decoded = decodeJson(line, jsonValue);
  return decoded.ok ? decoded.value : null;
}

test("the turn log names the build, splits the tokens, and charges each step its own spend", async (t) => {
  const step = (id: string, name: string, args: JsonObject) => ({ id, name, arguments: args });
  const rename = { type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Hero" };
  let calls = 0;
  const provider = new MockProvider({ script: () => {
    calls += 1;
    if (calls === 1) return { text: "", toolCalls: [step("c1", "ae_queue_add", { summary: "One rename", operations: [rename] })], usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40 } };
    return { text: "Done.", toolCalls: [], usage: { inputTokens: 120, outputTokens: 15, totalTokens: 135, cachedInputTokens: 20 } };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-token-split")) });

  const lines: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => { lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")); return true; });
  const response = await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId: "chat-token-split", message: "rename this" }) });
  t.mock.restoreAll();
  assert.equal(response.status, 200);
  const logged = lines.map(loggedLine);
  const turn = present(logged.find((line) => fieldOf(line, "event") === "agent.turn"), "the turn summary is written");
  assert.equal(fieldOf(turn, "tokens"), 255, "the total stays where every existing reader parses it");
  assert.equal(fieldOf(turn, "inputTokens"), 220, "the split rides beside it instead of replacing it");
  assert.equal(fieldOf(turn, "outputTokens"), 35);
  assert.equal(fieldOf(turn, "cachedInputTokens"), 60, "and so does the cache split every adapter already computes");
  assert.equal(fieldOf(turn, "build"), SIDECAR_BUILD_ID, "the run is attributable to the build that produced it");
  assert.ok(textOf(turn, "build").length <= 32, "and the build id is bounded");
  const steps = logged.filter((line) => fieldOf(line, "event") === "agent.step");
  assert.deepEqual(steps.map((line) => [fieldOf(line, "step"), fieldOf(line, "inputTokens"), fieldOf(line, "outputTokens"), fieldOf(line, "cachedInputTokens")]), [[1, 100, 20, 40], [2, 120, 15, 20]], "each step is charged its own tokens, never the running total over again");
  assert.equal(steps.every((line) => fieldOf(line, "requestId") === "chat-token-split"), true, "and every step line says which turn it belongs to");
});

function serveApplies(sidecar: ReturnType<typeof sidecarFor>, base: string): { stop: () => Promise<void> } {
  let running = true;
  const approved = new Set<string>();
  const approveReady = async (): Promise<void> => {
    const ready = await readJson(await fetch(`${base}/v1/chat/plans/ready`, { headers: authorization }));
    const planId = maybeTextOf(ready, "plans.0.planId");
    if (!planId || approved.has(planId)) { await new Promise((resolve) => setTimeout(resolve, 10)); return; }
    approved.add(planId);
    await (await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_approve_plan", arguments: withVerificationAck("ae_approve_plan", { planId }) }) })).text();
  };
  const applyClaimed = async (planId: string, approvalId: string | undefined): Promise<void> => {
    await fetch(`${base}/v1/pipeline`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ event: "apply-begin", detail: `${planId} 1 operations` }) });
    await receiptResponse(sidecar, { planId, approvalId, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied", undoGroups: 1, verification: { state: "exact", basis: "fixture read-back", steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis: "fixture read-back" }] } });
  };
  const loop = (async () => {
    while (running) {
      const claimed = claimOver(sidecar).body;
      const planId = maybeTextOf(claimed, "item.planId");
      if (!planId) { await approveReady(); continue; }
      await applyClaimed(planId, maybeTextOf(claimed, "item.approval.token"));
    }
  })();
  return { stop: async () => { running = false; await loop; } };
}

test("a seal waits only on the batches its own compile could depend on", async (t) => {
  const clock = Date.parse("2026-09-18T15:00:00.000Z");
  const rename = (name: string) => ({ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name });
  const provider = new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("scope");
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "scope-add", name: "ae_queue_add", arguments: { summary: "Owner batch", operations: [rename("Zero")] } }] };
    if (!called.includes("ae_queue_finish")) return { text: "", toolCalls: [{ id: "scope-finish", name: "ae_queue_finish", arguments: {} }] };
    return { text: "Sealed it.", toolCalls: [] };
  } });

  const sidecar = sidecarFor({ port: 0, token, panelSessionId: "panel-scope", chatProvider: provider, quietAgentLog: true, now: () => new Date(clock) });
  const address = await sidecar.start();
  const hosts: Array<{ stop: () => Promise<void> }> = [];
  t.after(async () => { for (const host of hosts) await host.stop(); await sidecar.stop(); });
  const base = `http://${address.host}:${address.port}`;
  await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-scope")) });
  const chat = async (requestId: string, message: string) => recordOf(await readJson((await fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId, message }) }))), "");
  const external = async (name: string, args: JsonObject) => recordOf(await readJson((await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "X-AE-Client": "agent" }, body: JSON.stringify({ name, arguments: withVerificationAck(name, args) }) }))), "");
  const ghostId = textOf(await external("ae_propose_plan", { summary: "External rename", operations: [rename("Hero")] }), "data.planId");
  assert.equal(maybeTextOf(await external("ae_approve_plan", { planId: ghostId, waitSeconds: 0 }), "data.status"), "approved", "an external client's plan is approved and never reported on");
  sidecar.agentMailbox.splice(0);
  hosts.push(serveApplies(sidecar, base));
  const startedAt = Date.now();
  const sealed = await chat("chat-scope", "rename it to Zero");
  const elapsed = Date.now() - startedAt;
  assert.equal(maybeListOf(sealed, "plans")?.length, 1, "the owner's seal sealed, rather than spending its budget on another client's plan");
  assert.ok(elapsed < 10_000, `an unrelated in-flight plan must not cost a settle budget (took ${elapsed} ms)`);
  assert.equal(maybeTextOf(await external("ae_get_plan_status", { planId: ghostId, waitSeconds: 0 }), "data.status"), "approved", "and the unrelated plan is still the panel's business, untouched");
});
