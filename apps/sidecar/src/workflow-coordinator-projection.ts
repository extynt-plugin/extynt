// The bounded, read-only view of the workflow state the status route and the panel receive.

import type {
  WorkflowBatch, WorkflowContinuationInput, WorkflowHostEvidence, WorkflowId, WorkflowJob, WorkflowObservationEvidence,
  WorkflowOperation, WorkflowReceipt, WorkflowRecoveryReport, WorkflowStage, WorkflowState
} from "@extynt/workflow";
import type { WorkflowPlanRecord } from "./workflow-coordinator-types.js";

type ProjectedProgress = {
  readonly totalBatches: number;
  readonly settledBatches: number;
  readonly verifiedBatches: number;
  readonly appliedUnverifiedBatches: number;
  readonly uncertainBatches: number;
  readonly undoCompleted: number;
  readonly criteria: { readonly total: number; readonly satisfied: number };
};

type ProjectedJob = {
  readonly jobId: WorkflowId;
  readonly engineId: WorkflowJob["engineId"];
  readonly title: string;
  readonly goalSummary: string;
  readonly status: WorkflowJob["status"];
  readonly stageIds: readonly WorkflowId[];
  readonly batchIds: readonly WorkflowId[];
  readonly cancellationRequested: boolean;
  readonly undoOpened: boolean;
  readonly providerCycle: number;
  readonly blocker: string | null;
  readonly progress: ProjectedProgress;
};

type ProjectedStage = {
  readonly stageId: WorkflowId;
  readonly jobId: WorkflowId;
  readonly title: string;
  readonly status: WorkflowStage["status"];
  readonly batchIds: readonly WorkflowId[];
  readonly criteria: number;
  readonly satisfiedCriteria: number;
};

type ProjectedReceiptEvidence = {
  readonly evidenceId: string;
  readonly operationId: string | null;
  readonly kind: WorkflowHostEvidence["kind"];
  readonly basis: string;
  readonly observedFingerprint: string | null;
  readonly recordedAt: string;
};

type ProjectedReceipt = {
  readonly receiptId: string;
  readonly receivedAt: string;
  readonly execution: WorkflowReceipt["execution"];
  readonly mutation: WorkflowReceipt["mutation"];
  readonly mayHaveMutated: boolean;
  readonly verification: WorkflowReceipt["verification"];
  readonly verificationBasis: string | null;
  readonly observedFingerprint: string | null;
  readonly postconditions: NonNullable<WorkflowReceipt["postconditions"]>;
  readonly hostEvidence: readonly ProjectedReceiptEvidence[];
};

type ProjectedUndo = {
  readonly dispatch: WorkflowBatch["recovery"]["dispatch"];
  readonly receiptId: WorkflowBatch["recovery"]["undoReceiptId"];
  readonly verification: WorkflowBatch["recovery"]["verification"];
  readonly expectedFingerprint: string | null;
  readonly restoredFingerprint: string | null;
};

type ProjectedBatch = {
  readonly batchId: WorkflowId;
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId;
  readonly dependencies: readonly WorkflowId[];
  readonly lifecycle: WorkflowBatch["lifecycle"];
  readonly operationCount: number;
  readonly execution: WorkflowBatch["execution"]["state"];
  readonly mutation: WorkflowBatch["execution"]["mutation"];
  readonly verification: WorkflowBatch["verification"]["state"];
  readonly verificationBasis: WorkflowBatch["verification"]["basis"];
  readonly observedFingerprint: WorkflowBatch["verification"]["observedFingerprint"];
  readonly requiredPostconditions: number;
  readonly policy: "automatic" | "manual" | null;
  readonly passedPostconditions: number;
  readonly approvalBound: boolean;
  readonly approvalAt: string | null;
  readonly recovery: WorkflowBatch["recovery"]["state"];
  readonly undo: ProjectedUndo;
  readonly receipt: ProjectedReceipt | null;
  readonly cancelRequested: boolean;
};

type ProjectedOperation = {
  readonly operationId: WorkflowId;
  readonly batchId: WorkflowId;
  readonly ordinal: number;
  readonly type: string;
  readonly status: WorkflowOperation["status"];
  readonly outcome: WorkflowOperation["outcome"];
};

type ProjectedObservation = {
  readonly evidenceId: string;
  readonly jobId: WorkflowId;
  readonly stageId: WorkflowId | null;
  readonly kind: WorkflowObservationEvidence["kind"];
  readonly basis: string;
  readonly observedFingerprint: string | null;
  readonly recordedAt: string;
};

type ProjectedHostEvidence = ProjectedReceiptEvidence & { readonly jobId: WorkflowId; readonly batchId: WorkflowId };

/** A projection divergence a caller reported for a plan. */
export type ProjectedDivergence = { readonly planId: string; readonly code: string; readonly message: string; readonly at: string };

