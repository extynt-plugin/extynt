// Construction of the empty workflow state and the pure lookups and predicates transitions share over it.

import { assert, fail } from "./assertions.js";
import type {
  WorkflowExecutionEvidence,
  WorkflowOperationOutcomeKind,
  WorkflowRecoveryEvidence,
  WorkflowRecoveryState,
  WorkflowVerificationEvidence,
} from "./evidence-types.js";
import { finish } from "./frozen-state.js";
import type { MutableWorkflowState } from "./frozen-state.js";
import { WORKFLOW_SCHEMA_VERSION } from "./limits.js";
import { readbackRepaired } from "./readback-repair.js";
import type {
  WorkflowBatch,
  WorkflowCriterionEvidence,
  WorkflowJob,
  WorkflowOperationStatus,
  WorkflowStage,
  WorkflowState,
  WorkflowSuccessCriterion,
} from "./state-types.js";

/** Batch lifecycles before any host work has been claimed. */
export const UNDISPATCHED_LIFECYCLES: ReadonlySet<string> = new Set(["proposed", "admitted", "queued"]);
const BLOCKED_OR_TERMINAL: ReadonlySet<string> = new Set(["blocked", "cancelled", "completed"]);
const SETTLED_BATCH_LIFECYCLES: ReadonlySet<string> = new Set(["settled", "cancelled"]);
export const RESOLVED_RECOVERY: ReadonlySet<WorkflowRecoveryState> = new Set(["none", "available", "undone"]);

const OPERATION_STATUS_BY_OUTCOME: Readonly<Record<WorkflowOperationOutcomeKind, WorkflowOperationStatus>> = {
  confirmed: "verified",
  host_confirmed: "verified",
  coerced_equivalent: "verified",
  applied_unconfirmed: "executed",
  unknown: "unknown",
  readback_mismatch: "failed",
  rejected_before_apply: "failed",
  failed_during_apply: "failed",
  applied_before_failure: "failed",
  not_attempted: "failed",
};

export const INITIAL_EXECUTION: WorkflowExecutionEvidence = {
  state: "not_started",
  mutation: "none",
  mayHaveMutated: false,
  receiptId: null,
  receivedAt: null,
  receipt: null,
  receiptHistory: [],
};

export const INITIAL_VERIFICATION: WorkflowVerificationEvidence = { state: "not_requested", basis: null, observedFingerprint: null };

export const INITIAL_RECOVERY: WorkflowRecoveryEvidence = {
  state: "none",
  dispatch: "idle",
  mayHaveMutated: false,
  undoReceiptId: null,
  lineage: null,
  receipt: null,
  verification: null,
};

/** An empty, sealed state; `resumeSupported` records whether the owning store persists. */
export function createWorkflowState(resumeSupported = false): WorkflowState {
  return finish({
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    jobs: {},
    stages: {},
    batches: {},
    operations: {},
    authorityEvidence: {},
    observations: {},
    hostEvidence: {},
    resumeSupported,
    activeDispatchLease: null,
    activeJobId: null,
    eventSignatures: {},
  });
}

export function job(state: WorkflowState, jobId: string): WorkflowJob {
  return state.jobs[jobId] ?? fail("NOT_FOUND", `Job ${jobId} does not exist.`);
}

export function stage(state: WorkflowState, stageId: string): WorkflowStage {
  return state.stages[stageId] ?? fail("NOT_FOUND", `Stage ${stageId} does not exist.`);
}

export function batch(state: WorkflowState, batchId: string): WorkflowBatch {
  return state.batches[batchId] ?? fail("NOT_FOUND", `Batch ${batchId} does not exist.`);
}

export function own<Owned extends { readonly jobId: string }>(value: Owned, owner: string, kind: string): Owned {
  assert(value.jobId === owner, "WRONG_OWNER", `${kind} does not belong to job ${owner}.`);
  return value;
}

export function setRecord<Entry>(record: Readonly<Record<string, Entry>>, key: string, value: Entry): Record<string, Entry> {
  return { ...record, [key]: value };
}

export function assertProgressAllowed(currentJob: WorkflowJob, currentStage?: WorkflowStage): void {
  assert(!BLOCKED_OR_TERMINAL.has(currentJob.status), "ILLEGAL_TRANSITION", "A blocked or terminal job cannot create or dispatch future work.");
  if (currentStage) assert(!BLOCKED_OR_TERMINAL.has(currentStage.status), "ILLEGAL_TRANSITION", "A blocked or terminal stage cannot create or dispatch future work.");
}

export function updateOperationStatuses(next: MutableWorkflowState, current: WorkflowBatch, status: WorkflowOperationStatus): void {
  const operations = { ...next.operations };
  for (const operationId of current.operationIds) {
    const operation = operations[operationId];
    if (operation) operations[operationId] = { ...operation, status };
  }
  next.operations = operations;
}

export function operationStatusForOutcome(outcome: WorkflowOperationOutcomeKind): WorkflowOperationStatus {
  return OPERATION_STATUS_BY_OUTCOME[outcome];
}

export function allCriteriaSatisfied(criteriaList: readonly WorkflowSuccessCriterion[], evidence: Readonly<Record<string, WorkflowCriterionEvidence>>): boolean {
  return criteriaList.every((criterion) => evidence[criterion.criterionId] !== undefined);
}

export function allDependenciesVerified(state: WorkflowState, current: WorkflowBatch): boolean {
  return current.dependencies.every((dependencyId) => {
    const dependency = state.batches[dependencyId];
    return dependency?.lifecycle === "settled" && dependency.verification.state === "verified";
  });
}

export function hasUnsettledBatches(state: WorkflowState, currentStage: WorkflowStage): boolean {
  return currentStage.batchIds.some((batchId) => !SETTLED_BATCH_LIFECYCLES.has(state.batches[batchId]?.lifecycle ?? ""));
}

function recoveryResolved(batches: readonly (WorkflowBatch | undefined)[], index: number, state: WorkflowState): boolean {
  const current = batches[index];
  if (current === undefined) return true;
  const recoveryState = current.recovery.state;
  return RESOLVED_RECOVERY.has(recoveryState) || (recoveryState === "blocked" && readbackRepaired(batches, index, state.operations));
}

/** Whether any listed batch still has recovery work. A repaired read-back mismatch keeps its blocked undo but no longer holds the stage or job open. */
export function hasPendingRecovery(state: WorkflowState, batchIds: readonly string[]): boolean {
  const batches = batchIds.map((batchId) => state.batches[batchId]);
  return batches.some((current, index) => current !== undefined && (!recoveryResolved(batches, index, state) || current.recovery.dispatch !== "idle"));
}
