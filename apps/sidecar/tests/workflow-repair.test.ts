// Tests that a rejected or mismatched batch reopens its stage for repair with precise evidence, and that automatic repairs are capped.

import type { StoredReceipt } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import { type JsonValue } from "@extynt/decode";
import { MockProvider } from "@extynt/llm";
import type { WorkflowContinuationInput } from "@extynt/workflow";
import type { ReadOnlySidecar } from "../src/server.js";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { present } from "./agent-test-support.js";
import { readJson, textOf } from "./http-json.js";
import { authorization, chatTurn, claimResponse, mutableSnapshot, pause, queueRename, receiptResponse, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { at, authority, batchIdOf, batchOf, jobIdOf, plan, ready, verifiedReceipt } from "./workflow-coordinator-fixture.js";

const CONTINUATION_MARKER = "WORKFLOW CONTINUATION INPUT (sidecar-owned structured evidence; do not infer beyond these fields):";
const PREFLIGHT_MESSAGE = "INVALID_VALUE: ensure_shape_stroke groupId must be root, shape:<n>, or a prior create_shape_group placeholder.";

const askFirst = (base: string) => fetch(`${base}/v1/ui/prefs`, { method: "PATCH", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ askBeforeApplying: "always" }) });

const post = (sidecar: ReadOnlySidecar, base: string, path: string, body: JsonValue | ReturnType<typeof mutableSnapshot>) => path === "/v1/receipts" ? receiptResponse(sidecar, body) : fetch(`${base}${path}`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(body) });

function preflightRejection(planId: string): StoredReceipt {
  return {
    planId,
    status: "rejected",
    postcondition: "not_run",
    mayHaveMutated: false,
    mutationState: "not-applied",
    hostError: { code: "INVALID_VALUE", message: PREFLIGHT_MESSAGE },
    failure: { phase: "preflight", operationIndex: 0, operation: "set_layer_name" },
    operationOutcomes: [{ index: 0, type: "set_layer_name", outcome: "rejected_before_apply", mutated: false, error: { code: "INVALID_VALUE", message: PREFLIGHT_MESSAGE } }],
  };
}

function mismatchedReceipt(planId: string): StoredReceipt {
  return {
    planId,
    status: "executed",
    postcondition: "applied",
    mayHaveMutated: true,
    mutationState: "applied",
    afterFingerprint: "snapshot-after-mismatch",
    verification: { steps: [{ operation: "set_layer_name", verificationState: "failed", observed: false, basis: "layer-name-mismatch", compositionId: "comp-1", layerId: "layer-1", observedValue: "Original" }] },
  };
}

function settledOutcome(continuation: WorkflowContinuationInput) {
  const batch = present(continuation.settledBatches[0], "settled batch");
  const outcome = present(present(batch.receipt ?? undefined, "receipt").outcomes[0], "outcome");
  return { batch, outcome };
}

test("a preflight rejection returns precise evidence to a repair cycle and permits a fresh corrected batch", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const failed = plan("failed-plan", "Corrected");
  assert.equal(coordinator.admitPlan(failed, { jobId: "repair-job", undoGroups: 1, authority }).ok, true);
  coordinator.queue(failed.planId);
  coordinator.rejectBeforeApply(failed.planId, preflightRejection(failed.planId));

  const batch = batchOf(coordinator, failed.planId);
  const failedOutcome = present(present(batch.execution.receipt ?? undefined, "receipt").outcomes[0], "outcome");
  assert.match(failedOutcome.basis ?? "", /ensure_shape_stroke groupId/);
  const jobId = jobIdOf(coordinator, failed.planId);
  coordinator.reopenForRepair(jobId, batch.batchId);
  const repair = settledOutcome(coordinator.continuation(jobId, { fingerprint: "snapshot-before", revision: "1" }, 1));
  assert.equal(repair.batch.sourcePlanId, failed.planId);
  assert.match(repair.outcome.basis ?? "", /INVALID_VALUE: ensure_shape_stroke/);

  const corrected = plan("corrected-plan", "Corrected");
  ready(coordinator, corrected, "repair-job");
  const dependencies = present(coordinator.workflowStore.getState().batches[batchIdOf(coordinator, corrected.planId)], "batch").dependencies;
  assert.deepEqual(dependencies, [], "a failed batch is repair evidence, not a verified dependency");
  coordinator.receipt(corrected.planId, { ...verifiedReceipt("corrected-receipt"), planId: corrected.planId, afterFingerprint: "snapshot-after-repair" });
  const afterRepair = coordinator.continuation(jobId, { fingerprint: "snapshot-after-repair", revision: "2" }, 2);
  assert.deepEqual(afterRepair.blockers, [], "a verified correction supersedes a no-mutation rejection as a stage blocker");
  coordinator.completeStageForContinuation(jobId);
  assert.equal(coordinator.workflowStore.getState().stages[batch.stageId]?.status, "completed");
});

