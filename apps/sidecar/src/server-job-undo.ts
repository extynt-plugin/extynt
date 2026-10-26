// The job-scoped undo chain: once one batch's undo settles, the next batch is handed to the panel, so a job unwinds one receipt at a time.
import { decodeOrThrow } from "@extynt/decode";
import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";

import { enqueueHostWork } from "./host/work-queue.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { DIVERGENCE_FAILURE } from "./workflow-coordinator-types.js";

/** Continues a job undo after one batch's undo receipt settles. */
export interface JobUndoCapability {
  continueJobUndo(settledPlanId: string, undoReceipt: StoredReceipt, restored: boolean): void;
}

type JobUndoDeps = {
  readonly state: Pick<SidecarState, "agentMailbox" | "now" | "pendingJobUndo" | "plans" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
};

type JobUndoState = JobUndoDeps["state"];
type PendingJobUndo = NonNullable<SidecarState["pendingJobUndo"]>;
type JobUndoStep = PendingJobUndo["order"][number];
type JobUndoNote = { jobId: string; order: string[]; undone: string[] };
type JobUndoRun = { readonly pending: PendingJobUndo; readonly note: JobUndoNote; readonly receipt: StoredReceipt };

function undoStopReason(planId: string, receipt: StoredReceipt): string {
  return receipt.status === "unknown"
    ? `the undo of ${planId} has an unknown outcome, so the batches below it on the undo stack cannot be identified`
    : `the undo of ${planId} ran but the project does not match the state that batch's apply started from, so the batches below it on the undo stack cannot be identified`;
}

function activeJobUndo(state: JobUndoState, settledPlanId: string): PendingJobUndo | undefined {
  const pending = state.pendingJobUndo;
  return pending?.order[pending.cursor - 1]?.planId === settledPlanId ? pending : undefined;
}

function jobUndoNote(pending: PendingJobUndo, restored: boolean): JobUndoNote {
  const attempted = pending.order.slice(0, pending.cursor).map((entry) => entry.planId);
  return { jobId: pending.jobId, order: pending.order.map((entry) => entry.planId), undone: restored ? attempted : attempted.slice(0, -1) };
}

function stopJobUndo(state: JobUndoState, run: JobUndoRun, reason: string): void {
  const remaining = run.pending.order.slice(run.pending.cursor).map((entry) => entry.planId);
  const batches = remaining.length === 1 ? "one batch was" : `${remaining.length} batches were`;
  state.pendingJobUndo = null;
  run.receipt.jobUndo = { ...run.note, stopped: reason, remaining, action: `Job ${run.pending.jobId} is only partly undone: ${batches} not attempted (${remaining.join(", ")}). Undo the obstruction in After Effects, then call ae_undo_plan with scope "job" again on any batch of this job.` };
}

function requestNextJobUndo(state: JobUndoState, next: JobUndoStep, fingerprint: string | null): string | undefined {
  if (!state.workflowCoordinator.hasPlan(next.planId)) return undefined;
  try { state.workflowCoordinator.requestUndo(next.planId, next.expectedFingerprint ?? fingerprint ?? "unknown"); }
  catch (error) {
    state.workflowCoordinator.markDivergence(next.planId, decodeOrThrow(DIVERGENCE_FAILURE, error));
    return `workflow-v1 refused the next undo batch: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

function fingerprintBlocker(next: JobUndoStep, fingerprint: string | null): string | undefined {
  return next.expectedFingerprint !== null && fingerprint !== next.expectedFingerprint
    ? `the project is not where ${next.planId} was applied, so its undo groups are not the next ones on the stack`
    : undefined;
}

function queueNextJobUndo(state: JobUndoState, run: JobUndoRun, next: JobUndoStep, record: StoredPlan): void {
  record.status = "undo_requested";
  record.updatedAt = state.now().toISOString();
  run.receipt.jobUndo = run.note;
  enqueueHostWork(state, { approvedData: { kind: "undo_plan", planId: next.planId, undoGroup: next.undoGroup, times: next.times, scope: "job", expectedFingerprint: next.expectedFingerprint, restoreFingerprint: record.plan.snapshotFingerprint } });
  run.pending.cursor += 1;
}

function continueFrom(deps: JobUndoDeps, run: JobUndoRun, settledPlanId: string, restored: boolean): void {
  const state = deps.state;
  const stop = (reason: string): void => stopJobUndo(state, run, reason);
  if (!restored) return stop(undoStopReason(settledPlanId, run.receipt));
  const next = run.pending.order[run.pending.cursor];
  if (!next) {
    state.pendingJobUndo = null;
    run.receipt.jobUndo = { ...run.note, complete: true, remaining: [] };
    return;
  }
  const record = state.plans.get(next.planId);
  if (!record) return stop(`${next.planId} is no longer in this panel session's plan store`);
  const fingerprint = deps.planState.normalizedLatest()?.fingerprint ?? null;
  const blocker = fingerprintBlocker(next, fingerprint) ?? requestNextJobUndo(state, next, fingerprint);
  if (blocker !== undefined) return stop(blocker);
  queueNextJobUndo(state, run, next, record);
}

/** The job undo chain over the sidecar state and the plan state's latest snapshot. */
export function createJobUndo(deps: JobUndoDeps): JobUndoCapability {
  return {
    continueJobUndo(settledPlanId: string, undoReceipt: StoredReceipt, restored: boolean): void {
      const pending = activeJobUndo(deps.state, settledPlanId);
      if (pending) continueFrom(deps, { pending, note: jobUndoNote(pending, restored), receipt: undoReceipt }, settledPlanId, restored);
    },
  };
}
