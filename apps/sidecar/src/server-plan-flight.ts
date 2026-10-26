// What happens to work the panel claimed and then went quiet on: in-flight applies, undos and captures, approvals nobody claimed, and the bound on the plan store.
import { createHash } from "node:crypto";

import type { StoredPlan, StoredReceipt } from "@extynt/mcp-server";
import type { WorkflowBatch } from "@extynt/workflow";

import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanSettlementCapability } from "./server-plan-settlement.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { PlanViewCapability } from "./server-plan-view.js";
import type { SidecarState } from "./server-state.js";
import { undoReceiptSemantic } from "./server-receipt-semantic.js";
import { APPROVED_CLAIM_GRACE_MS, IN_FLIGHT_PLAN_STATUSES, MAX_PLAN_RECORDS } from "./server-limits.js";
import { withUndoSemantic } from "./server-stored-receipt.js";

/** Settles or forgets work the panel claimed and never reported on. */
export interface PlanFlightCapability {
  abandonInFlight(code: string, message: string): void;
  failUnclaimedApprovals(): void;
  prunePlans(): void;
}

type PlanFlightDeps = {
  readonly state: Pick<SidecarState, "agentMailbox" | "approvalRecords" | "captures" | "inFlight" | "lineage" | "now" | "plans" | "preApply" | "receipts" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "approvalClockStart">;
  readonly planView: Pick<PlanViewCapability, "sealingTurn">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange">;
  readonly settlement: Pick<PlanSettlementCapability, "failUnsettledPlan" | "projectWorkflowUndoReceipt">;
};

type InFlightRecord = NonNullable<SidecarState["inFlight"]>;
type Failure = { code: string; message: string };

const UNCLAIMED_MESSAGE = "The panel approved this plan but never began it, so the project may or may not have changed. Refresh and inspect before applying it again.";
const LOST_UNDO_HASH_CHARS = 24;

function abandonCapture(state: PlanFlightDeps["state"], item: InFlightRecord, failure: Failure): void {
  const capture = state.captures.get(item.id);
  if (capture && capture.status !== "completed" && capture.status !== "failed") {
    capture.status = "failed";
    capture.receipt = { captureId: item.id, status: "failed", error: failure, providerShared: false };
  }
}

function inFlightMatches(inFlight: InFlightRecord | undefined, planId: string): boolean {
  if (!inFlight) return false;
  if (inFlight.kind !== "apply_plan" && inFlight.kind !== "apply_pending") return false;
  return inFlight.id === planId;
}

function undoClaimed(record: StoredPlan | undefined, workflowBatch: WorkflowBatch | null | undefined): record is StoredPlan {
  if (!record) return false;
  if (record.status === "undo_requested" || record.status === "undo_unverified") return true;
  return workflowBatch?.recovery.dispatch === "claimed" || workflowBatch?.recovery.dispatch === "executing";
}

function settleUndoUnverified(record: StoredPlan, receipt: StoredReceipt, receivedAt: string): void {
  const wasCancelled = record.status === "cancelled";
  record.undoReceipt = receipt;
  withUndoSemantic(record).undoReceiptSemantic = undoReceiptSemantic(receipt);
  record.status = wasCancelled ? "cancelled" : "undo_unverified";
  record.updatedAt = receivedAt;
}

function referencedPlanIds(state: PlanFlightDeps["state"]): Set<string> {
  return new Set([
    ...[...state.approvalRecords.values()].map((record) => record.capability.planId),
    ...state.agentMailbox.flatMap((item) => item.planId ? [item.planId] : []),
    ...state.receipts.flatMap((receipt) => typeof receipt.planId === "string" ? [receipt.planId] : []),
    ...[...state.lineage.values()].map((link) => link.planId),
    ...(state.inFlight ? [state.inFlight.id] : []),
    ...(state.preApply ? [state.preApply.planId] : []),
  ]);
}

