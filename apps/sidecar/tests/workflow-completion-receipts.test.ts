// Completion evidence for a job that ran several batches: one verified receipt per step, only the newest paired with the current project.
import type { JsonObject } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlan } from "@extynt/action-plan";
import type { WorkflowCompletionProposal } from "@extynt/workflow";
import { present } from "./agent-test-support.js";
import { required } from "./workflow-cycle-fixtures.js";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";

const at = new Date("2026-10-05T12:00:00.000Z");
const authority = { hostProfileId: "profile-fixture", hostBasis: "complete fixture host profile", hostSupported: true, verificationBasis: "sealed action-plan verification report", exactVerification: true, targetResolved: true, policyApprovalId: "approval-ref:fixture" } as const;

function renamePlan(planId: string, layer: number, before: string): ActionPlan {
  return {
    schemaVersion: "0.2", planId, snapshotFingerprint: before, selectionFingerprint: "selection-1", freshness: { revision: "1", capturedAt: at.toISOString() }, summary: `Rename layer ${layer}`, requiresApproval: true,
    operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: `layer-${layer}`, snapshotFingerprint: before, selectionFingerprint: "selection-1" }, name: `Layer ${layer} renamed` }],
  };
}

function verifiedReceipt(receiptId: string, planId: string, after: string): JsonObject {
  return { receiptId, planId, status: "executed", postcondition: "passed", mayHaveMutated: true, mutationState: "applied", afterFingerprint: after, verification: { state: "exact", basis: "headless fixture readback", steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis: "fixture readback" }] } };
}

