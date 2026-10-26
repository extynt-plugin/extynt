// Settles an admitted apply receipt: the workflow transition, the stored plan, the lineage, what was learned and what the next status read will say.
import type { JsonValue } from "@extynt/decode";
import { jsonFieldsOf, jsonOf, operationOutcomes, receiptJson, statusFromApplyReceipt } from "@extynt/mcp-server";

import { learnFromApplyReceipt } from "./effect-notes-learn.js";
import { retainNativeMutationLease } from "./native-mutation-lease.js";
import { recordObservedEffectControls } from "./receipt-effect-controls.js";
import { accepted, refused } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import { synchronizeParameterReceipt } from "./relational-receipt-sync.js";
import type { StoredApplyReceipt } from "./server-apply-receipt.js";
import type { ApplyReceiptAdmission } from "./server-receipt-admission.js";
import { tallyOperations } from "./preference-tally-plan.js";
import type { ReceiptContext, ReceiptPlanRecord } from "./server-receipt-context.js";
import { keepReceipt } from "./server-stored-receipt.js";

type ApplySettlement = { context: ReceiptContext; receipt: StoredApplyReceipt; admission: ApplyReceiptAdmission; panelInstanceId: string | undefined; readback: JsonValue | undefined };

const LINEAGE_LIMIT = 64;

function updateLineage(context: ReceiptContext, plan: ReceiptPlanRecord, receipt: StoredApplyReceipt): void {
  const settled = plan.status === "verified" || plan.status === "applied_unverified";
  if (!settled || typeof receipt.afterFingerprint !== "string" || receipt.afterFingerprint === plan.plan.snapshotFingerprint) return;
  const { lineage } = context.state;
  lineage.set(receipt.afterFingerprint, { planId: plan.plan.planId, beforeFingerprint: plan.plan.snapshotFingerprint });
  while (lineage.size > LINEAGE_LIMIT) {
    const oldest = lineage.keys().next().value;
    if (typeof oldest !== "string") break;
    lineage.delete(oldest);
  }
}

function attachOutcome(context: ReceiptContext, receipt: StoredApplyReceipt, claimed: boolean): ReceiptPlanRecord | undefined {
  const plan = context.state.plans.get(receipt.planId);
  if (plan && receipt.operation === "apply_plan") {
    const outcomes = operationOutcomes(plan.plan, receiptJson(receipt) ?? {});
    receipt.operationOutcomes = outcomes.rows.map((row) => jsonFieldsOf(row));
    receipt.outcomeCounts = jsonFieldsOf(outcomes.counts);
  }
  if (plan && claimed && plan.status === "cancelled") receipt.cancelledDuringApply = true;
  return plan;
}

function projectToWorkflow(context: ReceiptContext, receipt: StoredApplyReceipt, admission: ApplyReceiptAdmission): ReceiverOutcome | undefined {
  try { context.runtime.projectWorkflowApplyReceipt({ planId: receipt.planId, receipt, preDispatch: admission.preDispatch, reconcile: admission.reconcileLate, strict: true }); }
  catch (error) {
    return refused(409, "WORKFLOW_SETTLEMENT_REFUSED", `The workflow settlement was refused; no legacy-only receipt was accepted. ${(error instanceof Error ? error.message : String(error))}`);
  }
  return undefined;
}

function commitToPlan(context: ReceiptContext, plan: ReceiptPlanRecord | undefined, receipt: StoredApplyReceipt): void {
  if (!plan) return;
  plan.receipt = receipt;
  plan.status = statusFromApplyReceipt(receipt);
  plan.updatedAt = receipt.receivedAt;
  updateLineage(context, plan, receipt);
  learnFromApplyReceipt(context.state.collection.effectNotes, { record: plan, receipt });
  if (receipt.status === "executed") context.state.preferences.noteApplied(plan.plan.planId, tallyOperations(plan.plan));
}

function clearApplyFlight(context: ReceiptContext, planId: string): void {
  const inFlight = context.state.inFlight;
  if ((inFlight?.kind === "apply_plan" || inFlight?.kind === "apply_pending") && inFlight.id === planId) context.state.inFlight = undefined;
}

function graphSynchronization(input: Parameters<typeof synchronizeParameterReceipt>[0]): ReturnType<typeof synchronizeParameterReceipt> {
  try {
    return synchronizeParameterReceipt(input);
  } catch (error) {
    return { status: "sync_failed", reason: (error instanceof Error ? error.message : String(error)) };
  }
}

/** Settles an admitted apply receipt and answers the host. */
export function settleApplyReceipt({ context, receipt, admission, panelInstanceId, readback }: ApplySettlement): ReceiverOutcome {
  retainNativeMutationLease(context.state, receipt);
  const plan = attachOutcome(context, receipt, admission.claimed);
  const refusal = projectToWorkflow(context, receipt, admission);
  if (refusal) return refusal;
  receipt.graphSynchronization = jsonOf(graphSynchronization({ state: context.state, record: plan, receipt: receiptJson(receipt) ?? {}, panelInstanceId, readback }));
  recordObservedEffectControls(context.state, receipt);
  keepReceipt(context.state.receipts, receipt);
  commitToPlan(context, plan, receipt);
  clearApplyFlight(context, receipt.planId);
  if (receipt.status === "executed") context.runtime.recordRuntimeEvidence(jsonOf(receipt.operationOutcomes), jsonOf(receipt.verification));
  context.transport.notifyChange();
  return accepted(201, { ok: true, receipt: receiptJson(receipt) });
}
