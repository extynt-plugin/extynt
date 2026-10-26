// What the host's receipt says about a plan's work: how it ended, why it was refused, how to retry, and why verification failed.
import type { PlanStatus, StoredPlan, ToolContext } from "./contracts.js";
import { numberAt, objectOf, stringAt } from "./json.js";
import type { JsonObject } from "@extynt/decode";
import { receiptOf, receivedAtOf, undoneGroupsOf, type StoredReceipt } from "./stored-receipt.js";
import { sessionPlans } from "./undo-stack.js";
import { verificationFailure } from "./verification-failure.js";

const UNDONE_STATUSES: ReadonlySet<PlanStatus> = new Set(["undone", "partially_undone", "undo_unverified"]);

type FailedOperation = { index: number; type: string | null; phase: string };

type ReceiptRefusal = { error?: string; errorMessage?: string; failedOperation?: FailedOperation };

type ReceiptRetry = { kind: string; instruction: string };

/** The plan status a posted apply receipt settles it to. */
export function statusFromApplyReceipt(receipt: Pick<StoredReceipt, "status" | "postcondition"> | undefined): PlanStatus {
  const status = receipt?.status;
  const postcondition = receipt?.postcondition;
  if ((status !== "executed" && status !== "rejected") || status === "rejected" || postcondition === "failed") return "failed";
  return postcondition === "passed" ? "verified" : "applied_unverified";
}

function isLatestWork(record: StoredPlan): boolean {
  return record.receipt !== undefined || record.status === "approved" || record.status === "applying" || record.status === "undo_requested";
}

function workTime(record: StoredPlan): string {
  const received = stringAt(receiptOf(record), "receivedAt");
  return received !== undefined && receivedAtOf(receiptOf(record)) !== undefined ? received : record.updatedAt;
}

/** The most recently applied or attempted plan among `plans`, whoever authored it. */
export function newestWorkRecord(plans: Iterable<StoredPlan>): StoredPlan | undefined {
  return [...plans].filter(isLatestWork).sort((left, right) => workTime(right).localeCompare(workTime(left)))[0];
}

function failedOperationOf(receipt: StoredReceipt): FailedOperation | undefined {
  const failure = receipt.failure;
  const index = numberAt(failure, "operationIndex");
  if (index === undefined || index < 0) return undefined;
  return { index, type: stringAt(failure, "operation") ?? null, phase: stringAt(failure, "phase") ?? "unknown" };
}

function refusalText(receipt: StoredReceipt): Pick<ReceiptRefusal, "error" | "errorMessage"> {
  const reported = receipt.hostError ?? receipt.error;
  const error = reported?.code;
  const message = reported?.message;
  return { ...(error ? { error } : {}), ...(message ? { errorMessage: message.slice(0, 320) } : {}) };
}

/** Host-refusal evidence, meaningful only when the host did not report successful execution. */
export function receiptRefusal(receipt: StoredReceipt | undefined): ReceiptRefusal | undefined {
  if (!receipt || receipt.status === "executed") return undefined;
  const failedOperation = failedOperationOf(receipt);
  const refusal: ReceiptRefusal = { ...refusalText(receipt), ...(failedOperation ? { failedOperation } : {}) };
  return Object.keys(refusal).length ? refusal : undefined;
}

function mayHaveMutated(receipt: StoredReceipt | undefined): boolean {
  return receipt?.mayHaveMutated === true;
}

function refusalRetry(receipt: StoredReceipt): ReceiptRetry | undefined {
  const refusal = receiptRefusal(receipt);
  if (mayHaveMutated(receipt)) return { kind: "reconcile_before_retry", instruction: "Refresh the snapshot and inspect the failed target before retrying; the host may have changed project state." };
  if (refusal?.failedOperation) return { kind: "repair_failed_operation", instruction: "Change the named operation from the host error and retry only the smallest dependency-complete batch." };
  return refusal?.error ? { kind: "change_failed_batch", instruction: "Use the host error code and message to change the batch before retrying; do not resend it unchanged." } : undefined;
}

/** The next step for an apply that did not succeed, or nothing when it succeeded or says nothing to act on. */
export function receiptRetry(receipt: StoredReceipt | undefined): ReceiptRetry | undefined {
  if (!receipt) return undefined;
  if (receipt.postcondition === "failed") return { kind: "repair_verification", instruction: "Use failedOperations and failureBasis to author the smallest corrective batch; do not report this work as complete." };
  return receipt.status === "executed" ? undefined : refusalRetry(receipt);
}

function undoGroupCount(receipt: JsonObject | undefined): number | null {
  const groups = numberAt(receipt, "undoGroups");
  if (groups === 0) return 0;
  return groups === undefined || groups < 1 ? null : Math.min(1000, Math.floor(groups));
}

function undoneGroupCount(record: StoredPlan): number {
  if (record.undo) return undoneGroupsOf(record);
  const undone = record.undoReceipt?.undone;
  return UNDONE_STATUSES.has(record.status) && undone !== undefined && Number.isFinite(undone) && undone > 0 ? Math.floor(undone) : 0;
}

/** What one plan's apply amounted to, in the queue's vocabulary: how it ended, whether the read-back confirmed it, and why not when it did not. */
export function workOutcomeView(record: StoredPlan): JsonObject {
  const receipt = record.receipt;
  const failure = receipt?.postcondition === "passed" ? undefined : verificationFailure(receipt);
  const retry = receiptRetry(receipt);
  return objectOf({
    status: record.status,
    summary: record.plan.summary,
    operations: record.plan.operations.length,
    applied: receipt ? receipt.status === "executed" : null,
    verified: receipt ? receipt.postcondition === "passed" : null,
    undoGroups: undoGroupCount(receiptOf(record)),
    undoneGroups: undoneGroupCount(record),
    ...(mayHaveMutated(receipt) ? { mayHaveMutated: true } : {}),
    ...receiptRefusal(receipt),
    ...(retry ? { retry } : {}),
    ...(failure ? { failedOperations: failure.failedOperations, failureBasis: failure.failureBasis } : {}),
  });
}

/** The newest work this session applied, in the queue's vocabulary. */
export function latestWorkView(context: ToolContext): JsonObject | null {
  const newest = newestWorkRecord(sessionPlans(context));
  return newest ? workOutcomeView(newest) : null;
}
