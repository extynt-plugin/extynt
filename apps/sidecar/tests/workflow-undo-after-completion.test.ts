// Tests that a completed job's card can still be undone and that undo evidence never holds the workflow engine.

import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { present } from "./agent-test-support.js";
import { at, plan, ready, verifiedReceipt } from "./workflow-coordinator-fixture.js";

function completedJob(name: string): { coordinator: WorkflowCoordinator; planId: string } {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const jobId = coordinator.openJob(name, "Rename the title layer");
  const value = plan(`${name}-batch`);
  ready(coordinator, value, name);
  coordinator.receipt(value.planId, { ...verifiedReceipt(`${name}-receipt`), planId: value.planId });
  coordinator.completeStageForContinuation(jobId);
  const continuation = coordinator.continuation(jobId, { fingerprint: `snapshot-after-${name}-receipt`, revision: "2" }, 1);
  const evidence = [{ criterionId: "goal-observed", reference: { kind: "batch_receipt" as const, batchId: present(continuation.settledBatches[0], "settled batch").batchId, receiptId: `${name}-receipt` }, satisfiedAt: at.toISOString() }];
  assert.deepEqual(coordinator.proposeCompletion(jobId, { goalDigest: continuation.goalDigest, criterionIds: ["goal-observed"], evidence }, continuation.snapshot), { ok: true });
  assert.equal(coordinator.workflowStore.getState().activeJobId, null);
  return { coordinator, planId: value.planId };
}

test("a completed job's card can still be undone, and a refused undo can be pressed again", () => {
  const { coordinator, planId } = completedJob("undo-after-completion");
  coordinator.requestUndo(planId, "snapshot-after");
  coordinator.beginUndo(planId);
  coordinator.undoReceipt(planId, { receiptId: "undo-refused", planId, operation: "undo_plan", status: "rejected", hostError: { code: "UNDO_GUARD", message: "changed" } });
  assert.equal(coordinator.workflowStore.getState().activeJobId, null);
  coordinator.requestUndo(planId, "snapshot-after");
  coordinator.beginUndo(planId);
  coordinator.undoReceipt(planId, { receiptId: "undo-done", planId, operation: "undo_plan", status: "executed", afterFingerprint: "snapshot-before", undo: { restoredPreApplyFingerprint: true } });
  assert.equal(coordinator.batchForPlan(planId)?.recovery.state, "undone");
  assert.equal(coordinator.workflowStore.getState().activeJobId, null);
});

test("an unverified undo on a completed job does not hold the workflow engine", () => {
  const { coordinator, planId } = completedJob("undo-unverified-completed");
  coordinator.requestUndo(planId, "snapshot-after");
  coordinator.beginUndo(planId);
  coordinator.undoReceipt(planId, { receiptId: "undo-mismatch", planId, operation: "undo_plan", status: "executed", afterFingerprint: "snapshot-other" });
  assert.equal(coordinator.batchForPlan(planId)?.recovery.state, "undo_unverified");
  assert.equal(coordinator.workflowStore.getState().activeJobId, null);
});

test("a new chat turn can undo the last turn's work while it holds the engine", () => {
  const { coordinator, planId } = completedJob("undo-from-next-turn");
  const turn = coordinator.openJob("undo-turn", "undo the last change");
  coordinator.requestUndo(planId, "snapshot-after");
  coordinator.beginUndo(planId);
  coordinator.undoReceipt(planId, { receiptId: "undo-next-turn", planId, operation: "undo_plan", status: "executed", afterFingerprint: "snapshot-before", undo: { restoredPreApplyFingerprint: true } });
  assert.equal(coordinator.batchForPlan(planId)?.recovery.state, "undone");
  assert.equal(coordinator.workflowStore.getState().activeJobId, turn, "the turn keeps the engine for whatever it does next");
});
