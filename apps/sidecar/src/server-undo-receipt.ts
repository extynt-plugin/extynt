// Settles an undo receipt: what the undo amounted to, the receipt stored for it, and the plan, lineage, learned usage and job undo that follow from it.
import { decodeOrThrow, fallback, number, string } from "@extynt/decode";
import { receiptJson, statusFromApplyReceipt, undoabilityOfOperation, type UndoDetails, type StoredReceipt } from "@extynt/mcp-server";

import { forgetUndonePlanUsage } from "./effect-notes-learn.js";
import { retainNativeMutationLease } from "./native-mutation-lease.js";
import { accepted, refused } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import { boundedCount, boundedText, type ReceiptHead } from "./server-receipt-body.js";
import type { ReceiptContext, ReceiptPlanRecord } from "./server-receipt-context.js";
import { undoReceiptSemantic } from "./server-receipt-semantic.js";
import { lenientObject } from "./server-mcp-arguments.js";
import { boundedHostError } from "./server-host-error.js";
import { snapshotDifferences } from "./server-snapshot-differences.js";
import { TERMINAL_PLAN_STATUSES } from "./server-limits.js";
import { keepReceipt, withUndoSemantic } from "./server-stored-receipt.js";

type UndoProgress = { hostStatus: string; executed: boolean; groups: number; times: number; undoneNow: number; finished: boolean; restored: boolean };

type UndoFacts = UndoProgress & {
  planId: string;
  record: ReceiptPlanRecord | undefined;
  receivedAt: string;
  retryId: string | null;
  reconcileLate: boolean;
  afterFingerprint: string | null;
  differences: string[] | undefined;
  status: string;
  leftBehind: string[];
};

type UndoInput = { context: ReceiptContext; head: ReceiptHead; record: ReceiptPlanRecord | undefined; receivedAt: string };

const MAX_PLAN_ID_CHARS = 128;
const MAX_UNDO_GROUPS = 1000;
const EXECUTED_UNDO_STATUSES = new Set(["executed", "redone", "redo_failed"]);
const UNKNOWN_ACTION = "After Effects did not answer the undo. It may have run; inspect the project before any further Undo or Redo.";

const appliedFacts = lenientObject({ undoGroups: fallback(number(), undefined), beforeFingerprint: fallback(string(), undefined) });

function undoStatus(hostStatus: string, executed: boolean): string {
  if (hostStatus === "unknown" || hostStatus === "redone" || hostStatus === "redo_failed") return hostStatus;
  return executed ? "executed" : "rejected";
}

function canReconcile(context: ReceiptContext, record: ReceiptPlanRecord | undefined, planId: string): boolean {
  return Boolean(record && !context.state.inFlight && TERMINAL_PLAN_STATUSES.has(record.status) && context.state.workflowCoordinator.canReconcileLateUndo(planId));
}

function undoLeftBehind(record: ReceiptPlanRecord | undefined): string[] {
  if (!record || record.plan.schemaVersion !== "0.2") return [];
  const unreachable = record.plan.operations.filter((operation) => undoabilityOfOperation(operation) === "not-undoable");
  return [...new Set(unreachable.map((operation) => String(operation.type ?? "")))].filter(Boolean);
}

function undoneBeforeOf(record: ReceiptPlanRecord | undefined, groups: number): number {
  return Math.min(groups, Math.max(0, Math.floor(record?.undo?.undone ?? 0)));
}

function isRestored(hostStatus: string, finished: boolean, after: string | null, before: string | null): boolean {
  return hostStatus === "executed" && finished && after !== null && after === before;
}

function undoProgress(head: ReceiptHead, record: ReceiptPlanRecord | undefined, afterFingerprint: string | null): UndoProgress {
  const applied = decodeOrThrow(appliedFacts, record?.receipt);
  const hostStatus = head.status;
  const groups = boundedCount(applied.undoGroups, MAX_UNDO_GROUPS) ?? 1;
  const times = boundedCount(head.wire.times, MAX_UNDO_GROUPS) ?? 1;
  const undoneBefore = undoneBeforeOf(record, groups);
  const undoneNow = hostStatus === "executed" ? Math.min(groups, undoneBefore + times) : undoneBefore;
  const finished = undoneNow >= groups;
  const executed = head.wire.executed === true && EXECUTED_UNDO_STATUSES.has(hostStatus);
  const restored = isRestored(hostStatus, finished, afterFingerprint, applied.beforeFingerprint ?? null);
  return { hostStatus, executed, groups, times, undoneNow, finished, restored };
}

