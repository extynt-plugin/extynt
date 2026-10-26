// Projects apply and undo receipts into the workflow, and settles plans that were started and never reported.
import { decodeOrThrow } from "@extynt/decode";
import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";

import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { keepReceipt } from "./server-stored-receipt.js";
import type { WorkflowContinuationCapability } from "./server-workflow-continuation.js";
import { DIVERGENCE_FAILURE } from "./workflow-coordinator-types.js";

type WorkflowApplyReceiptInput = { planId: string; receipt: StoredReceipt; preDispatch?: boolean; abandonedBeforeDispatch?: boolean; reconcile?: boolean; strict?: boolean };

type WorkflowUndoReceiptInput = { planId: string; receipt: StoredReceipt; preDispatch?: boolean; strict?: boolean; reconcile?: boolean };

/** Settles plans in the workflow and in the receipt ledger. */
export interface PlanSettlementCapability {
  failUnsettledPlan(planId: string, code: string, message: string, workflowHostClaimed?: boolean): boolean;
  projectWorkflowApplyReceipt(input: WorkflowApplyReceiptInput): void;
  projectWorkflowUndoReceipt(input: WorkflowUndoReceiptInput): void;
  rejectPlanBeforeDispatch(planId: string, code: string, message: string): void;
}

type PlanSettlementDeps = {
  readonly state: Pick<SidecarState, "inFlight" | "latestInterruptedApply" | "now" | "plans" | "receipts" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange">;
  readonly continuation: Pick<WorkflowContinuationCapability, "onWorkflowSettlement">;
};

type Coordinator = SidecarState["workflowCoordinator"];

function applyTransition(coordinator: Coordinator, input: WorkflowApplyReceiptInput): void {
  const { planId, receipt } = input;
  if (input.abandonedBeforeDispatch) coordinator.abandonBeforeApply(planId, receipt);
  else if (input.preDispatch) coordinator.rejectBeforeApply(planId, receipt);
  else if (input.reconcile) coordinator.reconcile(planId, receipt);
  else coordinator.receipt(planId, receipt);
}

function undoTransition(coordinator: Coordinator, input: WorkflowUndoReceiptInput): void {
  const { planId, receipt } = input;
  if (input.preDispatch) coordinator.rejectUndo(planId, receipt);
  else if (input.reconcile) coordinator.reconcileUndo(planId, receipt);
  else coordinator.undoReceipt(planId, receipt);
}

function clearInFlightApply(state: PlanSettlementDeps["state"], planId: string): void {
  const inFlight = state.inFlight;
  if (inFlight && (inFlight.kind === "apply_plan" || inFlight.kind === "apply_pending") && inFlight.id === planId) state.inFlight = undefined;
}

function unsettledReceipt(deps: PlanSettlementDeps, record: StoredPlan, failure: { code: string; message: string }): StoredReceipt {
  return {
    planId: record.plan.planId, status: "unknown", operation: "apply_plan", receivedAt: deps.state.now().toISOString(), postcondition: "unknown",
    beforeFingerprint: record.plan.snapshotFingerprint, afterFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null, appliedOperations: [],
    mayHaveMutated: true, mutationState: "mutation-unknown", rollback: "Refresh and inspect the project; use After Effects Undo if the change is unwanted", error: failure,
  };
}

function rejectedReceipt(deps: PlanSettlementDeps, record: StoredPlan, failure: { code: string; message: string }): StoredReceipt {
  return {
    planId: record.plan.planId, status: "rejected", operation: "apply_plan", receivedAt: deps.state.now().toISOString(), postcondition: "not_run", approvalId: null,
    beforeFingerprint: record.plan.snapshotFingerprint, afterFingerprint: deps.planState.normalizedLatest()?.fingerprint ?? null, appliedOperations: [],
    mayHaveMutated: false, mutationState: "not-applied", rollback: "none", error: failure,
  };
}

