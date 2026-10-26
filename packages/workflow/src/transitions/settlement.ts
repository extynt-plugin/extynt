// Settlement transitions: recording a host receipt for an apply, settling a batch before dispatch and reconciling an uncertain or unverified receipt later.

import { assert } from "../assertions.js";
import { validateCreatedBindingsAgainstBatch } from "../created-bindings.js";
import type { WorkflowExecutionEvidence, WorkflowOperationOutcome, WorkflowReceipt, WorkflowRecoveryEvidence, WorkflowRecoveryState, WorkflowVerificationEvidence, WorkflowVerificationState } from "../evidence-types.js";
import { clone } from "../frozen-state.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { blockOwners, leaseOwns, refreshOwnersAfterReconciliation, releaseActiveJobIfSafe } from "../ownership.js";
import { sameReceipt, validateOutcomeRows, validateReceipt } from "../receipt-validation.js";
import { batch, operationStatusForOutcome, own, setRecord } from "../state.js";
import type { WorkflowBatch } from "../state-types.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";
import { recordReceiptHostEvidence, validateReceiptVerificationContract } from "../verification.js";

type PreDispatchEvent = EventOf<"batch.rejected" | "batch.abandonedBeforeApply">;

function storedReceipt(receipt: WorkflowReceipt, rows: readonly WorkflowOperationOutcome[]): WorkflowReceipt {
  return { ...clone(receipt), outcomes: rows };
}

function updateOutcomeRows(next: MutableWorkflowState, rows: readonly WorkflowOperationOutcome[]): void {
  const operations = { ...next.operations };
  for (const row of rows) {
    const operation = operations[row.operationId];
    if (operation) operations[row.operationId] = { ...operation, status: operationStatusForOutcome(row.outcome), outcome: row.outcome };
  }
  next.operations = operations;
}

function verificationEvidence(receipt: WorkflowReceipt, state: WorkflowVerificationState): WorkflowVerificationEvidence {
  return { state, basis: receipt.verificationBasis ?? null, observedFingerprint: receipt.observedFingerprint ?? null, ...(receipt.postconditions ? { postconditions: receipt.postconditions } : {}) };
}

function idleRecovery(state: WorkflowRecoveryState, mayHaveMutated: boolean): WorkflowRecoveryEvidence {
  return { state, dispatch: "idle", mayHaveMutated, undoReceiptId: null, lineage: null, receipt: null, verification: null };
}

function assertPreDispatchReceipt(next: MutableWorkflowState, current: WorkflowBatch, event: PreDispatchEvent): void {
  const receipt = event.receipt;
  validateReceipt(receipt);
  if (event.type === "batch.rejected") assert(receipt.execution === "rejected_before_apply" && receipt.mutation === "none", "INVALID_RECEIPT", "A pre-dispatch rejection must prove no mutation.");
  else assert(receipt.execution === "unknown" && receipt.mayHaveMutated, "INVALID_RECEIPT", "An abandoned approval must preserve uncertainty without claiming a host dispatch.");
  assert(current.lifecycle === "admitted" || current.lifecycle === "queued", "ILLEGAL_TRANSITION", "Only an admitted or queued batch can be settled before dispatch.");
  assert(next.activeDispatchLease === null, "ILLEGAL_TRANSITION", "A pre-dispatch settlement cannot follow a host claim.");
}

function preDispatchExecution(stored: WorkflowReceipt, uncertain: boolean): WorkflowExecutionEvidence {
  return {
    state: uncertain ? "unknown" : "rejected_before_apply",
    mutation: stored.mutation,
    mayHaveMutated: uncertain,
    receiptId: stored.receiptId,
    receivedAt: stored.receivedAt,
    receipt: stored,
    receiptHistory: [stored],
  };
}

