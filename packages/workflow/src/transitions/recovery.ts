// Undo-dispatch transitions: requesting a guarded undo of a settled batch, claiming the shared dispatch lane for it and starting its execution.

import { assert, boundedText, fail } from "../assertions.js";
import type { WorkflowUndoLineage } from "../evidence-types.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { MAX_WORKFLOW_ID_LENGTH } from "../limits.js";
import { leaseOwns } from "../ownership.js";
import { batch, job, own, setRecord } from "../state.js";
import type { WorkflowBatch } from "../state-types.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";

function assertUndoable(current: WorkflowBatch): void {
  assert(current.lifecycle === "settled", "ILLEGAL_TRANSITION", "Only a settled batch can be undone.");
  assert(current.execution.state === "executed", "ILLEGAL_TRANSITION", "An unexecuted or uncertain batch cannot enter the undo lane.");
  assert(current.recovery.state === "available" || current.recovery.state === "blocked", "ILLEGAL_TRANSITION", "This batch has no guarded undo available.");
  assert(current.recovery.lineage === null, "ILLEGAL_TRANSITION", "Undo has already been requested for this batch.");
}

function reacquireEngine(next: MutableWorkflowState, event: EventOf<"batch.undoRequested">): void {
  const status = job(next, event.jobId).status;
  if (next.activeJobId !== null || (status !== "blocked" && status !== "cancelled")) return;
  assert(next.activeDispatchLease === null, "DISPATCH_LANE_BUSY", "Another host operation owns the workflow dispatch lane.");
  next.activeJobId = event.jobId;
}

const requestUndo: Transition<"batch.undoRequested"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  boundedText(event.expectedFingerprint, "expectedFingerprint", MAX_WORKFLOW_ID_LENGTH * 4);
  assertUndoable(current);
  reacquireEngine(next, event);
  const lineage: WorkflowUndoLineage = {
    targetBatchId: event.batchId,
    undoUnitId: current.admission?.undoUnitId ?? fail("INVALID_UNDO_UNIT", "A batch without an undo unit cannot be undone."),
    expectedFingerprint: event.expectedFingerprint,
    restoredFingerprint: null,
  };
  next.batches = setRecord(next.batches, event.batchId, { ...current, recovery: { ...current.recovery, state: "requested", dispatch: "idle", lineage }, updatedAt: event.at });
  return next;
};

const claimUndo: Transition<"batch.undoClaimed"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(current.recovery.state === "requested" && current.recovery.dispatch === "idle", "ILLEGAL_TRANSITION", "Only a requested undo can be claimed.");
  assert(next.activeDispatchLease === null, "DISPATCH_LANE_BUSY", "The shared host dispatch lease is busy.");
  next.activeDispatchLease = { kind: "undo", jobId: event.jobId, batchId: event.batchId };
  next.batches = setRecord(next.batches, event.batchId, { ...current, recovery: { ...current.recovery, dispatch: "claimed" }, updatedAt: event.at });
  return next;
};

const executeUndo: Transition<"batch.undoExecuting"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(current.recovery.state === "requested" && current.recovery.dispatch === "claimed", "ILLEGAL_TRANSITION", "Only a claimed undo can execute.");
  assert(leaseOwns(next, "undo", event.jobId, event.batchId), "DISPATCH_LANE_BUSY", "The batch does not own the undo dispatch lease.");
  next.batches = setRecord(next.batches, event.batchId, { ...current, recovery: { ...current.recovery, dispatch: "executing" }, updatedAt: event.at });
  return next;
};

/**
 * Guarded undo dispatch. A stopped or non-verified authoring turn may have released the engine, so a request
 * reacquires it, but only while no other host work owns the dispatch lane.
 */
export const RECOVERY_DISPATCH_TRANSITIONS = {
  "batch.undoRequested": requestUndo,
  "batch.undoClaimed": claimUndo,
  "batch.undoExecuting": executeUndo,
} satisfies TransitionSlice;