test("a readback mismatch from an executed/applied batch reopens for repair and lists the mismatched operations", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const mismatch = plan("mismatch-plan", "Corrected");
  ready(coordinator, mismatch, "repair-job-2");
  coordinator.receipt(mismatch.planId, mismatchedReceipt(mismatch.planId));

  const batch = batchOf(coordinator, mismatch.planId);
  assert.equal(batch.verification.state, "failed");
  assert.equal(batch.execution.state, "executed");
  const jobId = jobIdOf(coordinator, mismatch.planId);
  coordinator.reopenForRepair(jobId, batch.batchId);
  const repair = settledOutcome(coordinator.continuation(jobId, { fingerprint: "snapshot-after-mismatch", revision: "1" }, 1));
  assert.equal(repair.batch.sourcePlanId, mismatch.planId);
  assert.equal(repair.outcome.verification, "failed", "repair brief includes the failed readback operation");
  assert.equal(repair.outcome.outcome, "readback_mismatch");
  assert.deepEqual("readback" in repair.outcome ? repair.outcome.readback : undefined, { targetLayerId: "layer-1", expected: "Corrected", observed: "Original" });
});

async function applyMismatch(sidecar: ReadOnlySidecar, base: string, planId: string, names: { readonly snapshot: string; readonly receipt: string }): Promise<void> {
  const approved = await fetch(`${base}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent" }, body: JSON.stringify({ name: "ae_approve_plan", arguments: { planId, acknowledgeUnverified: true, waitSeconds: 0 } }) });
  assert.equal(approved.status, 200);
  const approvalToken = textOf(await readJson(approved), "data.approval.token");
  assert.equal((await claimResponse(sidecar)).status, 200);
  assert.equal((await post(sidecar, base, "/v1/pipeline", { event: "apply-begin", detail: `${planId} 1 operations` })).status, 200);
  await post(sidecar, base, "/v1/snapshots", mutableSnapshot(names.snapshot, ["layer-1"], "Original"));
  const receipt = await post(sidecar, base, "/v1/receipts", {
    planId,
    approvalId: approvalToken,
    receiptId: names.receipt,
    operation: "apply_plan",
    status: "executed",
    postcondition: "failed",
    appliedOperations: ["set_layer_name"],
    mayHaveMutated: true,
    mutationState: "applied",
    verification: { steps: [{ operation: "set_layer_name", observed: false, verificationState: "failed", basis: "layer-name-mismatch", compositionId: "comp-1", layerId: "layer-1", expectedValue: "Corrected", observedValue: "Original" }] },
  });
  assert.equal(receipt.status, 201);
}

function cycleProvider(onBrief: (brief: string) => void): MockProvider {
  return new MockProvider({ script: (input) => {
    if (input.system.includes(CONTINUATION_MARKER)) {
      onBrief(`${input.system.slice(input.system.lastIndexOf(CONTINUATION_MARKER))}\n${input.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n")}`);
      return { text: "I will inspect the mismatch before proposing a correction.", toolCalls: [] };
    }
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("repair-cycle", "Repair the layer readback", ["set_layer_name"]);
    if (!called.includes("ae_queue_add")) return { text: "", toolCalls: [{ id: "repair-add", name: "ae_queue_add", arguments: { summary: "Repair the layer readback", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Corrected" }] } }] };
    return { text: "", toolCalls: [{ id: "repair-finish", name: "ae_queue_finish", arguments: {} }] };
  } });
}

test("a failed readback receipt wakes a repair continuation with the mismatch brief", async (t) => {
  let repairBrief = "";
  const provider = cycleProvider((brief) => { repairBrief = brief; });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await askFirst(base);
  await post(sidecar, base, "/v1/snapshots", mutableSnapshot("repair-cycle-before"));
  const initial = await chatTurn(address, "rename this to Corrected");
  assert.equal(initial.outcome, "planned", JSON.stringify(initial));
  const planId = present(initial.plans[0], "plan").planId;
  await applyMismatch(sidecar, base, planId, { snapshot: "repair-cycle-after", receipt: "repair-cycle-mismatch" });
  for (let attempt = 0; attempt < 100 && !repairBrief; attempt += 1) await pause(10);
  const jobId = jobIdOf(sidecar.workflowCoordinator, planId);
  const job = present(sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId], "job");
  assert.ok(repairBrief, `repair continuation did not reach the provider; calls=${provider.calls}, run=${JSON.stringify(sidecar.workflowRuns.get(jobId))}, events=${JSON.stringify(sidecar.workflowCoordinator.workflowStore.listEvents(jobId).map((event) => event.type))}, systems=${JSON.stringify(provider.stepInputs.map((input) => input.system))}`);
  assert.equal(job.automaticRepairReopens, 1);
  assert.ok(sidecar.workflowCoordinator.workflowStore.listEvents(jobId).some((event) => event.type === "job.reopenedForRepair"));
  for (const expected of [/After Effects applied batch/, /set_layer_name/, /layer-1/, /expected Corrected/, /observed Original/, /Refresh the snapshot, inspect those target layers, and queue only fresh corrections/]) assert.match(repairBrief, expected);
});

function capProvider(continuationBriefs: string[]): MockProvider {
  return new MockProvider({ script: (input) => {
    const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
    if (input.system.includes(CONTINUATION_MARKER) && called.length === 0) continuationBriefs.push(input.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n"));
    if (!called.includes("ae_select_workflow_stage")) return workflowStageStep("repair-cap", "Repair the layer readback", ["set_layer_name"]);
    if (!called.includes("ae_queue_add")) return queueRename("repair-cap", "Corrected");
    return { text: "", toolCalls: [{ id: "repair-cap-finish", name: "ae_queue_finish", arguments: {} }] };
  } });
}

async function nextPlan(sidecar: ReadOnlySidecar, known: ReadonlySet<string>): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const planId = [...sidecar.plans.keys()].find((candidate) => !known.has(candidate));
    if (planId) return planId;
    await pause(10);
  }
  return assert.fail("repair continuation did not seal a correction plan");
}