function prunePlanRecords(state: PlanFlightDeps["state"], referenced: Set<string>): void {
  for (const [planId, record] of state.plans) {
    if (state.plans.size <= MAX_PLAN_RECORDS) break;
    if (referenced.has(planId) || IN_FLIGHT_PLAN_STATUSES.has(record.status) || record.receipt || record.undoReceipt) continue;
    state.plans.delete(planId);
  }
}

function lostUndoReceipt(item: InFlightRecord, failure: Failure, receivedAt: string): StoredReceipt {
  const digest = createHash("sha256").update(`${item.id}:${receivedAt}:${failure.code}`).digest("hex").slice(0, LOST_UNDO_HASH_CHARS);
  return { receiptId: `undo-lost-${digest}`, planId: item.id, operation: "undo_plan", status: "unknown", receivedAt, error: failure };
}

function abandonApply(deps: PlanFlightDeps, item: InFlightRecord, failure: Failure): void {
  const { state } = deps;
  const workflowBatch = state.workflowCoordinator.batchForPlan(item.id);
  const claimed = item.kind === "apply_plan" && (workflowBatch?.lifecycle === "claimed" || workflowBatch?.lifecycle === "executing");
  if (!deps.settlement.failUnsettledPlan(item.id, failure.code, failure.message, claimed)) state.inFlight = item;
}

function abandonUndo(deps: PlanFlightDeps, item: InFlightRecord, failure: Failure, receivedAt: string): void {
  const { state } = deps;
  const record = state.plans.get(item.id);
  if (!undoClaimed(record, state.workflowCoordinator.batchForPlan(item.id))) return;
  const receipt = lostUndoReceipt(item, failure, receivedAt);
  try {
    deps.settlement.projectWorkflowUndoReceipt({ planId: item.id, receipt, preDispatch: false, strict: true });
  } catch (error) {
    deps.planLog.logPlanEvent("plan.workflow-undo-receipt-unmapped", { planId: item.id, message: error instanceof Error ? error.message : String(error) });
    state.inFlight = item;
    return;
  }
  settleUndoUnverified(record, receipt, receivedAt);
}

function approvalStillExpected(deps: PlanFlightDeps, record: StoredPlan, now: number): boolean {
  const { state } = deps;
  if (record.status !== "approved" || record.receipt) return true;
  if (inFlightMatches(state.inFlight, record.plan.planId)) return true;
  if (state.agentMailbox.some((item) => item.planId === record.plan.planId)) return true;
  return now - deps.planState.approvalClockStart(record) < APPROVED_CLAIM_GRACE_MS;
}

function abandonInFlight(deps: PlanFlightDeps, failure: Failure): void {
  const { state } = deps;
  const item = state.inFlight;
  state.inFlight = undefined;
  if (!item) return;
  const receivedAt = state.now().toISOString();
  if (item.kind === "capture_frame") abandonCapture(state, item, failure);
  else if (item.kind === "apply_plan" || item.kind === "apply_pending") abandonApply(deps, item, failure);
  else if (item.kind === "undo_plan") abandonUndo(deps, item, failure, receivedAt);
  deps.transport.notifyChange();
}

function failUnclaimedApprovals(deps: PlanFlightDeps): void {
  const { state } = deps;
  const now = state.now().getTime();
  for (const record of state.plans.values()) {
    if (approvalStillExpected(deps, record, now)) continue;
    deps.settlement.failUnsettledPlan(record.plan.planId, "APPROVAL_NOT_CLAIMED", UNCLAIMED_MESSAGE);
    deps.planLog.logPlanEvent("plan.approval-lost", { planId: record.plan.planId, requestId: deps.planView.sealingTurn(record.plan.planId) });
  }
}

/** Builds the in-flight handling over the sidecar state and the settlement capability. */
export function createPlanFlight(deps: PlanFlightDeps): PlanFlightCapability {
  return {
    abandonInFlight: (code, message) => abandonInFlight(deps, { code, message }),
    failUnclaimedApprovals: () => failUnclaimedApprovals(deps),
    prunePlans() {
      if (deps.state.plans.size <= MAX_PLAN_RECORDS) return;
      prunePlanRecords(deps.state, referencedPlanIds(deps.state));
    },
  };
}
