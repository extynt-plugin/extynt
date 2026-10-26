// Receipt validation: the structural, aggregate and relational rules a host receipt must satisfy before the reducer settles a batch on it.

import { assert, boundedText, id, timestamp } from "./assertions.js";
import { signature } from "./canonical-json.js";
import type { WorkflowOperationOutcome, WorkflowOperationOutcomeKind, WorkflowReceipt, WorkflowUndoReceipt } from "./evidence-types.js";
import { clone } from "./frozen-state.js";
import { MAX_WORKFLOW_CONTINUATION_BINDINGS, MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_OPERATIONS_PER_BATCH, MAX_WORKFLOW_SUMMARY_LENGTH } from "./limits.js";
import { isPlaceholderName } from "./placeholders.js";
import type { WorkflowBatch, WorkflowOperation } from "./state-types.js";
import { validateHostEvidence, validatePostconditionEvidence } from "./verification.js";

type OutcomeKinds = readonly WorkflowOperationOutcomeKind[];
type CreatedBinding = NonNullable<WorkflowReceipt["createdBindings"]>[number];

const FINGERPRINT_MAX = MAX_WORKFLOW_ID_LENGTH * 4;
const CONFIRMED_OUTCOMES: ReadonlySet<WorkflowOperationOutcomeKind> = new Set(["confirmed", "host_confirmed", "coerced_equivalent"]);
const APPLIED_OUTCOMES: ReadonlySet<WorkflowOperationOutcomeKind> = new Set(["confirmed", "host_confirmed", "coerced_equivalent", "applied_unconfirmed"]);
const FAILED_OUTCOMES: ReadonlySet<WorkflowOperationOutcomeKind> = new Set(["failed_during_apply", "applied_before_failure", "unknown"]);
const CONTRADICTS_APPLIED_PREFIX: ReadonlySet<WorkflowOperationOutcomeKind> = new Set(["failed_during_apply", "readback_mismatch", "rejected_before_apply", "not_attempted", "unknown"]);
const POSITIVE_VERIFICATION: ReadonlySet<string> = new Set(["verified", "applied_unverified"]);
const EXECUTED_UNDO: ReadonlySet<string> = new Set(["restored", "undo_unverified", "mismatch"]);
const NON_EXECUTED_UNDO: ReadonlySet<string> = new Set(["unavailable", "unknown", "mismatch"]);

function validateReadbackEvidence(readback: WorkflowOperationOutcome["readback"]): void {
  if (!readback) return;
  if (readback.targetLayerId !== undefined) boundedText(readback.targetLayerId, "readback target layer", MAX_WORKFLOW_ID_LENGTH);
  if (readback.expected !== undefined) boundedText(readback.expected, "readback expected value", MAX_WORKFLOW_SUMMARY_LENGTH);
  if (readback.observed !== undefined) boundedText(readback.observed, "readback observed value", MAX_WORKFLOW_SUMMARY_LENGTH);
}

function expectedOperation(current: WorkflowBatch, ordinal: number, operations: Readonly<Record<string, WorkflowOperation>>): WorkflowOperation | undefined {
  const operationId = current.operationIds[ordinal];
  assert(operationId !== undefined, "INVALID_RECEIPT", "Receipt outcome row count must match admitted operations.");
  return operations[operationId];
}

function validateOutcomeRow(row: WorkflowOperationOutcome, ordinal: number, current: WorkflowBatch, operations: Readonly<Record<string, WorkflowOperation>>): void {
  const operation = expectedOperation(current, ordinal, operations);
  assert(operation !== undefined && row.operationId === operation.operationId && row.ordinal === ordinal && row.type === operation.type, "INVALID_RECEIPT", "Receipt outcome rows must match reducer-owned operation IDs, ordinals, and types.");
  assert(row.mayHaveMutated === (row.mutation !== "none"), "INVALID_RECEIPT", "Outcome mutation evidence is contradictory.");
  if (CONFIRMED_OUTCOMES.has(row.outcome)) assert(row.verification === "verified", "INVALID_RECEIPT", "A confirmed outcome requires verified evidence.");
  if (row.outcome === "readback_mismatch") assert(row.verification === "failed", "INVALID_RECEIPT", "A readback mismatch requires failed verification.");
  if (row.outcome === "rejected_before_apply") assert(row.mutation === "none" && row.verification === "not_requested", "INVALID_RECEIPT", "A rejected operation cannot carry mutation or verification evidence.");
  validateReadbackEvidence(row.readback);
}

function validateAggregateByExecution(receipt: WorkflowReceipt, kinds: OutcomeKinds): void {
  if (receipt.execution === "rejected_before_apply") assert(kinds.every((kind) => kind === "rejected_before_apply" || kind === "not_attempted"), "INVALID_RECEIPT", "A rejected aggregate cannot contain applied operation outcomes.");
  if (receipt.execution === "failed_during_apply") assert(kinds.some((kind) => FAILED_OUTCOMES.has(kind)), "INVALID_RECEIPT", "A failed aggregate requires a failed or uncertain operation row.");
  if (receipt.execution === "executed" && receipt.verification === "failed") assert(kinds.includes("readback_mismatch"), "INVALID_RECEIPT", "An executed/readback-failed aggregate requires a readback_mismatch row.");
}