function storeFailure(state: PlanSettlementDeps["state"], record: StoredPlan, receipt: StoredReceipt, status: StoredPlan["status"]): void {
  keepReceipt(state.receipts, receipt);
  record.receipt = receipt;
  record.status = status;
  record.updatedAt = typeof receipt.receivedAt === "string" ? receipt.receivedAt : record.updatedAt;
}

function projectApply(deps: PlanSettlementDeps, input: WorkflowApplyReceiptInput): void {
  const { state, planLog } = deps;
  const { planId, receipt } = input;
  if (receipt.status === "executed") state.latestInterruptedApply = null;
  const coordinator = state.workflowCoordinator;
  if (!coordinator.hasPlan(planId)) return;
  try { applyTransition(coordinator, input); }
  catch (error) {
    coordinator.markDivergence(planId, decodeOrThrow(DIVERGENCE_FAILURE, error));
    planLog.logPlanEvent("plan.workflow-receipt-unmapped", { planId, message: error instanceof Error ? error.message : String(error) });
    if (input.strict) throw error;
    return;
  }
  scheduleContinuation(deps, planId);
}

function scheduleContinuation(deps: PlanSettlementDeps, planId: string): void {
  try { deps.continuation.onWorkflowSettlement(planId); }
  catch (error) { deps.planLog.logPlanEvent("plan.workflow-continuation-schedule-failed", { planId, message: error instanceof Error ? error.message : String(error) }); }
}

function projectUndo(deps: PlanSettlementDeps, input: WorkflowUndoReceiptInput): void {
  const { planId, strict = false } = input;
  const coordinator = deps.state.workflowCoordinator;
  if (!coordinator.hasPlan(planId)) return;
  try { undoTransition(coordinator, input); }
  catch (error) {
    coordinator.markDivergence(planId, decodeOrThrow(DIVERGENCE_FAILURE, error));
    deps.planLog.logPlanEvent("plan.workflow-undo-receipt-unmapped", { planId, message: (error instanceof Error ? error.message : String(error)) });
    if (strict) throw error;
  }
}

function nothingUnsettled(record: StoredPlan, workflowHostClaimed: boolean): boolean {
  return !workflowHostClaimed && record.status !== "applying" && record.status !== "approved";
}

function projectUnsettled(deps: PlanSettlementDeps, input: WorkflowApplyReceiptInput): boolean {
  try {
    projectApply(deps, input);
    return true;
  } catch (error) {
    deps.planLog.logPlanEvent("plan.workflow-receipt-unmapped", { planId: input.planId, message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Builds the settlement capability over the sidecar state and the workflow. */
export function createPlanSettlement(deps: PlanSettlementDeps): PlanSettlementCapability {
  const { state } = deps;
  const service: PlanSettlementCapability = {
    projectWorkflowApplyReceipt: (input) => projectApply(deps, input),
    projectWorkflowUndoReceipt: (input) => projectUndo(deps, input),

    rejectPlanBeforeDispatch(planId, code, message) {
      const record = state.plans.get(planId);
      if (!record || record.receipt) return;
      const receipt = rejectedReceipt(deps, record, { code, message });
      service.projectWorkflowApplyReceipt({ planId, receipt, preDispatch: true, strict: true });
      storeFailure(state, record, receipt, "failed");
      deps.transport.notifyChange();
    },

    failUnsettledPlan(planId, code, message, workflowHostClaimed = false) {
      const record = state.plans.get(planId);
      if (!record || nothingUnsettled(record, workflowHostClaimed)) {
        clearInFlightApply(state, planId);
        return true;
      }
      const receipt = unsettledReceipt(deps, record, { code, message });
      const preDispatch = !workflowHostClaimed && record.status === "approved";
      if (!projectUnsettled(deps, { planId, receipt, preDispatch, abandonedBeforeDispatch: preDispatch, strict: true })) return false;
      storeFailure(state, record, receipt, record.status === "cancelled" ? "cancelled" : "failed");
      clearInFlightApply(state, planId);
      deps.transport.notifyChange();
      return true;
    },
  };
  return service;
}
