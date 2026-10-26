// Reopening transitions: returning a blocked job to authoring after a continuation, a reconciliation, a repair or an observation cycle.

import { assert } from "../assertions.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { blockerNamesBatch, siblingBatchBlocksRecovery } from "../ownership.js";
import { batch, job, own, setRecord } from "../state.js";
import type { WorkflowBatch, WorkflowJob } from "../state-types.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";

type RepairKind = "safe" | "readback";

interface Reactivation {
  readonly job: WorkflowJob;
  readonly stageId: string | undefined;
  readonly at: string;
  readonly automaticRepairReopens: number;
}

function assertEngineFree(next: MutableWorkflowState, jobId: string): void {
  assert(next.activeDispatchLease === null, "DISPATCH_LANE_BUSY", "The workflow dispatch lane is still occupied.");
  assert(next.activeJobId === null || next.activeJobId === jobId, "DISPATCH_LANE_BUSY", "Another workflow job owns the engine.");
}

function reactivate(next: MutableWorkflowState, reactivation: Reactivation): MutableWorkflowState {
  const { job: currentJob, stageId, at } = reactivation;
  const currentStage = stageId === undefined ? undefined : next.stages[stageId];
  if (currentStage?.status === "blocked") next.stages = setRecord(next.stages, currentStage.stageId, { ...currentStage, status: "active", updatedAt: at });
  next.jobs = setRecord(next.jobs, currentJob.jobId, { ...currentJob, status: "active", blocker: null, automaticRepairReopens: reactivation.automaticRepairReopens, updatedAt: at });
  next.activeJobId = currentJob.jobId;
  return next;
}

function batchBlocksContinuation(candidate: WorkflowBatch): boolean {
  const unfinished = candidate.lifecycle !== "settled" && candidate.lifecycle !== "cancelled";
  return unfinished || candidate.execution.state === "unknown" || candidate.recovery.state === "unknown" || candidate.recovery.dispatch !== "idle";
}

const reopenForContinuation: Transition<"job.reopenedForContinuation"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  assert(currentJob.status === "blocked", "ILLEGAL_TRANSITION", "Only a blocked workflow job can reopen for continuation.");
  assert(!Object.values(next.batches).some((candidate) => candidate.jobId === event.jobId && batchBlocksContinuation(candidate)), "ILLEGAL_TRANSITION", "An unsettled or uncertain host batch prevents continuation resume.");
  assertEngineFree(next, event.jobId);
  return reactivate(next, { job: currentJob, stageId: currentJob.stageIds.at(-1), at: event.at, automaticRepairReopens: currentJob.automaticRepairReopens });
};

const reopenAfterReconciliation: Transition<"job.reopenedAfterReconciliation"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  const currentBatch = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(currentJob.status === "blocked", "ILLEGAL_TRANSITION", "Only a blocked workflow job can reopen after reconciliation.");
  assert(blockerNamesBatch(currentJob.blocker, event.batchId), "ILLEGAL_TRANSITION", "Only the reconciled batch uncertainty can reopen a workflow job.");
  assert(currentBatch.lifecycle === "settled" && currentBatch.execution.receipt !== null && currentBatch.verification.state === "verified", "ILLEGAL_TRANSITION", "A workflow job can reopen only after its batch has a verified settled receipt.");
  assert(!Object.values(next.batches).some((candidate) => siblingBatchBlocksRecovery(candidate, currentBatch)), "ILLEGAL_TRANSITION", "Another batch blocker prevents reopening this workflow job.");
  assertEngineFree(next, event.jobId);
  return reactivate(next, { job: currentJob, stageId: currentBatch.stageId, at: event.at, automaticRepairReopens: currentJob.automaticRepairReopens });
};

function safeRejectedBatch(currentBatch: WorkflowBatch): boolean {
  const execution = currentBatch.execution;
  return currentBatch.lifecycle === "settled" && execution.receipt !== null && execution.state === "rejected_before_apply" && execution.mutation === "none" && !execution.mayHaveMutated;
}

function readbackMismatchBatch(currentBatch: WorkflowBatch): boolean {
  const execution = currentBatch.execution;
  return currentBatch.lifecycle === "settled" && execution.receipt !== null && execution.state === "executed" && execution.mutation === "applied" && currentBatch.verification.state === "failed" && execution.receipt.outcomes.some((outcome) => outcome.outcome === "readback_mismatch");
}

function repairBatchKind(currentBatch: WorkflowBatch): RepairKind | undefined {
  if (safeRejectedBatch(currentBatch)) return "safe";
  return readbackMismatchBatch(currentBatch) ? "readback" : undefined;
}

function assertRepairable(next: MutableWorkflowState, event: EventOf<"job.reopenedForRepair">, currentJob: WorkflowJob, currentBatch: WorkflowBatch): RepairKind {
  assert(currentJob.status === "blocked", "ILLEGAL_TRANSITION", "Only a blocked workflow job can reopen for repair.");
  assert(blockerNamesBatch(currentJob.blocker, event.batchId), "ILLEGAL_TRANSITION", "Only the failed batch blocker can reopen a workflow job for repair.");
  const kind = repairBatchKind(currentBatch);
  assert(kind !== undefined, "ILLEGAL_TRANSITION", "A repair cycle requires either a settled host rejection with no mutation, or an executed batch with applied mutation but failed readback.");
  assert(currentJob.batchIds.at(-1) === event.batchId, "ILLEGAL_TRANSITION", "Only the latest workflow batch can be repaired.");
  assertEngineFree(next, event.jobId);
  return kind;
}

const reopenForRepair: Transition<"job.reopenedForRepair"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  const currentBatch = own(batch(next, event.batchId), event.jobId, "Batch");
  const kind = assertRepairable(next, event, currentJob, currentBatch);
  const repairs = currentJob.automaticRepairReopens + (kind === "readback" ? 1 : 0);
  return reactivate(next, { job: currentJob, stageId: currentBatch.stageId, at: event.at, automaticRepairReopens: repairs });
};

const reopenForObservation: Transition<"job.reopenedForObservation"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  const currentBatch = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(currentJob.status === "blocked", "ILLEGAL_TRANSITION", "Only a blocked workflow job can reopen for observation.");
  assert(blockerNamesBatch(currentJob.blocker, event.batchId), "ILLEGAL_TRANSITION", "Only the observed batch blocker can reopen this workflow job.");
  assert(currentBatch.lifecycle === "settled" && currentBatch.execution.state === "executed" && currentBatch.execution.mutation === "applied" && currentBatch.verification.state === "applied_unverified", "ILLEGAL_TRANSITION", "An observation cycle requires an executed applied-unverified batch.");
  assert(currentJob.batchIds.at(-1) === event.batchId, "ILLEGAL_TRANSITION", "Only the latest workflow batch can enter observation reconciliation.");
  assertEngineFree(next, event.jobId);
  return reactivate(next, { job: currentJob, stageId: currentBatch.stageId, at: event.at, automaticRepairReopens: currentJob.automaticRepairReopens });
};

/** The four ways a blocked job re-enters authoring; each demands an idle dispatch lane and a blocker naming the evidence it resolves. */
export const REOPENING_TRANSITIONS = {
  "job.reopenedForContinuation": reopenForContinuation,
  "job.reopenedAfterReconciliation": reopenAfterReconciliation,
  "job.reopenedForRepair": reopenForRepair,
  "job.reopenedForObservation": reopenForObservation,
} satisfies TransitionSlice;