function validateAggregateByVerification(receipt: WorkflowReceipt, kinds: OutcomeKinds): void {
  if (receipt.verification === "verified") assert(kinds.every((kind) => CONFIRMED_OUTCOMES.has(kind)), "INVALID_RECEIPT", "Verified aggregate evidence requires a confirmed row for every operation.");
  if (receipt.verification === "applied_unverified") assert(kinds.includes("applied_unconfirmed") && !kinds.some((kind) => CONTRADICTS_APPLIED_PREFIX.has(kind)), "INVALID_RECEIPT", "Applied-unverified evidence must describe an applied prefix without contradictory rows.");
}

function validateFailurePrefix(kinds: OutcomeKinds): void {
  const failureAt = kinds.findIndex((kind) => kind === "failed_during_apply" || kind === "applied_before_failure");
  if (failureAt < 0) return;
  assert(kinds.slice(failureAt).every((kind) => !APPLIED_OUTCOMES.has(kind)), "INVALID_RECEIPT", "A failed prefix cannot contain applied rows after the failure.");
}

/** Checks a receipt's outcome rows against the admitted operations and the receipt's aggregate claims; returns private copies of the rows. */
export function validateOutcomeRows(receipt: WorkflowReceipt, current: WorkflowBatch, operations: Readonly<Record<string, WorkflowOperation>>): readonly WorkflowOperationOutcome[] {
  const rows = receipt.outcomes;
  assert(rows.length === current.operationIds.length, "INVALID_RECEIPT", "Receipt outcome row count must match admitted operations.");
  rows.forEach((row, ordinal) => validateOutcomeRow(row, ordinal, current, operations));
  const kinds = rows.map((row) => row.outcome);
  validateAggregateByExecution(receipt, kinds);
  validateAggregateByVerification(receipt, kinds);
  if (receipt.execution === "failed_during_apply") validateFailurePrefix(kinds);
  return rows.map(clone);
}

/** Whether two receipts carry identical evidence. */
export function sameReceipt(left: WorkflowReceipt, right: WorkflowReceipt): boolean {
  return signature(left) === signature(right);
}

function validateReceiptHeader(receipt: WorkflowReceipt): void {
  id(receipt.receiptId, "receiptId");
  timestamp(receipt.receivedAt);
  if (receipt.verificationBasis !== undefined) boundedText(receipt.verificationBasis, "verification basis", MAX_WORKFLOW_SUMMARY_LENGTH);
  if (receipt.observedFingerprint !== undefined) boundedText(receipt.observedFingerprint, "observed fingerprint", FINGERPRINT_MAX);
  assert(receipt.mayHaveMutated === (receipt.mutation !== "none"), "INVALID_RECEIPT", "mayHaveMutated must agree with the mutation evidence.");
}

function validateReceiptOutcome(row: WorkflowOperationOutcome, seen: Set<string>): void {
  id(row.operationId, "outcome operationId");
  assert(Number.isInteger(row.ordinal) && row.ordinal >= 0, "INVALID_RECEIPT", "Outcome ordinals must be non-negative integers.");
  boundedText(row.type, "outcome type", MAX_WORKFLOW_ID_LENGTH);
  assert(!seen.has(row.operationId), "INVALID_RECEIPT", "Receipt outcome operation IDs must be unique.");
  seen.add(row.operationId);
  assert(row.mayHaveMutated === (row.mutation !== "none"), "INVALID_RECEIPT", "Outcome mayHaveMutated must agree with mutation evidence.");
  if (row.basis !== undefined) boundedText(row.basis, "outcome basis", MAX_WORKFLOW_SUMMARY_LENGTH);
  if (row.observedFingerprint !== undefined) boundedText(row.observedFingerprint, "outcome fingerprint", FINGERPRINT_MAX);
}

function validateReceiptOutcomes(receipt: WorkflowReceipt): void {
  assert(receipt.outcomes.length <= MAX_WORKFLOW_OPERATIONS_PER_BATCH, "LIMIT_EXCEEDED", "Receipt outcome rows exceed the operation bound.");
  const seen = new Set<string>();
  for (const row of receipt.outcomes) validateReceiptOutcome(row, seen);
}

