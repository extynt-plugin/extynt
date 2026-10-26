// The plan lifecycle an agent host drives by id: list, present, recall, status, approve, cancel and receipt.
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import type { PlanStatus, StoredPlan, ToolContext } from "./contracts.js";
import { PROPOSAL_OPERATION_LIMIT } from "./core-constants.js";
import { jobBatches, jobStatus } from "./job-status.js";
import { booleanAt, jsonOf, objectOf, stringAt } from "./json.js";
import type { JsonFields } from "./json.js";
import { composedOperations } from "./operations.js";
import { compactPlanEcho } from "./operation-echo.js";
import { planOperations } from "./plan-coherence.js";
import { approvalRefusal, unverifiedApprovalRefusal } from "./plan-approval.js";
import { planPathProblem } from "./path-policy.js";
import { getPlan, now } from "./plan-store.js";
import { planVerification } from "./plan-verification.js";
import { receiptOf } from "./stored-receipt.js";
import type { AE_APPROVE_PLAN, AE_CANCEL_PLAN, AE_GET_PLAN_STATUS, AE_GET_RECEIPT, AE_LIST_PLANS, AE_PRESENT_PLAN, AE_RECALL_PLAN } from "./tool-specs-plan.js";
import { toolError, toolSuccess } from "./tool-result.js";
import type { ToolBase, ToolResult } from "./tool-result.js";

type ListArgs = Infer<typeof AE_LIST_PLANS.input.decoder>;
type PresentArgs = Infer<typeof AE_PRESENT_PLAN.input.decoder>;
type RecallArgs = Infer<typeof AE_RECALL_PLAN.input.decoder>;
type StatusArgs = Infer<typeof AE_GET_PLAN_STATUS.input.decoder>;
type ApproveArgs = Infer<typeof AE_APPROVE_PLAN.input.decoder>;
type CancelArgs = Infer<typeof AE_CANCEL_PLAN.input.decoder>;
type ReceiptArgs = Infer<typeof AE_GET_RECEIPT.input.decoder>;

type JobColumns = { jobId: string | null; job: JsonValue; jobBatch: number | null };

function isEditable(status: PlanStatus): boolean {
  return status === "draft" || status === "prepared" || status === "presented";
}

function approvalExpired(record: StoredPlan, context: ToolContext): boolean {
  const capability = record.approvalCapability;
  return capability !== undefined && Date.parse(capability.expiresAt) <= now(context).getTime();
}

