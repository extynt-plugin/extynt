// Undo-settlement transitions: recording an undo receipt, refusing a rejected undo and reconciling uncertain undo evidence later.

import { assert } from "../assertions.js";
import { signature } from "../canonical-json.js";
import { validateUndoReceipt } from "../receipt-validation.js";
import type { WorkflowRecoveryEvidence, WorkflowRecoveryState, WorkflowUndoLineage, WorkflowUndoReceipt } from "../evidence-types.js";
import { clone } from "../frozen-state.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { blockOwners, leaseOwns, releaseActiveJobIfSafe } from "../ownership.js";
import { batch, own, setRecord } from "../state.js";
import type { WorkflowBatch } from "../state-types.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";

type UndoSettlementEvent = EventOf<"batch.undoReceipt" | "batch.undoRejected">;

function executedUndoState(verification: WorkflowUndoReceipt["verification"]): WorkflowRecoveryState {
  if (verification === "restored") return "undone";
  return verification === "undo_unverified" ? "undo_unverified" : "blocked";
}

function undoState(receipt: WorkflowUndoReceipt): WorkflowRecoveryState {
  if (receipt.status === "executed") return executedUndoState(receipt.verification);
  return receipt.status === "unknown" ? "unknown" : "blocked";
}

function withUndoReceipt(current: WorkflowBatch, receipt: WorkflowUndoReceipt, recovery: Partial<WorkflowRecoveryEvidence>): WorkflowRecoveryEvidence {
  return { ...current.recovery, dispatch: "idle", undoReceiptId: receipt.receiptId, receipt: clone(receipt), verification: receipt.verification, ...recovery };
}

function restoredLineage(lineage: WorkflowUndoLineage, receipt: WorkflowUndoReceipt): WorkflowUndoLineage {
  return { ...lineage, restoredFingerprint: receipt.restoredFingerprint ?? null };
}

function refuseUndo(next: MutableWorkflowState, current: WorkflowBatch, event: UndoSettlementEvent, dispatch: "idle" | "executing"): MutableWorkflowState {
  if (dispatch === "executing") assert(leaseOwns(next, "undo", event.jobId, event.batchId), "DISPATCH_LANE_BUSY", "The undo receipt does not own the shared dispatch lease.");
  const restorable = current.verification.state === "verified" || current.verification.state === "applied_unverified";
  const recovery = withUndoReceipt(current, event.receipt, { state: restorable ? "available" : "blocked", mayHaveMutated: false, lineage: null });
  const refused: WorkflowBatch = { ...current, recovery, updatedAt: event.at };
  next.batches = setRecord(next.batches, event.batchId, refused);
  if (dispatch === "executing") next.activeDispatchLease = null;
  const owner = next.jobs[event.jobId];
  if (owner?.status === "completed" && owner.undoOpened) next.jobs = setRecord(next.jobs, event.jobId, { ...owner, undoOpened: false, updatedAt: event.at });
  else blockOwners(next, refused, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
}

function assertExecutingUndo(next: MutableWorkflowState, current: WorkflowBatch, event: EventOf<"batch.undoReceipt">): void {
  assert(current.recovery.state === "requested" && current.recovery.dispatch === "executing", "ILLEGAL_TRANSITION", "An undo receipt requires an executing undo.");
  assert(leaseOwns(next, "undo", event.jobId, event.batchId), "DISPATCH_LANE_BUSY", "The undo receipt does not own the shared dispatch lease.");
}

const recordUndoReceipt: Transition<"batch.undoReceipt"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  const receipt = event.receipt;
  validateUndoReceipt(receipt);
  if (current.recovery.undoReceiptId === receipt.receiptId) {
    assert(current.recovery.receipt !== null && signature(current.recovery.receipt) === signature(receipt), "DUPLICATE_EVENT_CONFLICT", `Undo receipt ${receipt.receiptId} was already recorded with different evidence.`);
    return next;
  }
  assertExecutingUndo(next, current, event);
  const lineage = current.recovery.lineage;
  assert(lineage !== null, "ILLEGAL_TRANSITION", "An executing undo requires an undo lineage.");
  if (receipt.status === "rejected") return refuseUndo(next, current, event, "executing");
  const recorded: WorkflowBatch = { ...current, recovery: withUndoReceipt(current, receipt, { state: undoState(receipt), mayHaveMutated: true, lineage: restoredLineage(lineage, receipt) }), updatedAt: event.at };
  next.batches = setRecord(next.batches, event.batchId, recorded);
  next.activeDispatchLease = null;
  if (receipt.status !== "executed") blockOwners(next, recorded, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

function assertUndoReconcilable(current: WorkflowBatch, event: EventOf<"batch.undoReconciled">): void {
  const receipt = event.receipt;
  assert(current.lifecycle === "settled", "ILLEGAL_TRANSITION", "Only a settled batch can reconcile an undo receipt.");
  assert(current.recovery.dispatch === "idle", "DISPATCH_LANE_BUSY", "An undo reconciliation cannot replace an executing recovery.");
  assert(current.recovery.state === "unknown" || current.recovery.state === "undo_unverified", "ILLEGAL_TRANSITION", "Only uncertain or explicitly unverified undo evidence may be reconciled.");
  assert(current.recovery.undoReceiptId === event.priorReceiptId, "INVALID_RECEIPT", "Undo reconciliation must identify the exact prior receipt.");
  assert(receipt.receiptId !== event.priorReceiptId, "DUPLICATE_EVENT_CONFLICT", "Undo reconciliation requires a new receipt identity.");
  assert(current.recovery.receipt !== null, "INVALID_RECEIPT", "An uncertain undo must retain its prior receipt.");
  assert(receipt.status === "executed", "INVALID_RECEIPT", "A late undo reconciliation must be an executed host receipt.");
  assert(receipt.verification === "restored" || receipt.verification === "undo_unverified" || receipt.verification === "mismatch", "INVALID_RECEIPT", "A late undo receipt must retain restored, mismatch, or unverified evidence.");
}

const reconcileUndo: Transition<"batch.undoReconciled"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  validateUndoReceipt(event.receipt);
  assertUndoReconcilable(current, event);
  const lineage = current.recovery.lineage ? restoredLineage(current.recovery.lineage, event.receipt) : null;
  const recovery = withUndoReceipt(current, event.receipt, { state: undoState(event.receipt), mayHaveMutated: true, lineage });
  next.batches = setRecord(next.batches, event.batchId, { ...current, recovery, updatedAt: event.at });
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

const rejectUndo: Transition<"batch.undoRejected"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  validateUndoReceipt(event.receipt);
  assert(current.recovery.state === "requested" && current.recovery.dispatch === "idle", "ILLEGAL_TRANSITION", "A stale undo rejection requires a requested idle undo.");
  if (event.receipt.status === "rejected") return refuseUndo(next, current, event, "idle");
  const rejected: WorkflowBatch = { ...current, recovery: withUndoReceipt(current, event.receipt, { state: "unknown", mayHaveMutated: false }), updatedAt: event.at };
  next.batches = setRecord(next.batches, event.batchId, rejected);
  blockOwners(next, rejected, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

/**
 * Undo settlement. A refused undo changed nothing: the batch's edit is still in the project and undoable as before,
 * so the batch returns to its pre-request state and Undo can be pressed again. A completed job that reopened the
 * engine for this undo closes that session so the engine is free for the next request.
 */
export const RECOVERY_SETTLEMENT_TRANSITIONS = {
  "batch.undoReceipt": recordUndoReceipt,
  "batch.undoReconciled": reconcileUndo,
  "batch.undoRejected": rejectUndo,
} satisfies TransitionSlice;