/** A provider failure recorded for a job. */
export type ProjectedProviderFailure = { readonly jobId: string; readonly code: string; readonly message: string; readonly at: string; readonly afterSeal: boolean };

/** The whole bounded view of the workflow state. */
export interface WorkflowProjection {
  readonly engine: "workflow-v1";
  readonly resumeSupported: boolean;
  readonly automaticDispatchResumeSupported: false;
  readonly resumeBoundary: "durable_state_and_explicit_receipts";
  readonly activeJobId: WorkflowId | null;
  readonly activeDispatchLease: WorkflowState["activeDispatchLease"];
  readonly jobs: readonly ProjectedJob[];
  readonly stages: readonly ProjectedStage[];
  readonly batches: readonly ProjectedBatch[];
  readonly operations: readonly ProjectedOperation[];
  readonly observations: readonly ProjectedObservation[];
  readonly hostEvidence: readonly ProjectedHostEvidence[];
  readonly divergences: readonly ProjectedDivergence[];
  readonly continuation: WorkflowContinuationInput | null;
  readonly providerFailures: readonly ProjectedProviderFailure[];
  readonly recovery: WorkflowRecoveryReport;
  readonly startupNotices?: readonly string[];
}

interface ProjectionSource {
  readonly state: WorkflowState;
  readonly plans: ReadonlyMap<string, WorkflowPlanRecord>;
  readonly divergences: ReadonlyMap<string, ProjectedDivergence>;
  readonly providerFailures: ReadonlyMap<string, ProjectedProviderFailure>;
  readonly notices: readonly string[];
  readonly recovery: WorkflowRecoveryReport;
  readonly resumeSupported: boolean;
}

const SETTLED_LIFECYCLES: readonly WorkflowBatch["lifecycle"][] = ["settled", "cancelled"];
const UNDONE_STATES: readonly WorkflowBatch["recovery"]["state"][] = ["undone", "undo_unverified"];

function jobProgress(state: WorkflowState, job: WorkflowJob): ProjectedProgress {
  const batches = job.batchIds.map((id) => state.batches[id]).filter((batch): batch is WorkflowBatch => batch !== undefined);
  const settled = batches.filter((batch) => SETTLED_LIFECYCLES.includes(batch.lifecycle));
  return {
    totalBatches: batches.length,
    settledBatches: settled.length,
    verifiedBatches: settled.filter((batch) => batch.verification.state === "verified").length,
    appliedUnverifiedBatches: settled.filter((batch) => batch.verification.state === "applied_unverified").length,
    uncertainBatches: settled.filter((batch) => batch.execution.state === "unknown" || batch.recovery.state === "unknown").length,
    undoCompleted: settled.filter((batch) => UNDONE_STATES.includes(batch.recovery.state)).length,
    criteria: { total: job.successCriteria.length, satisfied: Object.keys(job.satisfiedCriteria).length },
  };
}

function receiptEvidence(evidence: WorkflowHostEvidence): ProjectedReceiptEvidence {
  return { evidenceId: evidence.evidenceId, operationId: evidence.operationId ?? null, kind: evidence.kind, basis: evidence.basis, observedFingerprint: evidence.observedFingerprint ?? null, recordedAt: evidence.recordedAt };
}

function receiptRow(batch: WorkflowBatch): ProjectedReceipt | null {
  const receipt = batch.execution.receipt;
  if (!receipt) return null;
  return {
    receiptId: receipt.receiptId,
    receivedAt: receipt.receivedAt,
    execution: receipt.execution,
    mutation: receipt.mutation,
    mayHaveMutated: receipt.mayHaveMutated,
    verification: receipt.verification,
    verificationBasis: receipt.verificationBasis ?? null,
    observedFingerprint: receipt.observedFingerprint ?? null,
    postconditions: (receipt.postconditions ?? []).slice(0, 64),
    hostEvidence: (receipt.hostEvidence ?? []).slice(0, 256).map(receiptEvidence),
  };
}

function undoRow(batch: WorkflowBatch): ProjectedUndo {
  const lineage = batch.recovery.lineage;
  return { dispatch: batch.recovery.dispatch, receiptId: batch.recovery.undoReceiptId, verification: batch.recovery.verification, expectedFingerprint: lineage ? lineage.expectedFingerprint : null, restoredFingerprint: lineage ? lineage.restoredFingerprint : null };
}

