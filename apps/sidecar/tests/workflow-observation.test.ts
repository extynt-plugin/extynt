// Test that an applied-unverified stage reopens only for a same-stage visual observation and never rewrites its receipt.

import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { at, batchOf, jobIdOf, plan, ready } from "./workflow-coordinator-fixture.js";

test("an applied-unverified stage reopens only for same-stage visual observation without rewriting its receipt", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("observe-applied-stage");
  ready(coordinator, value);
  coordinator.receipt(value.planId, { planId: value.planId, status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after-observation" });
  const jobId = jobIdOf(coordinator, value.planId);
  const batch = batchOf(coordinator, value.planId);
  const { stageId } = batch;
  coordinator.completeStageForContinuation(jobId);
  assert.equal(coordinator.workflowStore.getState().stages[stageId]?.status, "blocked", "a blocked stage cannot be completed by a stray continuation call");
  coordinator.reopenForObservation(jobId, batch.batchId);
  assert.throws(() => coordinator.completeStageForContinuation(jobId), /cannot complete/, "reopening alone is not visual proof");
  coordinator.recordObservation(jobId, { evidenceId: "observation:observe-applied-stage", jobId, stageId, kind: "visual", basis: "Rendered-frame observation fixture.", observedFingerprint: "snapshot-after-observation", recordedAt: at.toISOString() });
  coordinator.completeStageForContinuation(jobId);

  assert.equal(coordinator.workflowStore.getState().stages[stageId]?.status, "completed");
  assert.equal(coordinator.batchForPlan(value.planId)?.verification.state, "applied_unverified", "visual reconciliation must not forge structural receipt verification");
});
