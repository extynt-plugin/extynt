// The engine-ownership gate: which events may be applied while their job does not own the workflow engine, and the check that enforces it.

import { assert, id } from "./assertions.js";
import type { WorkflowEvent } from "./events.js";
import type { MutableWorkflowState } from "./frozen-state.js";
import { jobHasLiveHostWork } from "./ownership.js";
import type { WorkflowJob } from "./state-types.js";
import type { EventOf, EventType } from "./transition-table.js";

type EntryRule<Type extends EventType> = (next: MutableWorkflowState, event: EventOf<Type>) => boolean;
type EntryRules = { readonly [Type in EventType]?: EntryRule<Type> };

const FINISHED_STATUSES: ReadonlySet<string> = new Set(["completed", "blocked", "cancelled"]);
const RELEASED_STATUSES: ReadonlySet<string> = new Set(["blocked", "cancelled"]);

function always(): boolean {
  return true;
}

function engineOwner(next: MutableWorkflowState): WorkflowJob | undefined {
  return next.activeJobId === null ? undefined : next.jobs[next.activeJobId];
}

function releasedCycleMayClose(next: MutableWorkflowState, event: EventOf<"job.providerCycleClosed">): boolean {
  const status = next.jobs[event.jobId]?.status;
  return next.activeJobId === null && status !== undefined && FINISHED_STATUSES.has(status);
}

function undoRequestMayReacquireEngine(next: MutableWorkflowState, event: EventOf<"batch.undoRequested">): boolean {
  const current = next.jobs[event.jobId];
  return next.activeJobId === null && current !== undefined && RELEASED_STATUSES.has(current.status) && !jobHasLiveHostWork(next, current);
}

function undoMayBorrowLane(next: MutableWorkflowState, event: EventOf<"batch.undoRequested">): boolean {
  const target = next.jobs[event.jobId];
  const owner = engineOwner(next);
  if (!target || !owner || owner.jobId === event.jobId || next.activeDispatchLease !== null) return false;
  return FINISHED_STATUSES.has(target.status) && !jobHasLiveHostWork(next, owner);
}

function undoMayEnter(next: MutableWorkflowState, event: EventOf<"batch.undoRequested">): boolean {
  return undoRequestMayReacquireEngine(next, event) || undoMayBorrowLane(next, event);
}

function batchInBorrowedUndo(next: MutableWorkflowState, event: EventOf<"batch.undoClaimed" | "batch.undoExecuting" | "batch.undoReceipt" | "batch.undoRejected">): boolean {
  if (typeof event.batchId !== "string" || next.activeJobId === event.jobId) return false;
  const current = next.batches[event.batchId];
  return current !== undefined && current.jobId === event.jobId && current.recovery.lineage !== null;
}

function cancelledJobMayBeUnowned(next: MutableWorkflowState, event: EventOf<"job.cancelled">): boolean {
  const current = next.jobs[event.jobId];
  return current?.status === "blocked" && !jobHasLiveHostWork(next, current);
}

const ENTRY_RULES: EntryRules = {
  "job.opened": always,
  "job.undoOpened": always,
  "job.reopenedAfterReconciliation": always,
  "job.reopenedForRepair": always,
  "job.reopenedForObservation": always,
  "job.reopenedForContinuation": always,
  "job.providerFailureRecorded": always,
  "job.providerFailureCleared": always,
  "batch.reconciled": always,
  "batch.undoReconciled": always,
  "job.providerCycleClosed": releasedCycleMayClose,
  "batch.undoRequested": undoMayEnter,
  "batch.undoClaimed": batchInBorrowedUndo,
  "batch.undoExecuting": batchInBorrowedUndo,
  "batch.undoReceipt": batchInBorrowedUndo,
  "batch.undoRejected": batchInBorrowedUndo,
  "job.cancelled": cancelledJobMayBeUnowned,
};

function mayEnterUnowned<Type extends EventType>(next: MutableWorkflowState, type: Type, event: EventOf<Type>): boolean {
  const rule: EntryRule<Type> | undefined = Object.hasOwn(ENTRY_RULES, type) ? ENTRY_RULES[type] : undefined;
  return rule !== undefined && rule(next, event);
}

/**
 * Rejects an event whose job does not own the active engine, except for the events that legitimately arrive earlier:
 * opening a job, late reconciliation evidence, and the guarded undo lane of a finished job.
 */
export function assertEventOwner(next: MutableWorkflowState, event: WorkflowEvent): void {
  if (mayEnterUnowned(next, event.type, event)) return;
  id(event.jobId, "jobId");
  assert(next.activeJobId === event.jobId, "ILLEGAL_TRANSITION", `Job ${event.jobId} does not own the active workflow engine.`);
}