function batchRow(batch: WorkflowBatch): ProjectedBatch {
  const admission = batch.admission;
  const approval = batch.approval;
  return {
    batchId: batch.batchId,
    jobId: batch.jobId,
    stageId: batch.stageId,
    dependencies: batch.dependencies.slice(0, 64),
    lifecycle: batch.lifecycle,
    operationCount: batch.operationIds.length,
    execution: batch.execution.state,
    mutation: batch.execution.mutation,
    verification: batch.verification.state,
    verificationBasis: batch.verification.basis,
    observedFingerprint: batch.verification.observedFingerprint,
    requiredPostconditions: admission ? admission.postconditions?.length ?? 0 : 0,
    policy: admission ? admission.dimensions.policy.decision : null,
    passedPostconditions: (batch.verification.postconditions ?? []).filter((entry) => entry.state === "passed").length,
    approvalBound: approval !== null,
    approvalAt: approval ? approval.approvedAt : null,
    recovery: batch.recovery.state,
    undo: undoRow(batch),
    receipt: receiptRow(batch),
    cancelRequested: batch.cancelRequested,
  };
}

function jobRows(source: ProjectionSource, jobId: string | undefined): ProjectedJob[] {
  return Object.values(source.state.jobs).filter((value) => !jobId || value.jobId === jobId).slice(0, 64).map((value) => ({
    jobId: value.jobId, engineId: value.engineId, title: value.title, goalSummary: value.goalSummary, status: value.status,
    stageIds: value.stageIds, batchIds: value.batchIds, cancellationRequested: value.cancellationRequested, undoOpened: value.undoOpened,
    providerCycle: value.providerCycle, blocker: value.blocker, progress: jobProgress(source.state, value),
  }));
}

function stageRows(state: WorkflowState, jobIds: ReadonlySet<string>): ProjectedStage[] {
  return Object.values(state.stages).filter((value) => jobIds.has(value.jobId)).slice(0, 128).map((value) => ({
    stageId: value.stageId, jobId: value.jobId, title: value.title, status: value.status, batchIds: value.batchIds,
    criteria: value.successCriteria.length, satisfiedCriteria: Object.keys(value.satisfiedCriteria).length,
  }));
}

function operationRows(state: WorkflowState, batchIds: ReadonlySet<string>): ProjectedOperation[] {
  return Object.values(state.operations).filter((value) => batchIds.has(value.batchId)).slice(0, 1024).map((value) => ({
    operationId: value.operationId, batchId: value.batchId, ordinal: value.ordinal, type: value.type, status: value.status, outcome: value.outcome,
  }));
}

function observationRows(state: WorkflowState, jobIds: ReadonlySet<string>): ProjectedObservation[] {
  return Object.values(state.observations).filter((value) => jobIds.has(value.jobId)).slice(0, 256).map((value) => ({
    evidenceId: value.evidenceId, jobId: value.jobId, stageId: value.stageId ?? null, kind: value.kind, basis: value.basis,
    observedFingerprint: value.observedFingerprint ?? null, recordedAt: value.recordedAt,
  }));
}

function hostEvidenceRows(state: WorkflowState, jobIds: ReadonlySet<string>): ProjectedHostEvidence[] {
  return Object.values(state.hostEvidence).filter((value) => jobIds.has(value.jobId)).slice(0, 256).map((value) => ({ ...receiptEvidence(value), jobId: value.jobId, batchId: value.batchId }));
}

function divergenceRows(source: ProjectionSource, jobIds: ReadonlySet<string>): ProjectedDivergence[] {
  const planIds = new Set([...source.plans.values()].filter((value) => jobIds.has(value.jobId)).map((value) => value.planId));
  return [...source.divergences.values()].filter((value) => planIds.has(value.planId)).map((value) => ({ ...value }));
}

/** The bounded projection of `source`, limited to `jobId` when given, with the continuation the caller supplies. */
export function buildProjection(source: ProjectionSource, jobId: string | undefined, continuation: WorkflowContinuationInput | null): WorkflowProjection {
  const { state } = source;
  const jobs = jobRows(source, jobId);
  const jobIds = new Set(jobs.map((value) => value.jobId));
  const batches = Object.values(state.batches).filter((value) => jobIds.has(value.jobId)).slice(0, 1024).map(batchRow);
  return {
    engine: "workflow-v1",
    resumeSupported: source.resumeSupported,
    automaticDispatchResumeSupported: false,
    resumeBoundary: "durable_state_and_explicit_receipts",
    activeJobId: state.activeJobId,
    activeDispatchLease: state.activeDispatchLease,
    jobs,
    stages: stageRows(state, jobIds),
    batches,
    operations: operationRows(state, new Set(batches.map((value) => value.batchId))),
    observations: observationRows(state, jobIds),
    hostEvidence: hostEvidenceRows(state, jobIds),
    divergences: divergenceRows(source, jobIds),
    continuation,
    providerFailures: [...source.providerFailures.values()].filter((value) => jobIds.has(value.jobId)).map((value) => ({ ...value })),
    recovery: source.recovery,
    ...(source.notices.length ? { startupNotices: [...source.notices] } : {}),
  };
}
