// The compact, transcript-free input handed to a fresh model cycle, and the restart classification of batches.

import type { WorkflowCapabilityDisclosure } from "./admission-types.js";
import type {
  WorkflowCreatedBinding,
  WorkflowExecutionState,
  WorkflowMutationState,
  WorkflowOperationOutcome,
  WorkflowReceipt,
  WorkflowVerificationCoverage,
  WorkflowVerificationKind,
  WorkflowVerificationState,
} from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import type { WORKFLOW_SCHEMA_VERSION } from "./limits.js";
import type { WorkflowBatchLifecycle, WorkflowJobConstraints, WorkflowStageStatus } from "./state-types.js";

export type WorkflowRestartDisposition = "safe_to_resume" | "blocked_uncertain" | "settled";
export type WorkflowRecoveryAction = "none" | "fresh_explicit_authorization" | "explicit_reconciliation" | "user_review";

/** One operation's outcome as the model sees it. */
export type WorkflowContinuationOperationEvidence = WorkflowOperationOutcome;

/** The snapshot a continuation is anchored to. */
export interface WorkflowContinuationSnapshot {
  readonly fingerprint: string;
  readonly revision: string | null;
}

/** A receipt reduced to the facts a model may reason about. */
export interface WorkflowContinuationReceiptEvidence {
  readonly receiptId: string;
  readonly execution: WorkflowReceipt["execution"];
  readonly mutation: WorkflowMutationState;
  readonly verification: WorkflowVerificationState;
  readonly mayHaveMutated: boolean;
  readonly receivedAt: string;
  readonly outcomes: readonly WorkflowContinuationOperationEvidence[];
}

/** A batch reduced to lifecycle, evidence and verification coverage. */
export interface WorkflowContinuationBatchEvidence {
  readonly batchId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly sourcePlanId?: WorkflowId;
  readonly lifecycle: WorkflowBatchLifecycle;
  readonly execution: WorkflowExecutionState;
  readonly mutation: WorkflowMutationState;
  readonly verification: WorkflowVerificationState;
  readonly verificationCoverage: WorkflowVerificationCoverage;
  readonly receipt: WorkflowContinuationReceiptEvidence | null;
}

/** A criterion with its machine id in its own field: the model echoes `criterionId`, never the prose, to complete it. */
export interface WorkflowContinuationCriterion {
  readonly criterionId: WorkflowId;
  readonly description: string;
  readonly requiredEvidenceKind?: WorkflowVerificationKind;
}

/** Compact, sidecar-owned input for a fresh model cycle: prompts, reasoning, tool arguments and secrets have no field in it. */
export interface WorkflowContinuationInput {
  readonly schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  readonly jobId: WorkflowId;
  readonly goalSummary: string;
  readonly goalDigest: string;
  readonly stageId: WorkflowId;
  readonly stageStatus: WorkflowStageStatus;
  readonly cycle: number;
  readonly batchCount: number;
  readonly snapshot: WorkflowContinuationSnapshot;
  readonly activeBatch: WorkflowContinuationBatchEvidence | null;
  readonly settledBatches: readonly WorkflowContinuationBatchEvidence[];
  readonly createdIdBindings: readonly (WorkflowCreatedBinding & { readonly sourceBatchId: WorkflowId })[];
  readonly unresolvedCriteria: readonly WorkflowContinuationCriterion[];
  readonly blockers: readonly string[];
  readonly limits: WorkflowJobConstraints;
  readonly capabilities?: WorkflowCapabilityDisclosure;
}

/** Descriptive restart classification of one batch; it never authorizes a host dispatch. */
export interface WorkflowBatchRecoveryClassification {
  readonly batchId: WorkflowId;
  readonly disposition: WorkflowRestartDisposition;
  readonly reason: string;
  readonly action: WorkflowRecoveryAction;
  readonly automaticDispatch: false;
}

/** Restart classification of every batch in a state. */
export interface WorkflowRecoveryReport {
  readonly resumeSupported: boolean;
  readonly automaticDispatchResumeSupported: false;
  readonly batches: readonly WorkflowBatchRecoveryClassification[];
}
