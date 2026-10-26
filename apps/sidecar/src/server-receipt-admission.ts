// Decides whether an apply receipt may settle its plan: who holds the host claim, whether the plan is already settled, whether the approval matches and whether the outcome makes sense.
import { receiptJson } from "@extynt/mcp-server";
import { accepted, refused } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import type { ReceiptHead } from "./server-receipt-body.js";
import type { ReceiptContext, ReceiptPlanRecord } from "./server-receipt-context.js";
import { receiptSemantic } from "./server-receipt-semantic.js";
import { IN_FLIGHT_PLAN_STATUSES, TERMINAL_PLAN_STATUSES } from "./server-limits.js";

/** The plan a receipt names and what is known about its claim. */
export type ApplyReceiptAdmission = { planId: string; admitting: ReceiptPlanRecord | undefined; claimed: boolean; preDispatch: boolean; reconcileLate: boolean };

const MAX_PLAN_ID_CHARS = 128;
const VALID_STATUSES = new Set(["executed", "rejected"]);
const VALID_POSTCONDITIONS = new Set(["passed", "failed", "verification_unavailable", "applied_unverified", "pending_refresh", "partial_mutation_possible", "not_run"]);
const REJECTED_WITHOUT_EVIDENCE = new Set(["passed", "pending_refresh", "verification_unavailable"]);

function conflict(code: string, message: string): ReceiverOutcome {
  return refused(409, code, message);
}

function hasHostClaim(context: ReceiptContext, planId: string): boolean {
  const inFlight = context.state.inFlight;
  if ((inFlight?.kind === "apply_plan" || inFlight?.kind === "apply_pending") && inFlight.id === planId) return true;
  return context.state.workflowCoordinator.canAcceptLateExecutionReceipt(planId) === true;
}

function claimsNoWork(head: ReceiptHead): boolean {
  return head.status === "rejected" && head.postcondition === "not_run" && !head.mayHaveMutated;
}

function refusedBeforeBegin(context: ReceiptContext, head: ReceiptHead, planId: string): boolean {
  const inFlight = context.state.inFlight;
  return claimsNoWork(head) && inFlight?.kind === "apply_pending" && inFlight.id === planId && context.state.workflowCoordinator.canAcceptLateExecutionReceipt(planId) !== true;
}

/** The plan a receipt names, whether the host holds its claim, and which settlement transition the receipt belongs to. */
export function receiptAdmission(context: ReceiptContext, head: ReceiptHead): ApplyReceiptAdmission {
  const planId = head.planId.slice(0, MAX_PLAN_ID_CHARS);
  const admitting = context.state.plans.get(planId);
  const claimed = hasHostClaim(context, planId);
  const preDispatch = admitting?.status === "approved" && (!claimed || refusedBeforeBegin(context, head, planId));
  const settledPlan = admitting !== undefined && TERMINAL_PLAN_STATUSES.has(admitting.status);
  const reconcileLate = settledPlan && !claimed && context.state.workflowCoordinator.canReconcileLateReceipt(planId);
  return { planId, admitting, claimed, preDispatch, reconcileLate };
}

function sameEvidence(head: ReceiptHead, admitting: ReceiptPlanRecord): boolean {
  const stored = admitting.receipt;
  const afterFingerprint = typeof stored?.afterFingerprint === "string" ? stored.afterFingerprint : null;
  return stored !== undefined && receiptSemantic(head.wire, afterFingerprint) === receiptSemantic(stored, afterFingerprint);
}

function idempotentReceipt(head: ReceiptHead, admitting: ReceiptPlanRecord): ReceiverOutcome | undefined {
  if (!sameEvidence(head, admitting) || (head.receiptId !== null && admitting.receipt?.receiptId !== head.receiptId)) return undefined;
  return accepted(200, { ok: true, receipt: receiptJson(admitting.receipt), idempotent: true });
}

function settledPlanOutcome(head: ReceiptHead, admission: ApplyReceiptAdmission, admitting: ReceiptPlanRecord): ReceiverOutcome | undefined {
  if (head.receiptId && admitting.receipt?.receiptId === head.receiptId) return conflict("RECEIPT_DUPLICATE_CONFLICT", "This receipt identity was already settled with different execution evidence.");
  return admission.reconcileLate ? undefined : conflict("PLAN_NOT_EXECUTING", `This plan is already ${admitting.status}; a receipt cannot change a settled outcome.`);
}

function terminalOutcome(head: ReceiptHead, admission: ApplyReceiptAdmission): ReceiverOutcome | undefined {
  const { admitting } = admission;
  if (!admitting || admission.claimed || !TERMINAL_PLAN_STATUSES.has(admitting.status)) return undefined;
  return idempotentReceipt(head, admitting) ?? settledPlanOutcome(head, admission, admitting);
}

function neverClaimedRefusal({ admitting, claimed }: ApplyReceiptAdmission): ReceiverOutcome | undefined {
  if (!admitting || claimed || IN_FLIGHT_PLAN_STATUSES.has(admitting.status) || TERMINAL_PLAN_STATUSES.has(admitting.status)) return undefined;
  return conflict("PLAN_NOT_EXECUTING", "This plan was never approved or claimed; a receipt cannot invent an execution.");
}

function approvalMatches(head: ReceiptHead, admitting: ReceiptPlanRecord | undefined): boolean {
  const capability = admitting?.approvalCapability;
  if (!capability || (claimsNoWork(head) && head.approvalId === undefined)) return true;
  return typeof head.approvalId === "string" && head.approvalId === capability.token;
}

function vocabularyIsValid(head: ReceiptHead): boolean {
  return VALID_STATUSES.has(head.status) && head.postcondition !== undefined && VALID_POSTCONDITIONS.has(head.postcondition);
}

function isContradictory(head: ReceiptHead): boolean {
  if (head.status === "executed") return head.postcondition === "not_run";
  return head.status === "rejected" && head.postcondition !== undefined && REJECTED_WITHOUT_EVIDENCE.has(head.postcondition);
}

function outcomeRefusal(head: ReceiptHead): ReceiverOutcome | undefined {
  if (!vocabularyIsValid(head)) return conflict("INVALID_RECEIPT_OUTCOME", "Receipt status and postcondition must use the execution protocol vocabulary.");
  return isContradictory(head) ? conflict("CONTRADICTORY_RECEIPT", "Receipt status contradicts its postcondition evidence.") : undefined;
}

/** The refusal an apply receipt earns, or undefined when it may settle its plan. */
export function receiptAdmissionRefusal(head: ReceiptHead, admission: ApplyReceiptAdmission): ReceiverOutcome | undefined {
  const approval = approvalMatches(head, admission.admitting) ? undefined : conflict("APPROVAL_MISMATCH", "This receipt does not carry the approval capability the plan was claimed under.");
  return neverClaimedRefusal(admission) ?? terminalOutcome(head, admission) ?? approval ?? outcomeRefusal(head);
}
