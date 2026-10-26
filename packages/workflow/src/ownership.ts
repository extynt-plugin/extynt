// Engine ownership: who holds the dispatch lease, when a job may release the global engine, and how a batch's uncertainty blocks or reopens its owners.

import type { MutableWorkflowState } from "./frozen-state.js";
import { RESOLVED_RECOVERY, setRecord } from "./state.js";
import type { WorkflowBatch, WorkflowDispatchLease, WorkflowJob, WorkflowState } from "./state-types.js";

const LIVE_DISPATCH: ReadonlySet<string> = new Set(["claimed", "executing"]);
const UNSETTLED_RECOVERY: ReadonlySet<string> = new Set(["unknown", "blocked", "undo_unverified", "requested"]);
const OPEN_UNDO_RECOVERY: ReadonlySet<string> = new Set(["available", "requested"]);

/** Whether the shared dispatch lease is held as `kind` by exactly this job and batch. */
export function leaseOwns(state: WorkflowState, kind: WorkflowDispatchLease["kind"], jobId: string, batchId: string): boolean {
  const lease = state.activeDispatchLease;
  return lease?.kind === kind && lease.jobId === jobId && lease.batchId === batchId;
}

/** Whether a blocker string names the given batch; the blocker is `batch:<id>:<execution>:<verification>`. */
export function blockerNamesBatch(blocker: string | null, batchId: string): boolean {
  return blocker?.startsWith(`batch:${batchId}:`) === true;
}

function batchHostWorkSettled(current: WorkflowBatch): boolean {
  const finished = current.lifecycle === "settled" || current.lifecycle === "cancelled";
  return finished && !UNSETTLED_RECOVERY.has(current.recovery.state) && !LIVE_DISPATCH.has(current.recovery.dispatch);
}

/** Whether the job holds the lease or has a batch whose apply or undo is claimed or executing; a lease is the only state that stops another job from safely starting. */
export function jobHasLiveHostWork(state: WorkflowState, current: WorkflowJob): boolean {
  if (state.activeDispatchLease?.jobId === current.jobId) return true;
  return current.batchIds.some((batchId) => {
    const candidate = state.batches[batchId];
    return candidate !== undefined && (LIVE_DISPATCH.has(candidate.lifecycle) || LIVE_DISPATCH.has(candidate.recovery.dispatch));
  });
}

function undoSessionIdle(currentBatch: WorkflowBatch): boolean {
  return !LIVE_DISPATCH.has(currentBatch.recovery.dispatch) && !OPEN_UNDO_RECOVERY.has(currentBatch.recovery.state);
}

function completedJobMayRelease(state: WorkflowState, current: WorkflowJob): boolean {
  return current.batchIds.every((batchId) => {
    const currentBatch = state.batches[batchId];
    if (!currentBatch) return false;
    return current.undoOpened ? undoSessionIdle(currentBatch) : batchHostWorkSettled(currentBatch);
  });
}

function jobMayRelease(state: WorkflowState, current: WorkflowJob): boolean {
  if (current.status === "completed") return completedJobMayRelease(state, current);
  if (current.status === "blocked") return !jobHasLiveHostWork(state, current);
  return current.status === "cancelled" && !jobHasLiveHostWork(state, current);
}

/**
 * Releases the global engine from the job when no lease is held and the job may let go. A completed job releases once
 * its host work is settled, or, in an undo session, once no host call is live. A blocked job keeps all of its evidence,
 * uncertain receipts included, but releases the engine once no lease is live, so an uncertain batch never bricks
 * unrelated jobs; only an explicit late reconciliation changes it.
 */
export function releaseActiveJobIfSafe(next: MutableWorkflowState, jobId: string): void {
  if (next.activeJobId !== jobId || next.activeDispatchLease !== null) return;
  const current = next.jobs[jobId];
  if (current && jobMayRelease(next, current)) next.activeJobId = null;
}

/** Blocks the batch's stage and job, recording the batch uncertainty as the job blocker. */
export function blockOwners(next: MutableWorkflowState, current: WorkflowBatch, at: string): void {
  const currentStage = next.stages[current.stageId];
  const currentJob = next.jobs[current.jobId];
  if (currentStage && currentStage.status !== "cancelled" && currentStage.status !== "completed") next.stages = setRecord(next.stages, current.stageId, { ...currentStage, status: "blocked", updatedAt: at });
  if (currentJob && currentJob.status !== "cancelled" && currentJob.status !== "completed") next.jobs = setRecord(next.jobs, current.jobId, { ...currentJob, status: "blocked", blocker: `batch:${current.batchId}:${current.execution.state}:${current.verification.state}`, updatedAt: at });
}

/** Whether another batch of the same job is unverified, has unresolved recovery or has recovery dispatch in flight, which keeps the job closed. */
export function siblingBatchBlocksRecovery(candidate: WorkflowBatch, current: WorkflowBatch): boolean {
  if (candidate.jobId !== current.jobId || candidate.batchId === current.batchId) return false;
  if (candidate.lifecycle === "settled" && candidate.verification.state !== "verified") return true;
  return !RESOLVED_RECOVERY.has(candidate.recovery.state) || candidate.recovery.dispatch !== "idle";
}

function stageHasUnverifiedSettledSibling(next: MutableWorkflowState, current: WorkflowBatch): boolean {
  return Object.values(next.batches).some((candidate) => candidate.stageId === current.stageId && candidate.batchId !== current.batchId && candidate.lifecycle === "settled" && candidate.verification.state !== "verified");
}

function reopenStageAfterReconciliation(next: MutableWorkflowState, current: WorkflowBatch, at: string): void {
  const currentStage = next.stages[current.stageId];
  if (currentStage?.status !== "blocked" || stageHasUnverifiedSettledSibling(next, current)) return;
  next.stages = setRecord(next.stages, current.stageId, { ...currentStage, status: "active", updatedAt: at });
}

function reopenJobAfterReconciliation(next: MutableWorkflowState, current: WorkflowBatch, at: string): void {
  const currentJob = next.jobs[current.jobId];
  if (currentJob?.status !== "blocked" || !blockerNamesBatch(currentJob.blocker, current.batchId)) return;
  if (next.activeJobId !== null && next.activeJobId !== current.jobId) return;
  next.activeJobId = current.jobId;
  next.jobs = setRecord(next.jobs, current.jobId, { ...currentJob, status: "active", blocker: null, updatedAt: at });
}

/**
 * Reopens the batch's stage and job after a verified reconciliation. Only the narrow batch uncertainty the
 * reconciliation resolves reopens the job (provider, no-batch and cancellation blockers are independent terminal
 * decisions), and it reclaims the engine only when no unrelated job owns it.
 */
export function refreshOwnersAfterReconciliation(next: MutableWorkflowState, current: WorkflowBatch, at: string): void {
  if (current.verification.state !== "verified") return;
  if (Object.values(next.batches).some((candidate) => siblingBatchBlocksRecovery(candidate, current))) return;
  reopenStageAfterReconciliation(next, current, at);
  reopenJobAfterReconciliation(next, current, at);
}