function undoDifferences(context: ReceiptContext, progress: UndoProgress, planId: string): string[] | undefined {
  const latest = context.planState.normalizedLatest();
  const preApply = context.state.preApply;
  const diverged = progress.executed && !progress.restored && progress.hostStatus === "executed";
  return diverged && preApply?.planId === planId && latest ? snapshotDifferences(preApply.snapshot, latest) : undefined;
}

function undoFacts(input: UndoInput): UndoFacts {
  const { context, head, record, receivedAt } = input;
  const planId = head.planId.slice(0, MAX_PLAN_ID_CHARS);
  const afterFingerprint = context.planState.normalizedLatest()?.fingerprint ?? null;
  const progress = undoProgress(head, record, afterFingerprint);
  return {
    planId, record, receivedAt, retryId: head.receiptId, reconcileLate: canReconcile(context, record, planId), afterFingerprint, ...progress,
    differences: undoDifferences(context, progress, planId), status: undoStatus(progress.hostStatus, progress.executed), leftBehind: undoLeftBehind(record),
  };
}

function leftBehindNote(leftBehind: string[]): string {
  return `The project is back, but ${leftBehind.length === 1 ? "one step" : `${leftBehind.length} steps`} wrote something outside it: ${leftBehind.join(", ")}. After Effects' Undo does not remove a file or stop a render, so those outputs are still there.`;
}

function mismatchAction(facts: UndoFacts): string {
  if (facts.finished) return "Undo ran but the project does not match the pre-plan snapshot. Inspect it; do not press Undo or Redo again until you know what changed.";
  return `Undid ${facts.times} undo group${facts.times === 1 ? "" : "s"}; ${facts.groups - facts.undoneNow} of ${facts.groups} left. The state in between cannot be checked against the pre-plan snapshot, so this is not verified either way.`;
}

function outcomeDetails(facts: UndoFacts): UndoDetails {
  if (facts.status === "redone") return { redone: true };
  if (facts.status === "unknown") return { action: UNKNOWN_ACTION };
  if (facts.status === "redo_failed") return { redoFailed: true, action: "Ask the user to press Shift+Cmd+Z in After Effects." };
  return {};
}

function undoDetails(head: ReceiptHead, facts: UndoFacts): UndoDetails {
  const mismatch = facts.executed && !facts.restored && facts.hostStatus === "executed";
  return {
    executed: facts.executed, groups: facts.groups, undone: facts.undoneNow, remaining: facts.groups - facts.undoneNow,
    method: boundedText(head.wire.method, 32, null), restoredPreApplyFingerprint: facts.restored,
    ...(facts.executed && facts.leftBehind.length ? { leftBehind: facts.leftBehind, leftBehindNote: leftBehindNote(facts.leftBehind) } : {}),
    ...(mismatch ? { action: mismatchAction(facts), ...(facts.differences ? { differences: facts.differences } : {}) } : {}),
    ...outcomeDetails(facts),
  };
}

function buildUndoReceipt(head: ReceiptHead, facts: UndoFacts): StoredReceipt {
  return {
    ...(facts.retryId ? { receiptId: facts.retryId } : {}), planId: facts.planId, operation: "undo_plan", status: facts.status, receivedAt: facts.receivedAt,
    afterFingerprint: facts.afterFingerprint, times: facts.times, groups: facts.groups, undone: facts.undoneNow, undo: undoDetails(head, facts), hostError: boundedHostError(head.wire.hostError),
  };
}

function sameUndoReceipt(record: ReceiptPlanRecord, head: ReceiptHead): boolean {
  const stored = record.undoReceipt;
  return stored !== undefined && withUndoSemantic(record).undoReceiptSemantic === undoReceiptSemantic(head.wire) && (!head.receiptId || stored.receiptId === head.receiptId);
}