function runBatch(coordinator: WorkflowCoordinator, seed: string, step: number): string {
  const value = renamePlan(`${seed}-plan-${step}`, step, `${seed}-snap-${step}`);
  assert.equal(coordinator.admitPlan(value, { jobId: seed, undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  coordinator.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.claim(value.planId);
  coordinator.executing(value.planId);
  coordinator.receipt(value.planId, verifiedReceipt(`${seed}-receipt-${step}`, value.planId, `${seed}-snap-${step + 1}`));
  coordinator.completeStageForContinuation(required(coordinator.jobIdForPlan(value.planId)));
  return value.planId;
}

interface Run { readonly coordinator: WorkflowCoordinator; readonly jobId: string; readonly planIds: string[]; readonly goalDigest: string; readonly current: { fingerprint: string; revision: string } }

function jobWithBatches(seed: string, steps: number, coordinator = new WorkflowCoordinator({ now: () => at })): Run {
  const jobId = coordinator.openJob(seed, "Rename four layers");
  const planIds = Array.from({ length: steps }, (_, index) => runBatch(coordinator, seed, index + 1));
  const current = { fingerprint: `${seed}-snap-${steps + 1}`, revision: "2" };
  return { coordinator, jobId, planIds, goalDigest: coordinator.continuation(jobId, current, steps).goalDigest, current };
}

function rowFor(run: Run, planId: string, receiptId: string): WorkflowCompletionProposal["evidence"][number] {
  const batchId = required(run.coordinator.batchForPlan(planId)).batchId;
  return { criterionId: "goal-observed", reference: { kind: "batch_receipt", batchId, receiptId }, satisfiedAt: at.toISOString() };
}

function rowsForSteps(run: Run, seed: string, steps: readonly number[]): WorkflowCompletionProposal["evidence"] {
  return steps.map((step) => rowFor(run, present(run.planIds[step - 1]), `${seed}-receipt-${step}`));
}

function propose(run: Run, evidence: WorkflowCompletionProposal["evidence"], snapshot = run.current): { ok: boolean; code?: string; message?: string } {
  return run.coordinator.proposeCompletion(run.jobId, { goalDigest: run.goalDigest, criterionIds: ["goal-observed"], evidence }, snapshot);
}

test("a four-batch job completes with one row per batch, citing every verified receipt", () => {
  const run = jobWithBatches("four-renames", 4);
  assert.deepEqual(propose(run, rowsForSteps(run, "four-renames", [1, 2, 3, 4])), { ok: true });
  const job = present(run.coordinator.workflowStore.getState().jobs[run.jobId]);
  assert.equal(job.status, "completed");
  const reference = present(job.satisfiedCriteria["goal-observed"]).reference;
  assert.equal(reference.kind === "batch_receipt" && reference.receiptId, "four-renames-receipt-4", "the criterion is recorded against the newest cited receipt, whatever the row order");
});

test("row order does not matter, and a single newest receipt still completes", () => {
  const shuffled = jobWithBatches("shuffled", 3);
  assert.deepEqual(propose(shuffled, rowsForSteps(shuffled, "shuffled", [3, 1, 2])), { ok: true });
  const single = jobWithBatches("single", 3);
  assert.deepEqual(propose(single, rowsForSteps(single, "single", [3])), { ok: true });
});

test("an outside edit after the last batch still refuses completion as unpaired", () => {
  const run = jobWithBatches("outside-edit", 4);
  const refused = propose(run, rowsForSteps(run, "outside-edit", [1, 2, 3, 4]), { fingerprint: "edited-outside", revision: "9" });
  assert.equal(refused.code, "COMPLETION_SNAPSHOT_UNPAIRED");
  assert.match(present(refused.message), /outside-edit-receipt-4.*the newest receipt you cited/);
  assert.equal(present(run.coordinator.workflowStore.getState().jobs[run.jobId]).status, "active", "a refusal commits nothing");
});

test("the newest cited receipt must be the current one: citing only earlier batches is refused", () => {
  const run = jobWithBatches("earlier-only", 4);
  const refused = propose(run, rowsForSteps(run, "earlier-only", [1, 2, 3]));
  assert.equal(refused.code, "COMPLETION_SNAPSHOT_UNPAIRED");
});

test("a criterion repeated in a later step is not refused: the same receipt cited twice counts once", () => {
  const run = jobWithBatches("repeat", 2);
  assert.deepEqual(propose(run, [...rowsForSteps(run, "repeat", [1, 2]), ...rowsForSteps(run, "repeat", [2])]), { ok: true });
});

test("a repeated criterion keeps its observation row beside receipt rows, in either order", () => {
  const observe = (name: string) => {
    const run = jobWithBatches(name, 2);
    run.coordinator.recordObservation(run.jobId, { evidenceId: "obs-1", jobId: run.jobId, kind: "structural", basis: "fixture structural readback", observedFingerprint: run.current.fingerprint, recordedAt: at.toISOString() });
    return { run, observation: { criterionId: "goal-observed", reference: { kind: "observation" as const, evidenceId: "obs-1" }, satisfiedAt: at.toISOString() } };
  };
  const first = observe("mixed-a");
  assert.deepEqual(propose(first.run, [...rowsForSteps(first.run, "mixed-a", [2]), first.observation]), { ok: true });
  const second = observe("mixed-b");
  assert.deepEqual(propose(second.run, [second.observation, ...rowsForSteps(second.run, "mixed-b", [2])]), { ok: true });
});

test("an earlier receipt from another job is refused", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const foreign = jobWithBatches("foreign-prior", 1, coordinator);
  assert.deepEqual(propose(foreign, rowsForSteps(foreign, "foreign-prior", [1])), { ok: true });
  const run = jobWithBatches("foreign-own", 2, coordinator);
  const refused = propose(run, [rowFor(foreign, present(foreign.planIds[0]), "foreign-prior-receipt-1"), ...rowsForSteps(run, "foreign-own", [2])]);
  assert.equal(refused.code, "COMPLETION_UNSATISFIED");
  assert.match(present(refused.message), /foreign-prior-receipt-1.*another job/);
});

test("an earlier receipt that was never verified is refused", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const jobId = coordinator.openJob("failed-first", "Rename two layers");
  const failed = renamePlan("failed-first-plan-0", 0, "failed-first-snap-1");
  assert.equal(coordinator.admitPlan(failed, { jobId: "failed-first", undoGroups: 1, authority }).ok, true);
  coordinator.queue(failed.planId);
  coordinator.rejectBeforeApply(failed.planId, { receiptId: "failed-first-receipt-0", planId: failed.planId, status: "rejected", postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied" });
  const failedBatch = required(coordinator.batchForPlan(failed.planId));
  coordinator.reopenForRepair(jobId, failedBatch.batchId);
  const step = runBatch(coordinator, "failed-first", 1);
  const current = { fingerprint: "failed-first-snap-2", revision: "2" };
  const run: Run = { coordinator, jobId, planIds: [step], goalDigest: coordinator.continuation(jobId, current, 2).goalDigest, current };
  const unverified = { criterionId: "goal-observed", reference: { kind: "batch_receipt" as const, batchId: failedBatch.batchId, receiptId: "failed-first-receipt-0" }, satisfiedAt: at.toISOString() };
  const refused = propose(run, [unverified, ...rowsForSteps(run, "failed-first", [1])]);
  assert.equal(refused.code, "COMPLETION_UNSATISFIED");
  assert.deepEqual(propose(run, rowsForSteps(run, "failed-first", [1])), { ok: true }, "the verified correction alone still completes the job");
});

test("an earlier receipt of a batch that was undone is refused", () => {
  const run = jobWithBatches("undone", 3);
  const undone = present(run.planIds[0]);
  run.coordinator.requestUndo(undone, "undone-snap-2");
  run.coordinator.beginUndo(undone);
  run.coordinator.undoReceipt(undone, { receiptId: "undone-undo", planId: undone, operation: "undo_plan", status: "executed", afterFingerprint: "undone-snap-1", undo: { restoredPreApplyFingerprint: true } });
  assert.equal(run.coordinator.batchForPlan(undone)?.recovery.state, "undone");
  const refused = propose(run, rowsForSteps(run, "undone", [1, 2, 3]));
  assert.equal(refused.code, "COMPLETION_UNSATISFIED");
  assert.match(present(refused.message), /undone-receipt-1.*undone/);
});
