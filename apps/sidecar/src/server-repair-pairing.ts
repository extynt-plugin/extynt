// Whether a settled workflow batch's receipt is paired with the project as it stands, so a continuation or a correction may build on it.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { WorkflowBatch, WorkflowId } from "@extynt/workflow";

/** True for a batch of this job that settled with a verified result. */
export function validVerifiedBatch(batch: WorkflowBatch | null, jobId: WorkflowId): batch is WorkflowBatch {
  return !!batch && batch.jobId === jobId && batch.lifecycle === "settled" && batch.verification.state === "verified";
}

/** The fingerprint the batch's verification or receipt observed after the apply. */
export function pairedReceipt(batch: WorkflowBatch): string | null {
  return batch.verification.observedFingerprint ?? batch.execution.receipt?.observedFingerprint ?? null;
}

function settledBatchWithReceipt(batch: WorkflowBatch | null, jobId: WorkflowId): batch is WorkflowBatch {
  return !!batch && batch.jobId === jobId && batch.lifecycle === "settled" && batch.execution.receipt !== null;
}

function safeRejectedBatch(batch: WorkflowBatch): boolean {
  return batch.execution.state === "rejected_before_apply" && batch.execution.mutation === "none" && !batch.execution.mayHaveMutated;
}

function readbackMismatchBatch(batch: WorkflowBatch): boolean {
  const receipt = batch.execution.receipt;
  return batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "failed" && receipt !== null && receipt.outcomes.some((outcome) => outcome.outcome === "readback_mismatch");
}

function settledRepairBatch(batch: WorkflowBatch | null, jobId: WorkflowId): batch is WorkflowBatch {
  return settledBatchWithReceipt(batch, jobId) && (safeRejectedBatch(batch) || readbackMismatchBatch(batch));
}

/** True for a batch of this job that executed and applied but could not be verified, which only a read-only look can settle. */
export function settledObservationBatch(batch: WorkflowBatch | null, jobId: WorkflowId): batch is WorkflowBatch {
  return !!batch && batch.jobId === jobId && batch.lifecycle === "settled" && batch.execution.receipt !== null && batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "applied_unverified";
}

/** True when a failed or unverified batch's receipt names the fingerprint of the project now, or a rejected batch changed nothing since its preflight. */
export function repairBatchMatchesCurrent(batch: WorkflowBatch | null, jobId: WorkflowId, latest: ProjectSnapshot | undefined): boolean {
  if ((!settledRepairBatch(batch, jobId) && !settledObservationBatch(batch, jobId)) || !latest) return false;
  const receiptFingerprint = pairedReceipt(batch);
  const unchangedPreflight = batch.execution.mutation === "none" && batch.execution.mayHaveMutated === false && batch.admission?.snapshotFingerprint === latest.fingerprint;
  return receiptFingerprint === latest.fingerprint || unchangedPreflight;
}