function capMismatch(sidecar: ReadOnlySidecar, base: string, planId: string, index: number): Promise<void> {
  return applyMismatch(sidecar, base, planId, { snapshot: `repair-cap-after-${index}`, receipt: `repair-cap-mismatch-${index}` });
}

async function applyThenNextPlan(sidecar: ReadOnlySidecar, base: string, planId: string, index: number): Promise<string> {
  const known = new Set(sidecar.plans.keys());
  await capMismatch(sidecar, base, planId, index);
  return nextPlan(sidecar, known);
}

function reopensOf(sidecar: ReadOnlySidecar, planId: string): number | undefined {
  return sidecar.workflowCoordinator.workflowStore.getState().jobs[jobIdOf(sidecar.workflowCoordinator, planId)]?.automaticRepairReopens;
}

test("readback repairs stop after two automatic reopens", async (t) => {
  const continuationBriefs: string[] = [];
  const sidecar = sidecarFor({ port: 0, token, chatProvider: capProvider(continuationBriefs), quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  await askFirst(base);
  await post(sidecar, base, "/v1/snapshots", mutableSnapshot("repair-cap-before"));
  const initial = await chatTurn(address, "rename this to Corrected");
  assert.equal(initial.outcome, "planned", JSON.stringify(initial));
  let planId = present(initial.plans[0], "plan").planId;
  for (const index of [0, 1]) {
    planId = await applyThenNextPlan(sidecar, base, planId, index);
    assert.equal(reopensOf(sidecar, planId), index + 1);
  }
  await capMismatch(sidecar, base, planId, 2);

  const jobId = jobIdOf(sidecar.workflowCoordinator, planId);
  for (let attempt = 0; attempt < 200 && sidecar.workflowRuns.get(jobId)?.state !== "terminal"; attempt += 1) await pause(10);
  const job = present(sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId], "job");
  const run = present(sidecar.workflowRuns.get(jobId), "workflow run");
  assert.equal(job.automaticRepairReopens, 2);
  assert.equal(job.status, "blocked");
  assert.equal(run.state, "terminal");
  assert.equal(continuationBriefs.length, 2, "the cap prevents a third provider repair cycle");
  assert.match(sidecar.chatProgress.get(run.requestId)?.label ?? "", /Automatic repairs were already tried 2 times/);
  const cappedContinuation = sidecar.workflowCoordinator.continuation(jobId, { fingerprint: "repair-cap-after", revision: "1" }, 3);
  assert.match(cappedContinuation.blockers.join(" "), /provider:WORKFLOW_BATCH_BLOCKED/);
});
