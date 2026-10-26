// Receipt and evidence vocabularies of the workflow model: execution, mutation, verification and recovery facts, kept separate from lifecycle state.

import type { WorkflowId } from "./identity.js";

export type WorkflowExecutionState = "not_started" | "queued" | "claimed" | "applying" | "executed" | "rejected_before_apply" | "failed_during_apply" | "unknown";
export type WorkflowMutationState = "none" | "applied" | "may_have_mutated" | "unknown";
export type WorkflowVerificationState = "not_requested" | "verified" | "applied_unverified" | "failed" | "unknown";
export type WorkflowVerificationKind = "structural" | "host_evidence" | "visual" | "temporal";
export type WorkflowPostconditionState = "passed" | "failed" | "unavailable" | "not_evaluated";
export type WorkflowRecoveryState = "none" | "available" | "requested" | "undone" | "undo_unverified" | "blocked" | "unknown";
export type WorkflowOperationOutcomeKind = "confirmed" | "host_confirmed" | "coerced_equivalent" | "applied_unconfirmed" | "readback_mismatch" | "rejected_before_apply" | "failed_during_apply" | "applied_before_failure" | "not_attempted" | "unknown";
type WorkflowUndoVerification = "restored" | "mismatch" | "undo_unverified" | "unavailable" | "unknown";

/** Structured read-back facts observed for one operation. */
export interface WorkflowReadbackEvidence {
  readonly targetLayerId?: string;
  readonly expected?: string;
  readonly observed?: string;
}

/** One operation's result inside a receipt. */
export interface WorkflowOperationOutcome {
  readonly operationId: WorkflowId;
  readonly ordinal: number;
  readonly type: string;
  readonly outcome: WorkflowOperationOutcomeKind;
  readonly mutation: WorkflowMutationState;
  readonly verification: WorkflowVerificationState;
  readonly mayHaveMutated: boolean;
  readonly basis?: string;
  readonly observedFingerprint?: string;
  readonly readback?: WorkflowReadbackEvidence;
}

/** A verifier contract a batch declares at admission. */
export interface WorkflowPostconditionContract {
  readonly postconditionId: WorkflowId;
  readonly kind: WorkflowVerificationKind;
  readonly description: string;
  readonly required: boolean;
}

/** What a receipt reports for one declared postcondition. */
export interface WorkflowPostconditionEvidence {
  readonly postconditionId: WorkflowId;
  readonly kind: WorkflowVerificationKind;
  readonly state: WorkflowPostconditionState;
  readonly basis: string;
  readonly observedFingerprint?: string;
}

/** Receipt-backed evidence retained for host capability policy. */
export interface WorkflowHostEvidence {
  readonly evidenceId: WorkflowId;
  readonly jobId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly operationId?: WorkflowId;
  readonly kind: WorkflowVerificationKind;
  readonly basis: string;
  readonly observedFingerprint?: string;
  readonly recordedAt: string;
}

/**
 * Executable evidence that a creator operation produced a host identity. It rides on a receipt only when the creator
 * is verified, so an unverified or uncertain creator never makes a later placeholder resolvable.
 */
export interface WorkflowCreatedBinding {
  readonly placeholder: string;
  readonly createdId: string;
  readonly operationId: WorkflowId;
  readonly readbackField: string;
  readonly observedFingerprint: string;
}

/** The host's complete report for an apply attempt. */
export interface WorkflowReceipt {
  readonly receiptId: string;
  readonly receivedAt: string;
  readonly execution: Exclude<WorkflowExecutionState, "not_started" | "queued" | "claimed" | "applying">;
  readonly mutation: WorkflowMutationState;
  readonly mayHaveMutated: boolean;
  readonly verification: WorkflowVerificationState;
  readonly verificationBasis?: string;
  readonly observedFingerprint?: string;
  readonly postconditions?: readonly WorkflowPostconditionEvidence[];
  readonly hostEvidence?: readonly WorkflowHostEvidence[];
  readonly outcomes: readonly WorkflowOperationOutcome[];
  readonly createdBindings?: readonly WorkflowCreatedBinding[];
}

/** The host's report for an undo attempt. */
export interface WorkflowUndoReceipt {
  readonly receiptId: string;
  readonly status: "executed" | "rejected" | "unknown";
  readonly receivedAt: string;
  readonly restoredFingerprint?: string;
  readonly basis?: string;
  readonly verification: WorkflowUndoVerification;
}

/** What the reducer holds about a batch's apply attempt, including the immutable receipt history. */
export interface WorkflowExecutionEvidence {
  readonly state: WorkflowExecutionState;
  readonly mutation: WorkflowMutationState;
  readonly mayHaveMutated: boolean;
  readonly receiptId: string | null;
  readonly receivedAt: string | null;
  readonly receipt: WorkflowReceipt | null;
  readonly receiptHistory: readonly WorkflowReceipt[];
}

/** What the reducer holds about a batch's verification. */
export interface WorkflowVerificationEvidence {
  readonly state: WorkflowVerificationState;
  readonly basis: string | null;
  readonly observedFingerprint: string | null;
  readonly postconditions?: readonly WorkflowPostconditionEvidence[];
}

/**
 * Orthogonal verification facts. Application, host read-back, rendered-frame inspection and sampled motion are not
 * collapsed into one bit: a write receipt cannot prove appearance or motion quality.
 */
export interface WorkflowVerificationCoverage {
  readonly applied: boolean;
  readonly readback: boolean;
  readonly visual: boolean;
  readonly temporal: boolean;
}

/** Which undo unit restores which batch, and the fingerprints on either side. */
export interface WorkflowUndoLineage {
  readonly targetBatchId: WorkflowId;
  readonly undoUnitId: WorkflowId;
  readonly expectedFingerprint: string;
  readonly restoredFingerprint: string | null;
}

/** What the reducer holds about a batch's undo path, including the immutable undo receipt. */
export interface WorkflowRecoveryEvidence {
  readonly state: WorkflowRecoveryState;
  readonly dispatch: "idle" | "claimed" | "executing";
  readonly mayHaveMutated: boolean;
  readonly undoReceiptId: string | null;
  readonly lineage: WorkflowUndoLineage | null;
  readonly receipt: WorkflowUndoReceipt | null;
  readonly verification: WorkflowUndoVerification | null;
}
