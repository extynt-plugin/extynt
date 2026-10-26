// The closed union of workflow events and the one error-code vocabulary a rejected event can carry.

import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { WorkflowAdmissionDimensions, WorkflowAuthorityEvidence } from "./admission-types.js";
import type { WorkflowPostconditionContract, WorkflowReceipt, WorkflowUndoReceipt } from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import type { WORKFLOW_ENGINE_ID } from "./limits.js";
import type { WorkflowCriterionReference, WorkflowJobConstraints, WorkflowObservationEvidence, WorkflowSuccessCriterion } from "./state-types.js";

export type WorkflowErrorCode =
  | "INVALID_EVENT"
  | "DUPLICATE_EVENT_CONFLICT"
  | "EVENT_LOG_FULL"
  | "LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "WRONG_OWNER"
  | "ILLEGAL_TRANSITION"
  | "DISPATCH_LANE_BUSY"
  | "DEPENDENCY_BLOCKED"
  | "IMMUTABLE_ADMISSION"
  | "INVALID_UNDO_UNIT"
  | "INVALID_RECEIPT";

interface EventBase { readonly eventId: string; readonly at: string; readonly jobId: WorkflowId; }
type JobScoped<Type extends string> = EventBase & { readonly type: Type };
type BatchScoped<Type extends string> = JobScoped<Type> & { readonly batchId: WorkflowId };
type BatchOwned<Type extends string> = BatchScoped<Type> & { readonly stageId: WorkflowId };
type Receipted<Type extends string> = BatchScoped<Type> & { readonly receipt: WorkflowReceipt };
type UndoReceipted<Type extends string> = BatchScoped<Type> & { readonly receipt: WorkflowUndoReceipt };

type JobEvent =
  | (JobScoped<"job.opened"> & {
    readonly engineId: typeof WORKFLOW_ENGINE_ID;
    readonly title: string;
    readonly goalSummary: string;
    readonly constraints?: WorkflowJobConstraints;
    readonly successCriteria: readonly WorkflowSuccessCriterion[];
    readonly requestId?: string;
    readonly autoApply?: boolean;
  })
  | JobScoped<"job.undoOpened">
  | (JobScoped<"job.blocked"> & { readonly reason: string })
  | (JobScoped<"job.providerCycleClosed"> & { readonly cycle: number })
  | (JobScoped<"job.providerFailureRecorded"> & { readonly code: string; readonly message: string; readonly afterSeal: boolean })
  | JobScoped<"job.providerFailureCleared">
  | JobScoped<"job.reopenedForContinuation">
  | BatchScoped<"job.reopenedAfterReconciliation">
  | BatchScoped<"job.reopenedForRepair">
  | BatchScoped<"job.reopenedForObservation">
  | JobScoped<"job.completed">
  | JobScoped<"job.cancelled">;

type StageEvent =
  | (JobScoped<"stage.opened"> & { readonly stageId: WorkflowId; readonly title: string; readonly purpose: string; readonly successCriteria: readonly WorkflowSuccessCriterion[] })
  | (JobScoped<"stage.completed"> & { readonly stageId: WorkflowId });

type ProposalEvent =
  | (BatchOwned<"batch.proposed"> & { readonly summary: string; readonly dependencies?: readonly WorkflowId[] })
  | (BatchOwned<"operation.proposed"> & { readonly ordinal: number; readonly payload: ActionPlanV2Operation });

type AdmissionEvent =
  | (JobScoped<"authority.recorded"> & { readonly evidence: WorkflowAuthorityEvidence })
  | (BatchOwned<"batch.admitted"> & {
    readonly digest: string;
    readonly sourcePlanId?: WorkflowId;
    readonly sourcePlanDigest?: string;
    readonly snapshotFingerprint: string;
    readonly undoUnitId: WorkflowId;
    readonly undoUnitCount: 1;
    readonly dimensions: WorkflowAdmissionDimensions;
    readonly postconditions?: readonly WorkflowPostconditionContract[];
  });

type DispatchEvent =
  | (BatchScoped<"batch.approvalBound"> & { readonly approvalId: string; readonly sourcePlanDigest: string; readonly digest: string; readonly snapshotFingerprint: string })
  | BatchScoped<"batch.queued">
  | BatchScoped<"batch.claimed">
  | BatchScoped<"batch.executing">
  | BatchScoped<"batch.cancelRequested">;

type SettlementEvent =
  | Receipted<"batch.rejected">
  | Receipted<"batch.abandonedBeforeApply">
  | Receipted<"batch.receipt">
  | (Receipted<"batch.reconciled"> & { readonly priorReceiptId: string });

type UndoEvent =
  | (BatchScoped<"batch.undoRequested"> & { readonly expectedFingerprint: string })
  | BatchScoped<"batch.undoClaimed">
  | BatchScoped<"batch.undoExecuting">
  | UndoReceipted<"batch.undoRejected">
  | UndoReceipted<"batch.undoReceipt">
  | (UndoReceipted<"batch.undoReconciled"> & { readonly priorReceiptId: string });

type CriteriaEvent =
  | (JobScoped<"observation.recorded"> & { readonly evidence: WorkflowObservationEvidence })
  | (JobScoped<"criterion.satisfied"> & { readonly scope: "job" | "stage"; readonly stageId?: WorkflowId; readonly criterionId: WorkflowId; readonly reference: WorkflowCriterionReference });

/** Every structured event the reducer accepts; a log of these is the workflow's only source of truth. */
export type WorkflowEvent = JobEvent | StageEvent | ProposalEvent | AdmissionEvent | DispatchEvent | SettlementEvent | UndoEvent | CriteriaEvent;