interface Limits {
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

function clampedLimit(given: number | undefined, limits: Limits): number {
  const whole = given !== undefined && Number.isInteger(given) ? given : undefined;
  return whole === undefined ? limits.fallback : Math.min(limits.max, Math.max(limits.min, whole));
}

function lostPlanRows(context: ToolContext): JsonObject[] {
  return (context.lostPlans?.cancelled(5) ?? []).map((lost) => objectOf({
    planId: lost.planId, status: "cancelled", summary: lost.summary, createdAt: lost.at, updatedAt: lost.at, presentation: null, postcondition: null,
    mayHaveMutated: false, approvalExpired: false, droppedBecause: lost.message, jobId: null, job: null, jobBatch: null,
  }));
}

function jobColumns(record: StoredPlan, context: ToolContext): JobColumns {
  const jobId = record.jobId;
  if (!jobId) return { jobId: null, job: null, jobBatch: null };
  const ordinal = jobBatches(context, jobId).findIndex((batch) => batch.plan.planId === record.plan.planId);
  return { jobId, job: jsonOf(jobStatus(context, jobId)), jobBatch: ordinal < 0 ? null : ordinal + 1 };
}

function listRow(record: StoredPlan, context: ToolContext): JsonObject {
  const receipt = receiptOf(record);
  return objectOf({
    planId: record.plan.planId,
    status: record.status,
    summary: record.plan.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    presentation: jsonOf(record.presentation ?? null),
    postcondition: stringAt(receipt, "postcondition") ?? null,
    mayHaveMutated: booleanAt(receipt, "mayHaveMutated") === true,
    approvalExpired: approvalExpired(record, context),
    variantSetId: record.variantSetId,
    ...jobColumns(record, context),
  });
}

/** Lists the session's plans, newest first, then the plans the panel lost. */
export function listPlans(base: ToolBase, args: ListArgs, context: ToolContext): ToolResult {
  const records = [...(context.plans?.values() ?? [])];
  const limit = clampedLimit(args.limit, { fallback: 20, min: 1, max: 100 });
  const newest = records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  return { ...toolSuccess(base, [...newest.map((record) => listRow(record, context)), ...lostPlanRows(context)]), truncated: records.length > limit };
}

/** Shows the prepared plan to the user and returns its approval capability. */
export function presentPlan(base: ToolBase, args: PresentArgs, context: ToolContext): ToolResult {
  const record = getPlan(args.planId, context);
  if ("error" in record) return record;
  if (record.status === "prepared") record.status = "presented";
  record.updatedAt = now(context).toISOString();
  return toolSuccess(base, objectOf({ planId: record.plan.planId, status: record.status, presentation: jsonOf(record.presentation), approvalRequired: true, approvalCapability: jsonOf(record.approvalCapability ?? null) }));
}

function recallCursor(cursor: number | undefined, total: number): number | ToolResult {
  if (cursor === undefined) return 0;
  const index = Number.isInteger(cursor) ? cursor : undefined;
  if (index === undefined || index < 0) return toolError("INVALID_ARGUMENT", "cursor must be a non-negative integer operation index; nextCursor from an earlier recall is one.");
  if (total > 0 && index >= total) return toolError("INVALID_ARGUMENT", `cursor ${index} is past the end of the plan's ${total} operations (0-based, 0-${total - 1}).`);
  return index;
}

/** An explicit recall of a stored plan's operations, at any status. */
export function recallPlan(base: ToolBase, args: RecallArgs, context: ToolContext): ToolResult {
  const record = getPlan(args.planId, context);
  if ("error" in record) return record;
  const stored = planOperations(record);
  const fromIndex = recallCursor(args.cursor, stored.length);
  if (typeof fromIndex !== "number") return fromIndex;
  const page = stored.slice(fromIndex, fromIndex + clampedLimit(args.limit, { fallback: 64, min: 1, max: PROPOSAL_OPERATION_LIMIT }));
  const nextCursor = fromIndex + page.length < stored.length ? fromIndex + page.length : null;
  return toolSuccess(base, objectOf({
    planId: record.plan.planId,
    status: record.status,
    editable: isEditable(record.status),
    summary: record.plan.summary,
    operationCount: stored.length,
    fromIndex,
    operations: jsonOf(page),
    nextCursor,
    next: nextCursor === null ? undefined : `Operations ${fromIndex}-${nextCursor - 1} of ${stored.length}; call ae_recall_plan with cursor ${nextCursor} for the rest before planning from this list.`,
  }));
}

function editableEcho(record: StoredPlan): JsonFields {
  return isEditable(record.status) ? { editable: true, operations: jsonOf(compactPlanEcho(record.plan).operations) } : {};
}

/** Reports where a plan stands, with its receipt once the host posted one. */
export function planStatus(base: ToolBase, args: StatusArgs, context: ToolContext): ToolResult {
  const record = getPlan(args.planId, context);
  if ("error" in record) return record;
  const receipt = record.receipt ? jsonOf(record.receipt) : null;
  return toolSuccess(base, objectOf({
    planId: record.plan.planId,
    status: record.status,
    verified: record.status === "verified",
    postcondition: stringAt(receiptOf(record), "postcondition") ?? null,
    awaitingHostApply: record.status === "approved",
    approvalExpiresAt: record.approvalCapability?.expiresAt ?? null,
    approvalExpired: approvalExpired(record, context),
    warning: record.status === "applied_unverified" ? "The host reported the operations as executed, but verification did not observe them. Read ae_get_receipt before treating this plan as applied." : undefined,
    snapshotFingerprint: record.plan.snapshotFingerprint,
    updatedAt: record.updatedAt,
    ...editableEcho(record),
    receipt,
  }));
}

/** Approves a presented plan for the host to apply, once every approval rule passes. */
export function approvePlan(base: ToolBase, args: ApproveArgs, context: ToolContext): ToolResult {
  const record = getPlan(args.planId, context);
  if ("error" in record) return record;
  const refusal = approvalRefusal(record, context);
  if (refusal) return refusal;
  const pathProblem = planPathProblem(composedOperations(record.plan));
  if (pathProblem) return toolError(pathProblem.code, pathProblem.message);
  const verification = planVerification(record.plan, context);
  if (verification.requiresAcknowledgement && args.acknowledgeUnverified !== true) return unverifiedApprovalRefusal(verification);
  if (verification.requiresAcknowledgement) record.verificationAcknowledged = { at: now(context).toISOString(), counts: verification.counts };
  else delete record.verificationAcknowledged;
  record.status = "approved";
  record.updatedAt = now(context).toISOString();
  return toolSuccess(base, objectOf({
    planId: record.plan.planId,
    status: record.status,
    verification: jsonOf({ requiresAcknowledgement: verification.requiresAcknowledgement, counts: verification.counts }),
    plan: jsonOf(record.plan),
    approval: jsonOf(record.approvalCapability),
    mailbox: objectOf({ operation: "apply_plan", planId: record.plan.planId, digest: record.plan.digest }),
  }));
}

/** Cancels a plan the host has not applied. */
export function cancelPlan(base: ToolBase, args: CancelArgs, context: ToolContext): ToolResult {
  const record = getPlan(args.planId, context);
  if ("error" in record) return record;
  if (record.status === "applied" || record.status === "verified" || record.status === "applied_unverified") return toolError("PLAN_ALREADY_APPLIED", "The host may already have executed this plan; it cannot be cancelled. Use After Effects Undo and inspect the receipt.");
  record.status = "cancelled";
  record.updatedAt = now(context).toISOString();
  return toolSuccess(base, { planId: record.plan.planId, status: record.status });
}

/** The receipt the host posted for a plan. */
export function getReceipt(base: ToolBase, args: ReceiptArgs, context: ToolContext): ToolResult {
  const { planId } = args;
  if (!planId) return toolError("INVALID_ARGUMENT", "planId is required.");
  const receipt = context.plans?.get(planId)?.receipt ?? context.receipts?.get(planId);
  return receipt ? toolSuccess(base, { planId, receipt: jsonOf(receipt) }) : toolError("RECEIPT_NOT_FOUND", "No receipt has been recorded for this plan.");
}