function duplicateOutcome(head: ReceiptHead, record: ReceiptPlanRecord | undefined): ReceiverOutcome | undefined {
  if (!record) return undefined;
  if (!record.receipt) return refused(409, "PLAN_NOT_APPLIED", "This plan was never applied; an undo receipt cannot invent one.");
  if (sameUndoReceipt(record, head)) return accepted(200, { ok: true, receipt: receiptJson(record.undoReceipt), idempotent: true });
  if (head.receiptId && record.undoReceipt?.receiptId === head.receiptId) return refused(409, "RECEIPT_DUPLICATE_CONFLICT", "This undo receipt identity was already settled with different evidence.");
  return undefined;
}

function projectToWorkflow(context: ReceiptContext, receipt: StoredReceipt, facts: UndoFacts): ReceiverOutcome | undefined {
  if (!context.state.workflowCoordinator.hasPlan(facts.planId)) return undefined;
  try { context.runtime.projectWorkflowUndoReceipt({ planId: facts.planId, receipt, strict: true, reconcile: facts.reconcileLate }); }
  catch (error) {
    return refused(409, "WORKFLOW_SETTLEMENT_REFUSED", `The workflow undo settlement was refused; no legacy-only receipt was accepted. ${(error instanceof Error ? error.message : String(error))}`);
  }
  return undefined;
}

function undoPlanStatus(facts: UndoFacts, record: ReceiptPlanRecord): ReceiptPlanRecord["status"] {
  if (facts.restored) return "undone";
  if (facts.status === "unknown") return "undo_unverified";
  if (facts.status === "executed" || facts.status === "redo_failed") return facts.finished ? "undo_unverified" : "partially_undone";
  return statusFromApplyReceipt(record.receipt);
}

function updateUndoPlan(context: ReceiptContext, head: ReceiptHead, facts: UndoFacts, receipt: StoredReceipt): void {
  const record = facts.record;
  if (!record) return;
  record.undoReceipt = receipt;
  withUndoSemantic(record).undoReceiptSemantic = undoReceiptSemantic(head.wire);
  if (facts.hostStatus === "executed" && facts.groups > 1) record.undo = { groups: facts.groups, undone: facts.undoneNow, stateFingerprint: facts.afterFingerprint };
  record.status = undoPlanStatus(facts, record);
  record.updatedAt = facts.receivedAt;
  if (!facts.restored) return;
  for (const [fingerprint, link] of context.state.lineage) if (link.planId === facts.planId) context.state.lineage.delete(fingerprint);
}

function finishUndo(context: ReceiptContext, head: ReceiptHead, facts: UndoFacts, receipt: StoredReceipt): void {
  const { planId } = facts;
  keepReceipt(context.state.receipts, receipt);
  updateUndoPlan(context, head, facts, receipt);
  if (facts.restored) context.state.preferences.noteUndone(planId);
  forgetUndonePlanUsage(context.state.collection.effectNotes, { planId, known: facts.record !== undefined, status: facts.status, finished: facts.finished });
  if (context.state.inFlight?.kind === "undo_plan" && context.state.inFlight.id === planId) context.state.inFlight = undefined;
  context.jobUndo.continueJobUndo(planId, receipt, facts.restored);
  if (!context.state.workflowCoordinator.hasPlan(planId)) context.runtime.projectWorkflowUndoReceipt({ planId, receipt });
  context.transport.notifyChange();
}

/** Settles an undo receipt the host reported and answers it. */
export function recordUndoReceipt(context: ReceiptContext, head: ReceiptHead): ReceiverOutcome {
  const record = context.state.plans.get(head.planId.slice(0, MAX_PLAN_ID_CHARS));
  const receivedAt = context.state.now().toISOString();
  const duplicate = duplicateOutcome(head, record);
  if (duplicate) return duplicate;
  const facts = undoFacts({ context, head, record, receivedAt });
  const receipt = buildUndoReceipt(head, facts);
  retainNativeMutationLease(context.state, { ...head.wire, planId: facts.planId });
  const refusal = projectToWorkflow(context, receipt, facts);
  if (refusal) return refusal;
  finishUndo(context, head, facts, receipt);
  return accepted(201, { ok: true, receipt: receiptJson(receipt) });
}
