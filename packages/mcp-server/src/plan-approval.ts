// The rules an approval must pass, in the order they are asked; the first that fails is the refusal.
import type { PlanVerificationSummary, StoredPlan, ToolContext } from "./contracts.js";
import { booleanAt } from "./json.js";
import { sortNotices, verificationNotices } from "./notices.js";
import { now } from "./plan-store.js";
import { receiptOf } from "./stored-receipt.js";
import { toolError } from "./tool-result.js";
import type { ToolFailure } from "./tool-result.js";
import { variantApprovalAllowed } from "./variant-sets.js";

type ApprovalRule = (record: StoredPlan, context: ToolContext) => ToolFailure | undefined;

function refuseWhen(applies: boolean, code: string, message: string): ToolFailure | undefined {
  return applies ? toolError(code, message) : undefined;
}

function alreadyApplied(record: StoredPlan): ToolFailure | undefined {
  if (record.status === "applied_unverified") return toolError("PLAN_ALREADY_APPLIED", "The host already executed this plan but verification did not observe the result; re-approving risks applying it twice. Read ae_get_receipt and propose a fresh plan instead.");
  return refuseWhen(record.status === "verified" || record.status === "applied", "PLAN_ALREADY_APPLIED", "The plan has already been applied.");
}

const RULES: readonly ApprovalRule[] = [
  (record) => refuseWhen(record.status === "cancelled", "PLAN_CANCELLED", "The plan has been cancelled."),
  (record, context) => refuseWhen(!variantApprovalAllowed(context, record), "VARIANT_NOT_PICKED", "This plan is one option in a set the user has not chosen from, so it is not approved. The user applies it by picking it on its card in the extynt panel; nothing here can do that for them."),
  alreadyApplied,
  (record) => refuseWhen(record.status === "approved" || record.status === "applying", "PLAN_ALREADY_APPROVED", "This plan is already approved and queued for After Effects; approving again would execute it twice. Read ae_get_plan_status, or cancel and propose a fresh plan."),
  (record) => refuseWhen(record.status === "failed" && booleanAt(receiptOf(record), "mayHaveMutated") === true, "PLAN_MAY_HAVE_MUTATED", "This plan failed part-way and may have changed the project. Undo it with ae_undo_plan, which checks the project is still where the failure left it before pressing Undo, then propose a fresh plan against the current state."),
  (record) => refuseWhen(record.status === "undone" || record.status === "undo_requested" || record.status === "undo_unverified", "PLAN_UNDONE", "This plan was undone; propose it again to reapply."),
  (record) => refuseWhen(record.status === "draft", "PLAN_NOT_VALIDATED", "This plan is a draft: it failed validation when it was proposed (or is not sealed yet), so it cannot be approved and nothing was applied. Read its problems, repair it with ae_amend_plan or propose a corrected plan."),
  (record) => refuseWhen(!record.approvalCapability, "APPROVAL_UNAVAILABLE", "A connection to After Effects is required to issue an approval capability."),
  (record, context) => refuseWhen(record.approvalCapability !== undefined && Date.parse(record.approvalCapability.expiresAt) <= now(context).getTime(), "APPROVAL_EXPIRED", "The approval capability has expired; prepare a fresh plan."),
];

/** The first reason this plan cannot be approved now, or nothing when it can. */
export function approvalRefusal(record: StoredPlan, context: ToolContext): ToolFailure | undefined {
  for (const rule of RULES) {
    const refusal = rule(record, context);
    if (refusal) return refusal;
  }
  return undefined;
}

/** The refusal that names what could not be confirmed and asks for an explicit acknowledgement. */
export function unverifiedApprovalRefusal(verification: PlanVerificationSummary): ToolFailure {
  const notices = sortNotices(verificationNotices(verification).filter((notice) => notice.severity !== "note"));
  return toolError("UNVERIFIED_OPERATIONS", `Not applied. ${notices.map((notice) => `${notice.title} ${notice.detail}`).join(" ")} Tell the user what could not be confirmed, then approve again with acknowledgeUnverified: true.`);
}