const settlePreDispatch: Transition<"batch.rejected" | "batch.abandonedBeforeApply"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assertPreDispatchReceipt(next, current, event);
  validateReceiptVerificationContract(current, event.receipt);
  const rows = validateOutcomeRows(event.receipt, current, next.operations);
  const stored = storedReceipt(event.receipt, rows);
  const uncertain = event.type === "batch.abandonedBeforeApply";
  const settled: WorkflowBatch = {
    ...current,
    lifecycle: "settled",
    execution: preDispatchExecution(stored, uncertain),
    verification: verificationEvidence(stored, uncertain ? "unknown" : "not_requested"),
    recovery: idleRecovery(uncertain ? "blocked" : "none", uncertain),
    updatedAt: event.at,
  };
  next.batches = setRecord(next.batches, event.batchId, settled);
  updateOutcomeRows(next, rows);
  recordReceiptHostEvidence(next, current, stored);
  blockOwners(next, settled, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

function assertReceiptIdentity(current: WorkflowBatch, receipt: WorkflowReceipt): void {
  if (current.execution.receiptId === receipt.receiptId) {
    assert(current.execution.receipt !== null && sameReceipt(current.execution.receipt, receipt), "DUPLICATE_EVENT_CONFLICT", `Receipt ${receipt.receiptId} was already recorded with different evidence.`);
    return;
  }
  assert(!current.execution.receiptHistory.some((prior) => prior.receiptId === receipt.receiptId), "DUPLICATE_EVENT_CONFLICT", `Receipt ${receipt.receiptId} was already recorded in immutable receipt history.`);
}

function assertLiveReceipt(next: MutableWorkflowState, current: WorkflowBatch, event: EventOf<"batch.receipt">): void {
  assert(current.lifecycle === "claimed" || current.lifecycle === "executing", "ILLEGAL_TRANSITION", "An ordinary receipt can only settle a live claimed or executing batch.");
  assert(leaseOwns(next, "apply", event.jobId, event.batchId), "DISPATCH_LANE_BUSY", "The settled batch does not own the apply dispatch lease.");
}

function settledExecution(receipt: WorkflowReceipt, rows: readonly WorkflowOperationOutcome[]): WorkflowExecutionEvidence {
  const stored = storedReceipt(receipt, rows);
  return { state: receipt.execution, mutation: receipt.mutation, mayHaveMutated: receipt.mayHaveMutated, receiptId: receipt.receiptId, receivedAt: receipt.receivedAt, receipt: stored, receiptHistory: [stored] };
}

function settledRecovery(receipt: WorkflowReceipt): WorkflowRecoveryEvidence {
  if (receipt.execution !== "executed") return idleRecovery(receipt.mayHaveMutated ? "blocked" : "none", receipt.mayHaveMutated);
  const verified = receipt.verification === "verified" || receipt.verification === "applied_unverified";
  return idleRecovery(verified ? "available" : "blocked", receipt.mayHaveMutated);
}

const settleReceipt: Transition<"batch.receipt"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  const receipt = event.receipt;
  validateReceipt(receipt);
  validateReceiptVerificationContract(current, receipt);
  assertReceiptIdentity(current, receipt);
  if (current.execution.receiptId === receipt.receiptId) return next;
  assertLiveReceipt(next, current, event);
  const rows = validateOutcomeRows(receipt, current, next.operations);
  validateCreatedBindingsAgainstBatch(receipt, current, rows, next.operations);
  const settled: WorkflowBatch = {
    ...current,
    lifecycle: "settled",
    execution: settledExecution(receipt, rows),
    verification: verificationEvidence(receipt, receipt.verification),
    recovery: settledRecovery(receipt),
    updatedAt: event.at,
  };
  next.batches = setRecord(next.batches, event.batchId, settled);
  updateOutcomeRows(next, rows);
  recordReceiptHostEvidence(next, current, receipt);
  next.activeDispatchLease = null;
  if (receipt.verification === "verified") refreshOwnersAfterReconciliation(next, settled, event.at);
  else blockOwners(next, settled, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

function assertReconciliation(current: WorkflowBatch, event: EventOf<"batch.reconciled">): void {
  validateReceipt(event.receipt);
  validateReceiptVerificationContract(current, event.receipt);
  assert(current.lifecycle === "settled", "ILLEGAL_TRANSITION", "Only a settled batch can be explicitly reconciled.");
  assert(current.execution.receiptId === event.priorReceiptId, "INVALID_RECEIPT", "Reconciliation must identify the exact prior receipt.");
  assert(current.execution.receipt !== null, "INVALID_RECEIPT", "A settled batch must retain its prior receipt.");
  assert(event.receipt.receiptId !== event.priorReceiptId, "DUPLICATE_EVENT_CONFLICT", "Reconciliation requires a new receipt identity.");
  assert(!current.execution.receiptHistory.some((prior) => prior.receiptId === event.receipt.receiptId), "DUPLICATE_EVENT_CONFLICT", `Receipt ${event.receipt.receiptId} was already recorded in immutable receipt history.`);
  const uncertain = current.execution.state === "unknown";
  const supplemental = current.execution.state === "executed" && current.verification.state === "applied_unverified";
  assert(uncertain || supplemental, "ILLEGAL_TRANSITION", "Only an uncertain or explicitly applied-unverified batch may be reconciled.");
  assert(event.receipt.verification === "verified", "INVALID_RECEIPT", "Late reconciliation requires a fresh verified receipt; failed or uncertain evidence remains terminal.");
}

function reconciledExecution(current: WorkflowBatch, stored: WorkflowReceipt): WorkflowExecutionEvidence {
  return { ...current.execution, state: stored.execution, mutation: stored.mutation, mayHaveMutated: stored.mayHaveMutated, receiptId: stored.receiptId, receivedAt: stored.receivedAt, receipt: stored, receiptHistory: [...current.execution.receiptHistory, stored] };
}

const settleReconciliation: Transition<"batch.reconciled"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assertReconciliation(current, event);
  const rows = validateOutcomeRows(event.receipt, current, next.operations);
  validateCreatedBindingsAgainstBatch(event.receipt, current, rows, next.operations);
  const reconciled: WorkflowBatch = {
    ...current,
    execution: reconciledExecution(current, storedReceipt(event.receipt, rows)),
    verification: verificationEvidence(event.receipt, event.receipt.verification),
    recovery: { ...idleRecovery("available", event.receipt.mayHaveMutated), dispatch: current.recovery.dispatch },
    updatedAt: event.at,
  };
  next.batches = setRecord(next.batches, event.batchId, reconciled);
  updateOutcomeRows(next, rows);
  recordReceiptHostEvidence(next, current, event.receipt);
  refreshOwnersAfterReconciliation(next, reconciled, event.at);
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

/** Receipt settlement: an ordinary host receipt, a settlement before any dispatch, and a later reconciliation of uncertain or applied-unverified evidence. */
export const SETTLEMENT_TRANSITIONS = {
  "batch.rejected": settlePreDispatch,
  "batch.abandonedBeforeApply": settlePreDispatch,
  "batch.receipt": settleReceipt,
  "batch.reconciled": settleReconciliation,
} satisfies TransitionSlice;
