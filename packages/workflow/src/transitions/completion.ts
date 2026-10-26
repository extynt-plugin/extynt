// Completion transitions: completing a stage or job once its evidence is verified, and cancelling a job with all of its unfinished work.

import { assert, fail } from "../assertions.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { releaseActiveJobIfSafe } from "../ownership.js";
import { stageBatchesConfirmed } from "../stage-confirmation.js";
import {
  UNDISPATCHED_LIFECYCLES,
  allCriteriaSatisfied,
  hasPendingRecovery,
  hasUnsettledBatches,
  job,
  own,
  setRecord,
  stage,
  updateOperationStatuses,
} from "../state.js";
import type { WorkflowBatch, WorkflowStage } from "../state-types.js";
import type { Transition, TransitionSlice } from "../transition-table.js";

function verifiedStageBatches(next: MutableWorkflowState, currentStage: WorkflowStage): boolean {
  const batches = currentStage.batchIds.map((batchId) => next.batches[batchId]);
  const visuallyObserved = (candidate: WorkflowBatch): boolean => candidate.verification.observedFingerprint !== null
    && Object.values(next.observations).some((evidence) => evidence.stageId === currentStage.stageId && evidence.kind === "visual" && evidence.observedFingerprint === candidate.verification.observedFingerprint);
  return stageBatchesConfirmed(batches, visuallyObserved, next.operations);
}

const completeStage: Transition<"stage.completed"> = (next, event) => {
  const currentStage = own(stage(next, event.stageId), event.jobId, "Stage");
  assert(currentStage.status !== "blocked", "ILLEGAL_TRANSITION", "Blocked stages cannot complete; blocked means stopped.");
  assert(!hasPendingRecovery(next, currentStage.batchIds), "ILLEGAL_TRANSITION", "A stage cannot complete while recovery is pending or blocked.");
  const currentJob = job(next, event.jobId);
  assert(currentStage.status === "active", "ILLEGAL_TRANSITION", "Only an active stage can complete.");
  assert(allCriteriaSatisfied(currentStage.successCriteria, currentStage.satisfiedCriteria), "ILLEGAL_TRANSITION", "Every declared stage criterion must be satisfied with evidence.");
  assert(!hasUnsettledBatches(next, currentStage), "ILLEGAL_TRANSITION", "A stage cannot complete while a batch is unsettled.");
  assert(verifiedStageBatches(next, currentStage), "ILLEGAL_TRANSITION", "A stage requires every batch to settle with verified evidence; cancellation is not success.");
  next.stages = setRecord(next.stages, event.stageId, { ...currentStage, status: "completed", updatedAt: event.at });
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, updatedAt: event.at });
  return next;
};

const completeJob: Transition<"job.completed"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  assert(!hasPendingRecovery(next, currentJob.batchIds), "ILLEGAL_TRANSITION", "A job cannot complete while recovery is pending or blocked.");
  assert(currentJob.status !== "cancelled", "ILLEGAL_TRANSITION", "A cancelled job cannot complete.");
  assert(allCriteriaSatisfied(currentJob.successCriteria, currentJob.satisfiedCriteria), "ILLEGAL_TRANSITION", "Every declared job criterion must be satisfied with evidence.");
  assert(currentJob.stageIds.length > 0, "ILLEGAL_TRANSITION", "A job cannot complete without a stage.");
  assert(currentJob.stageIds.every((stageId) => next.stages[stageId]?.status === "completed"), "ILLEGAL_TRANSITION", "Every stage must complete before the job completes.");
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, status: "completed", updatedAt: event.at });
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

function cancelBatchWork(next: MutableWorkflowState, current: WorkflowBatch, at: string): void {
  if (UNDISPATCHED_LIFECYCLES.has(current.lifecycle)) {
    next.batches = setRecord(next.batches, current.batchId, { ...current, lifecycle: "cancelled", cancelRequested: true, updatedAt: at });
    updateOperationStatuses(next, current, "cancelled");
  } else if (current.lifecycle === "claimed" || current.lifecycle === "executing") {
    next.batches = setRecord(next.batches, current.batchId, { ...current, cancelRequested: true, updatedAt: at });
  }
}

function closePendingRecovery(next: MutableWorkflowState, batchId: string, at: string): void {
  const current = next.batches[batchId] ?? fail("NOT_FOUND", `Batch ${batchId} does not exist.`);
  const recovery = current.recovery;
  if (recovery.state !== "requested" || recovery.dispatch !== "idle") return;
  next.batches = setRecord(next.batches, batchId, { ...current, recovery: { ...recovery, state: "blocked", dispatch: "idle", mayHaveMutated: false, undoReceiptId: null, receipt: null, verification: "unavailable" }, updatedAt: at });
}

function cancelStage(next: MutableWorkflowState, stageId: string, at: string): void {
  const currentStage = next.stages[stageId];
  if (currentStage && currentStage.status !== "completed") next.stages = setRecord(next.stages, stageId, { ...currentStage, status: "cancelled", updatedAt: at });
}

const cancelJob: Transition<"job.cancelled"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  assert(currentJob.status !== "completed", "ILLEGAL_TRANSITION", "A completed job cannot be cancelled.");
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, status: "cancelled", cancellationRequested: true, updatedAt: event.at });
  for (const batchId of currentJob.batchIds) {
    cancelBatchWork(next, next.batches[batchId] ?? fail("NOT_FOUND", `Batch ${batchId} does not exist.`), event.at);
    closePendingRecovery(next, batchId, event.at);
  }
  for (const stageId of currentJob.stageIds) cancelStage(next, stageId, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

export const COMPLETION_TRANSITIONS = {
  "stage.completed": completeStage,
  "job.completed": completeJob,
  "job.cancelled": cancelJob,
} satisfies TransitionSlice;
