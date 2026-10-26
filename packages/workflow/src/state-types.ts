// The workflow state tree: jobs own stages, stages own batches, batches own operations, plus the evidence the reducer retains beside them.

import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { WorkflowAdmission, WorkflowApprovalBinding, WorkflowAuthorityEvidence } from "./admission-types.js";
import type {
  WorkflowExecutionEvidence,
  WorkflowHostEvidence,
  WorkflowOperationOutcomeKind,
  WorkflowRecoveryEvidence,
  WorkflowVerificationEvidence,
  WorkflowVerificationKind,
} from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import type { WORKFLOW_ENGINE_ID, WORKFLOW_SCHEMA_VERSION } from "./limits.js";

export type WorkflowJobStatus = "open" | "active" | "blocked" | "completed" | "cancelled";
export type WorkflowStageStatus = "open" | "active" | "blocked" | "completed" | "cancelled";
export type WorkflowBatchLifecycle = "proposed" | "admitted" | "queued" | "claimed" | "executing" | "settled" | "cancelled";
export type WorkflowOperationStatus = "proposed" | "admitted" | "executed" | "verified" | "failed" | "unknown" | "cancelled";

/** The lifecycle projection of one proposed operation; the admitted payload is the immutable contract. */
export interface WorkflowOperation {
  readonly operationId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly ordinal: number;
  readonly type: string;
  readonly payload: ActionPlanV2Operation;
  readonly status: WorkflowOperationStatus;
  readonly outcome: WorkflowOperationOutcomeKind | null;
}

/** A completion criterion, optionally demanding a specific kind of evidence. */
export interface WorkflowSuccessCriterion {
  readonly criterionId: WorkflowId;
  readonly description: string;
  readonly requiredEvidenceKind?: WorkflowVerificationKind;
}

/** What a satisfied criterion points at: a settled batch receipt or a recorded observation. */
export type WorkflowCriterionReference =
  | { readonly kind: "batch_receipt"; readonly batchId: WorkflowId; readonly receiptId: string }
  | { readonly kind: "observation"; readonly evidenceId: string };

/** The reducer-derived record that a criterion was satisfied. */
export interface WorkflowCriterionEvidence {
  readonly criterionId: WorkflowId;
  readonly reference: WorkflowCriterionReference;
  readonly evidenceKind?: WorkflowVerificationKind;
  readonly satisfiedAt: string;
}

/** A typed completion claim: declared criteria plus structured evidence, never a free-form success assertion. */
export interface WorkflowCompletionProposal {
  readonly goalDigest: string;
  readonly criterionIds: readonly WorkflowId[];
  readonly evidence: readonly WorkflowCriterionEvidence[];
}

/** A structural, visual or temporal observation recorded outside a batch receipt. */
export interface WorkflowObservationEvidence {
  readonly evidenceId: string;
  readonly jobId: WorkflowId;
  readonly stageId?: WorkflowId;
  readonly kind: "structural" | "visual" | "temporal";
  readonly basis: string;
  readonly observedFingerprint?: string;
  readonly captureId?: string;
  readonly compositionId?: string;
  readonly time?: number;
  readonly recordedAt: string;
}

/** The size limits a job was opened with. */
export interface WorkflowJobConstraints {
  readonly maxStages: number;
  readonly maxBatches: number;
  readonly maxOperations: number;
}

/** One batch: a sealed group of operations with its lifecycle and independent execution, verification and recovery evidence. */
export interface WorkflowBatch {
  readonly batchId: WorkflowId;
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly lifecycle: WorkflowBatchLifecycle;
  readonly summary: string;
  readonly dependencies: readonly WorkflowId[];
  readonly operationIds: readonly WorkflowId[];
  readonly admission: WorkflowAdmission | null;
  readonly approval: WorkflowApprovalBinding | null;
  readonly execution: WorkflowExecutionEvidence;
  readonly verification: WorkflowVerificationEvidence;
  readonly recovery: WorkflowRecoveryEvidence;
  readonly cancelRequested: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One stage of a job, with its own success criteria. */
export interface WorkflowStage {
  readonly stageId: WorkflowId;
  readonly jobId: WorkflowId;
  readonly title: string;
  readonly purpose: string;
  readonly successCriteria: readonly WorkflowSuccessCriterion[];
  readonly satisfiedCriteria: Readonly<Record<WorkflowId, WorkflowCriterionEvidence>>;
  readonly status: WorkflowStageStatus;
  readonly batchIds: readonly WorkflowId[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One multi-stage job; `providerCycle` and `automaticRepairReopens` advance only through reducer-owned events. */
export interface WorkflowJob {
  readonly jobId: WorkflowId;
  readonly engineId: typeof WORKFLOW_ENGINE_ID;
  readonly title: string;
  readonly goalSummary: string;
  readonly constraints: WorkflowJobConstraints;
  readonly successCriteria: readonly WorkflowSuccessCriterion[];
  readonly satisfiedCriteria: Readonly<Record<WorkflowId, WorkflowCriterionEvidence>>;
  readonly status: WorkflowJobStatus;
  readonly stageIds: readonly WorkflowId[];
  readonly batchIds: readonly WorkflowId[];
  readonly cancellationRequested: boolean;
  readonly undoOpened: boolean;
  readonly providerCycle: number;
  readonly automaticRepairReopens: number;
  readonly blocker: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Who holds the shared host dispatch lane: an apply or an undo of one batch. */
export interface WorkflowDispatchLease {
  readonly kind: "apply" | "undo";
  readonly jobId: WorkflowId;
  readonly batchId: WorkflowId;
}

/** The complete reducer-owned state. At most one dispatch lease exists and at most one non-terminal job owns the engine. */
export interface WorkflowState {
  readonly schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  readonly resumeSupported: boolean;
  readonly jobs: Readonly<Record<WorkflowId, WorkflowJob>>;
  readonly stages: Readonly<Record<WorkflowId, WorkflowStage>>;
  readonly batches: Readonly<Record<WorkflowId, WorkflowBatch>>;
  readonly operations: Readonly<Record<WorkflowId, WorkflowOperation>>;
  readonly authorityEvidence: Readonly<Record<string, WorkflowAuthorityEvidence>>;
  readonly observations: Readonly<Record<string, WorkflowObservationEvidence>>;
  readonly hostEvidence: Readonly<Record<string, WorkflowHostEvidence>>;
  readonly activeDispatchLease: WorkflowDispatchLease | null;
  readonly activeJobId: WorkflowId | null;
  readonly eventSignatures: Readonly<Record<string, string>>;
}
