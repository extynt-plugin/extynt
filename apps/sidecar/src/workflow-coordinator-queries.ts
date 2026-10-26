// Pure questions about the workflow state: which job is stranded, which batch is unproved, and which late receipts may still be accepted.

import type { WorkflowBatch, WorkflowId, WorkflowJob, WorkflowState } from "@extynt/workflow";

const SETTLED_LIFECYCLES: readonly WorkflowBatch["lifecycle"][] = ["settled", "cancelled"];

function isLive(job: WorkflowJob): boolean {
  return job.status === "open" || job.status === "active";
}

function activeJobOf(state: WorkflowState): WorkflowJob | undefined {
  const jobId = state.activeJobId;
  const job = jobId ? state.jobs[jobId] : undefined;
  return job && isLive(job) && state.activeDispatchLease === null ? job : undefined;
}

function awaitsApproval(batch: WorkflowBatch): boolean {
  const policy = batch.admission?.dimensions.policy;
  return batch.lifecycle === "queued" && batch.approval === null && policy?.decision === "manual" && policy.approvalId === undefined;
}

function finishedIdle(batch: WorkflowBatch): boolean {
  return (batch.lifecycle === "cancelled" || batch.lifecycle === "settled") && batch.recovery.dispatch === "idle" && batch.execution.state !== "unknown" && batch.recovery.state !== "unknown";
}

function inFlight(batch: WorkflowBatch | undefined): boolean {
  return !batch || !SETTLED_LIFECYCLES.includes(batch.lifecycle) || batch.execution.state === "unknown" || batch.recovery.state === "unknown" || batch.recovery.dispatch !== "idle";
}

/** The live job a previous process left mid-authoring with no live, unsettled or uncertain host batch, or null. */
export function interruptedActiveJobId(state: WorkflowState): WorkflowId | null {
  const job = activeJobOf(state);
  return job && !job.batchIds.some((batchId) => inFlight(state.batches[batchId])) ? job.jobId : null;
}

/** The engine owner whose only remaining work is a manual-policy batch waiting for a panel approval nobody has given, or null. */
export function staleApprovalOwnerId(state: WorkflowState): WorkflowId | null {
  const job = activeJobOf(state);
  if (!job) return null;
  const batches = job.batchIds.map((batchId) => state.batches[batchId]);
  const settled = batches.every((batch) => batch !== undefined && (awaitsApproval(batch) || finishedIdle(batch)));
  return settled && batches.some((batch) => batch !== undefined && awaitsApproval(batch)) ? job.jobId : null;
}

/** The current stage's batch that After Effects applied, that read-back could not prove, and that no observation has covered yet. */
export function unprovedAppliedBatch(state: WorkflowState, jobId: WorkflowId): WorkflowBatch | undefined {
  const job = state.jobs[jobId];
  const stage = job ? state.stages[job.stageIds.at(-1) ?? ""] : undefined;
  if (!stage || stage.status === "completed" || stage.status === "cancelled") return undefined;
  return stage.batchIds.map((batchId) => state.batches[batchId]).find((batch): batch is WorkflowBatch => !!batch && batch.lifecycle === "settled"
    && batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "applied_unverified");
}

/** Whether a late host receipt may still reconcile this batch: only an uncertain or applied-but-unverified settlement, never a known refusal. */
export function acceptsLateReceiptReconciliation(batch: WorkflowBatch | null): boolean {
  return batch?.lifecycle === "settled" && (batch.execution.state === "unknown" || (batch.execution.state === "executed" && batch.verification.state === "applied_unverified"));
}

/** Whether a host receipt may still arrive for this batch because its dispatch is in flight. */
export function acceptsLateExecutionReceipt(batch: WorkflowBatch | null): boolean {
  return !!batch && (batch.lifecycle === "claimed" || batch.lifecycle === "executing") && batch.execution.receipt === null;
}

/** Whether a late undo receipt may still reconcile this batch's uncertain undo. */
export function acceptsLateUndoReconciliation(batch: WorkflowBatch | null): boolean {
  return batch?.lifecycle === "settled" && batch.recovery.dispatch === "idle" && (batch.recovery.state === "unknown" || batch.recovery.state === "undo_unverified");
}

/** The approval already bound to the batch, when it is not the exact claim being made. */
export function approvalConflict(batch: WorkflowBatch, claim: { readonly approvalId: string; readonly snapshotFingerprint: string; readonly sourcePlanDigest: string }): boolean {
  const approval = batch.approval;
  if (!approval) return false;
  return approval.approvalId !== claim.approvalId || approval.snapshotFingerprint !== claim.snapshotFingerprint || approval.sourcePlanDigest !== claim.sourcePlanDigest;
}
