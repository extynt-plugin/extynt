// Presentation: the read-only status and control facts a UI or API shows for a job, projected from workflow truth.

import { fail } from "./assertions.js";
import type { WorkflowRecoveryState, WorkflowUndoLineage, WorkflowVerificationCoverage, WorkflowVerificationState } from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import type { WorkflowBatch, WorkflowBatchLifecycle, WorkflowDispatchLease, WorkflowJob, WorkflowJobStatus, WorkflowState } from "./state-types.js";
import { workflowVerificationCoverage } from "./verification-coverage.js";

/** The single status word a batch shows. */
export type WorkflowPresentationStatus = "planned" | "admitted" | "executing" | "applied" | "verified" | "blocked" | "uncertain" | "undone" | "cancelled";

/** Status, evidence and control facts of one batch. */
export interface WorkflowBatchPresentation {
  readonly batchId: WorkflowId;
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly status: WorkflowPresentationStatus;
  readonly operationCount: number;
  readonly receiptId: string | null;
  readonly verification: WorkflowVerificationState;
  readonly verificationCoverage: WorkflowVerificationCoverage;
  readonly recovery: WorkflowRecoveryState;
  readonly undoLineage: WorkflowUndoLineage | null;
  readonly canRequestUndo: boolean;
  readonly canReconcile: boolean;
  readonly automaticRetry: false;
}

/** Counts of one job's batches by status and verification coverage. */
export interface WorkflowJobPresentation {
  readonly jobId: WorkflowId;
  readonly status: WorkflowJobStatus;
  readonly activeStageId: WorkflowId | null;
  readonly totalBatches: number;
  readonly verifiedBatches: number;
  readonly readbackVerifiedBatches: number;
  readonly visuallyVerifiedBatches: number;
  readonly temporallyVerifiedBatches: number;
  readonly appliedBatches: number;
  readonly blockedBatches: number;
  readonly uncertainBatches: number;
  readonly undoneBatches: number;
  readonly undoableBatches: number;
}

/** Read-only, bounded presentation facts for status/control surfaces. */
export interface WorkflowPresentation {
  readonly job: WorkflowJobPresentation;
  readonly batches: readonly WorkflowBatchPresentation[];
  readonly activeDispatchLease: WorkflowDispatchLease | null;
  readonly resumeSupported: boolean;
  readonly automaticDispatchResumeSupported: false;
}

function evidenceStatus(batch: WorkflowBatch): WorkflowPresentationStatus | null {
  if (batch.recovery.state === "undone") return "undone";
  if (batch.execution.state === "unknown" || batch.recovery.state === "unknown" || batch.recovery.state === "undo_unverified") return "uncertain";
  if (batch.recovery.state === "blocked") return "blocked";
  if (batch.recovery.dispatch !== "idle") return "executing";
  return null;
}

const LIFECYCLE_STATUS: Readonly<Partial<Record<WorkflowBatchLifecycle, WorkflowPresentationStatus>>> = { proposed: "planned", admitted: "admitted", queued: "admitted", claimed: "executing", executing: "executing", cancelled: "cancelled" };
const LIVE_STAGE_STATUSES: ReadonlySet<string> = new Set(["open", "active"]);

function batchStatus(batch: WorkflowBatch): WorkflowPresentationStatus {
  const evidence = evidenceStatus(batch);
  if (evidence) return evidence;
  const lifecycle = LIFECYCLE_STATUS[batch.lifecycle];
  if (lifecycle) return lifecycle;
  if (batch.verification.state === "verified") return "verified";
  if (batch.execution.state === "executed" && batch.verification.state === "applied_unverified") return "applied";
  return "blocked";
}

function batchControl(batch: WorkflowBatch): Pick<WorkflowBatchPresentation, "canRequestUndo" | "canReconcile"> {
  const canReconcile = batch.lifecycle === "settled" && (
    batch.execution.state === "unknown" ||
    batch.verification.state === "applied_unverified" ||
    batch.recovery.state === "unknown" ||
    batch.recovery.state === "undo_unverified"
  );
  return { canRequestUndo: batch.lifecycle === "settled" && batch.recovery.state === "available", canReconcile };
}

function presentBatch(batch: WorkflowBatch): WorkflowBatchPresentation {
  return {
    batchId: batch.batchId,
    jobId: batch.jobId,
    stageId: batch.stageId,
    status: batchStatus(batch),
    operationCount: batch.operationIds.length,
    receiptId: batch.execution.receiptId,
    verification: batch.verification.state,
    verificationCoverage: workflowVerificationCoverage(batch),
    recovery: batch.recovery.state,
    undoLineage: batch.recovery.lineage,
    ...batchControl(batch),
    automaticRetry: false,
  };
}

function presentJob(state: WorkflowState, job: WorkflowJob, batches: readonly WorkflowBatchPresentation[]): WorkflowJobPresentation {
  const count = (status: WorkflowPresentationStatus): number => batches.filter((batch) => batch.status === status).length;
  const activeStageId = job.stageIds.find((stageId) => LIVE_STAGE_STATUSES.has(state.stages[stageId]?.status ?? "")) ?? null;
  return {
    jobId: job.jobId,
    status: job.status,
    activeStageId,
    totalBatches: batches.length,
    verifiedBatches: count("verified"),
    readbackVerifiedBatches: batches.filter((batch) => batch.verificationCoverage.readback).length,
    visuallyVerifiedBatches: batches.filter((batch) => batch.verificationCoverage.visual).length,
    temporallyVerifiedBatches: batches.filter((batch) => batch.verificationCoverage.temporal).length,
    appliedBatches: count("applied"),
    blockedBatches: count("blocked"),
    uncertainBatches: count("uncertain"),
    undoneBatches: count("undone"),
    undoableBatches: batches.filter((batch) => batch.canRequestUndo).length,
  };
}

/** Projects workflow truth into status and control facts for a UI or API; the projection cannot authorize dispatch, retry a mutation or hide uncertainty. */
export function presentWorkflowState(state: WorkflowState, jobId: string): WorkflowPresentation {
  const job = state.jobs[jobId];
  if (!job) fail("NOT_FOUND", `Workflow job ${jobId} does not exist.`);
  const batches = job.batchIds
    .map((batchId) => state.batches[batchId])
    .filter((batch): batch is WorkflowBatch => batch !== undefined)
    .map(presentBatch);
  return {
    job: presentJob(state, job, batches),
    batches,
    activeDispatchLease: state.activeDispatchLease,
    resumeSupported: state.resumeSupported,
    automaticDispatchResumeSupported: false,
  };
}