const EXECUTION_RULES: Readonly<Record<WorkflowReceipt["execution"], { readonly holds: (receipt: WorkflowReceipt, positive: boolean) => boolean; readonly message: string }>> = {
  rejected_before_apply: { holds: (receipt) => receipt.mutation === "none" && !receipt.mayHaveMutated && receipt.verification === "not_requested", message: "A pre-apply rejection cannot be verified or may have mutated." },
  failed_during_apply: { holds: (_receipt, positive) => !positive, message: "A failed apply cannot carry a success verification." },
  unknown: { holds: (receipt, positive) => receipt.mutation !== "none" && !positive, message: "An uncertain apply must remain uncertain or failed." },
  executed: { holds: (receipt, positive) => receipt.mutation === "applied" && receipt.mayHaveMutated && (positive || receipt.verification === "failed"), message: "An executed apply must be applied with mayHaveMutated=true and a compatible verification result." },
};

function validateReceiptExecution(receipt: WorkflowReceipt): void {
  const rule = EXECUTION_RULES[receipt.execution];
  assert(rule.holds(receipt, POSITIVE_VERIFICATION.has(receipt.verification)), "INVALID_RECEIPT", rule.message);
}

function validateReceiptVerification(receipt: WorkflowReceipt): void {
  if (POSITIVE_VERIFICATION.has(receipt.verification)) assert(Boolean(receipt.verificationBasis), "INVALID_RECEIPT", "A positive verification requires a bounded basis.");
  if (receipt.verification === "verified") assert(Boolean(receipt.observedFingerprint), "INVALID_RECEIPT", "Verified evidence requires an observed fingerprint.");
}

function validateCreatedBinding(binding: CreatedBinding, placeholders: Set<string>, createdIds: Set<string>): void {
  assert(isPlaceholderName(binding.placeholder), "INVALID_RECEIPT", "Created-id binding placeholders must be bounded __new__ names.");
  assert(binding.createdId.length > 0 && Buffer.byteLength(binding.createdId, "utf8") <= FINGERPRINT_MAX, "INVALID_RECEIPT", "Created-id binding ids must be bounded strings.");
  assert(!binding.createdId.startsWith("__new__:"), "INVALID_RECEIPT", "Created-id binding ids must be host identities, not placeholders.");
  id(binding.operationId, "created binding operationId");
  boundedText(binding.readbackField, "created binding readback field", MAX_WORKFLOW_ID_LENGTH);
  boundedText(binding.observedFingerprint, "created binding observed fingerprint", FINGERPRINT_MAX);
  assert(!placeholders.has(binding.placeholder), "DUPLICATE_EVENT_CONFLICT", "Created-id binding placeholders must be unique.");
  assert(!createdIds.has(binding.createdId), "DUPLICATE_EVENT_CONFLICT", "Created-id binding host identities must be unique.");
  placeholders.add(binding.placeholder);
  createdIds.add(binding.createdId);
}

function validateCreatedBindings(receipt: WorkflowReceipt): void {
  if (receipt.createdBindings === undefined) return;
  assert(receipt.verification === "verified", "INVALID_RECEIPT", "Created-id bindings require a verified creator receipt.");
  assert(receipt.createdBindings.length <= MAX_WORKFLOW_CONTINUATION_BINDINGS, "LIMIT_EXCEEDED", "Created-id bindings exceed the continuation bound.");
  const placeholders = new Set<string>();
  const createdIds = new Set<string>();
  for (const binding of receipt.createdBindings) validateCreatedBinding(binding, placeholders, createdIds);
}

/** Throws the named error unless the receipt is internally consistent: identity, timestamps, execution versus mutation versus verification, outcome rows, postconditions, host evidence and created bindings. */
export function validateReceipt(receipt: WorkflowReceipt): void {
  validateReceiptHeader(receipt);
  validateReceiptOutcomes(receipt);
  validateReceiptExecution(receipt);
  validateReceiptVerification(receipt);
  validatePostconditionEvidence(receipt.postconditions);
  validateHostEvidence(receipt.hostEvidence);
  validateCreatedBindings(receipt);
}

function validateUndoStatus(receipt: WorkflowUndoReceipt): void {
  if (receipt.status !== "executed") {
    assert(NON_EXECUTED_UNDO.has(receipt.verification), "INVALID_RECEIPT", "A non-executed undo must retain unavailable/unknown evidence.");
    return;
  }
  if (receipt.verification === "restored") assert(receipt.restoredFingerprint !== undefined && receipt.restoredFingerprint.length > 0, "INVALID_RECEIPT", "A restored undo requires a restored fingerprint.");
  assert(EXECUTED_UNDO.has(receipt.verification), "INVALID_RECEIPT", "An executed undo must be restored, mismatched, or explicitly unverified.");
}

/** Throws the named error unless an undo receipt's identity, timestamp, status, verification and basis are consistent. */
export function validateUndoReceipt(receipt: WorkflowUndoReceipt): void {
  id(receipt.receiptId, "undoReceiptId");
  timestamp(receipt.receivedAt);
  validateUndoStatus(receipt);
  if (receipt.basis !== undefined) boundedText(receipt.basis, "undo receipt basis", MAX_WORKFLOW_SUMMARY_LENGTH);
}
