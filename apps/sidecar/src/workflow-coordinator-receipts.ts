// Turns the panel's receipts for an applied plan or an undo into the workflow's receipts.

import type { StoredReceipt } from "@extynt/mcp-server";
import type { ActionPlan } from "@extynt/action-plan";
import type { WorkflowOperationOutcome, WorkflowReceipt, WorkflowUndoReceipt } from "@extynt/workflow";
import { authoritativeCreatedBindings } from "./workflow-coordinator-created.js";
import { postconditionEvidence, receiptHostEvidence } from "./workflow-coordinator-evidence.js";
import { gradeReceipt, type ReceiptGrade } from "./workflow-coordinator-grading.js";
import { EVENT_ID_RE, eventId, iso, type WorkflowPlanRecord } from "./workflow-coordinator-types.js";
import { receiptFacts, type ReceiptFacts } from "./workflow-panel-receipt.js";
import type { EvidenceContext } from "./workflow-proportional-evidence.js";

interface BuildContext {
  readonly facts: ReceiptFacts;
  readonly record: WorkflowPlanRecord;
  readonly now: () => Date;
  readonly rows: readonly WorkflowOperationOutcome[];
  readonly grade: ReceiptGrade;
}

const UNVERIFIED_FAILURE_BASIS = "legacy receipt reported failed verification without a per-operation mismatch row";
const UNKNOWN_WRITE_BASIS = "the host did not report how far the write got, so no readback can speak for it";

function undoGroupsExceed(groups: ReceiptFacts["undoGroups"], operationCount: number): boolean {
  return groups !== undefined && (groups === "invalid" || !Number.isInteger(groups) || groups < 0 || groups > Math.max(1, operationCount));
}

function validateEnvelope(plan: ActionPlan, facts: ReceiptFacts): void {
  if (undoGroupsExceed(facts.undoGroups, plan.operations.length)) {
    throw Object.assign(new Error("The receipt reports more undo groups than the plan has operations."), { code: "MULTI_UNDO_BATCH" });
  }
  const before = facts.beforeFingerprint;
  if (before !== undefined && before !== plan.snapshotFingerprint) {
    throw Object.assign(new Error(`The workflow receipt was prepared against a different pre-apply snapshot (expected ${plan.snapshotFingerprint}, received ${before ?? "invalid"}).`), { code: "STALE_SNAPSHOT" });
  }
}

function receiptIdentity(record: WorkflowPlanRecord, facts: ReceiptFacts, prefix: string): string {
  return facts.receiptId !== undefined && EVENT_ID_RE.test(facts.receiptId) ? facts.receiptId : eventId(prefix, `${record.planId}:${record.receiptSequence}`);
}

function unknownReceipt(context: BuildContext): WorkflowReceipt {
  const { facts, record, now, rows, grade } = context;
  const unsettled = !grade.executed;
  const unknownRow = (row: WorkflowOperationOutcome): WorkflowOperationOutcome => ({ ...row, outcome: "unknown", verification: "unknown", mutation: "unknown", mayHaveMutated: true });
  return {
    receiptId: receiptIdentity(record, facts, "receipt"),
    receivedAt: facts.receivedAt ?? iso(now),
    execution: "unknown",
    mutation: grade.mutation === "none" ? "unknown" : grade.mutation,
    mayHaveMutated: true,
    verification: "unknown",
    verificationBasis: unsettled ? UNKNOWN_WRITE_BASIS : UNVERIFIED_FAILURE_BASIS,
    ...(facts.afterFingerprint === undefined ? {} : { observedFingerprint: facts.afterFingerprint }),
    outcomes: rows.map((row) => (unsettled || row.outcome === "applied_unconfirmed" ? unknownRow(row) : row)),
  };
}

function verificationBasisOf(facts: ReceiptFacts, grade: ReceiptGrade): string | undefined {
  if (grade.verification === "not_requested") return undefined;
  return facts.verificationReported ? "legacy panel verification classifier" : "legacy receipt postcondition";
}

function knownReceipt(context: BuildContext, plan: ActionPlan): WorkflowReceipt {
  const { facts, record, now, rows, grade } = context;
  const verificationBasis = verificationBasisOf(facts, grade);
  const createdBindings = authoritativeCreatedBindings({ plan, facts, rows, verification: grade.verification });
  return {
    receiptId: receiptIdentity(record, facts, "receipt"),
    receivedAt: facts.receivedAt ?? iso(now),
    execution: grade.execution,
    mutation: grade.mutation,
    mayHaveMutated: grade.mutation !== "none",
    verification: grade.verification,
    ...(verificationBasis ? { verificationBasis } : {}),
    ...(facts.afterFingerprint === undefined ? {} : { observedFingerprint: facts.afterFingerprint }),
    outcomes: rows,
    ...(createdBindings?.length ? { createdBindings } : {}),
  };
}

function isUncertainFailure(grade: ReceiptGrade): boolean {
  return grade.execution === "executed" && grade.verification === "failed" && !grade.hasMismatch && !grade.explicitVerificationFailure;
}

/** The workflow receipt for the panel's receipt of an admitted plan; a receipt that contradicts the plan is refused with a coded error. */
export function workflowReceipt(input: { readonly receipt: StoredReceipt; readonly record: WorkflowPlanRecord; readonly now: () => Date; readonly evidenceContext?: EvidenceContext }): WorkflowReceipt {
  const { receipt, record, now, evidenceContext } = input;
  const facts = receiptFacts(receipt);
  validateEnvelope(record.plan, facts);
  const { grade, rows } = gradeReceipt({ plan: record.plan, receipt, facts, batchId: record.batchId });
  const context: BuildContext = { facts, record, now, rows, grade };
  if (isUncertainFailure(grade) || grade.execution === "unknown") return unknownReceipt(context);
  const converted = knownReceipt(context, record.plan);
  const postconditions = postconditionEvidence(record, facts, converted.verification);
  const hostEvidence = receiptHostEvidence({ record, facts, rows, converted, now, ...(evidenceContext ? { evidenceContext } : {}) });
  return { ...converted, ...(postconditions ? { postconditions } : {}), ...(hostEvidence.length ? { hostEvidence } : {}) };
}

function undoStatus(facts: ReceiptFacts): WorkflowUndoReceipt["status"] {
  if (facts.status === "executed") return "executed";
  return facts.status === "unknown" ? "unknown" : "rejected";
}

function undoVerification(status: WorkflowUndoReceipt["status"], restored: boolean): WorkflowUndoReceipt["verification"] {
  if (status === "executed") return restored ? "restored" : "undo_unverified";
  return status === "unknown" ? "unknown" : "unavailable";
}

/** The workflow receipt for the panel's receipt of an undo. */
export function workflowUndoReceipt(receipt: StoredReceipt, record: WorkflowPlanRecord, now: () => Date): WorkflowUndoReceipt {
  const facts = receiptFacts(receipt);
  const status = undoStatus(facts);
  const restoredFingerprint = facts.afterFingerprint !== undefined && facts.undoRestored ? facts.afterFingerprint : undefined;
  return {
    receiptId: facts.receiptId !== undefined && EVENT_ID_RE.test(facts.receiptId) ? facts.receiptId : eventId("undo-receipt", `${record.planId}:${record.undoSequence}`),
    status,
    receivedAt: facts.receivedAt ?? iso(now),
    ...(restoredFingerprint ? { restoredFingerprint } : {}),
    verification: undoVerification(status, facts.undoRestored),
    basis: facts.method === undefined ? "legacy panel undo receipt" : `legacy undo method: ${facts.method.slice(0, 96)}`,
  };
}
