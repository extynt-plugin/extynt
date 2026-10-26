// Re-checking a queued plan at claim time: the plan is rebased over earlier queued work or refused before After Effects runs, and a stale undo is refused the same way.
import { jsonOf, statusFromApplyReceipt } from "@extynt/mcp-server";
import type { HostPlanCommand } from "@extynt/host-ae";
import type { ActionPlan } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";

import type { ApplyAdmissionCapability } from "./server-apply-admission.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import { mailboxItemFacts } from "./server-mailbox-item.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import { planMatchesSnapshot } from "./server-plan-state.js";
import type { RuntimeCapability } from "./server-runtime.js";
import type { SidecarState } from "./server-state.js";
import { keepReceipt } from "./server-stored-receipt.js";
import { TERMINAL_PLAN_STATUSES } from "./server-limits.js";
import type { AgentMailboxItem, MailboxPreparation } from "./server-types.js";

type MailboxPlanDeps = {
  readonly state: Pick<SidecarState, "now" | "plans" | "receipts" | "workflowCoordinator">;
  readonly applyAdmission: Pick<ApplyAdmissionCapability, "executableFor" | "panelSessionId">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly runtime: Pick<RuntimeCapability, "projectWorkflowApplyReceipt" | "projectWorkflowUndoReceipt">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange">;
};

type PlanRecord = NonNullable<ReturnType<SidecarState["plans"]["get"]>>;
type Rejection = { record: PlanRecord; snapshot: ProjectSnapshot; code: string; message: string; projectWorkflow: boolean };
type Executable = { plan: ActionPlan; command: HostPlanCommand; rebasedOver?: string[] };

function rejectMailboxPlan(deps: MailboxPlanDeps, rejection: Rejection): MailboxPreparation {
  const { state } = deps;
  const { record, snapshot, code, message } = rejection;
  const receivedAt = state.now().toISOString();
  const receipt = {
    planId: record.plan.planId.slice(0, 128), status: "rejected", operation: "apply_plan", receivedAt,
    postcondition: "not_run", approvalId: null, beforeFingerprint: record.plan.snapshotFingerprint,
    afterFingerprint: snapshot.fingerprint, appliedOperations: [], mayHaveMutated: false,
    mutationState: "not-applied", rollback: "none", error: { code, message },
  };
  if (rejection.projectWorkflow) {
    try {
      deps.runtime.projectWorkflowApplyReceipt({ planId: record.plan.planId, receipt, preDispatch: true, strict: true });
    } catch (error) {
      deps.planLog.logPlanEvent("plan.workflow-receipt-unmapped", { planId: record.plan.planId, message: error instanceof Error ? error.message : String(error) });
      return "retry";
    }
  }
  keepReceipt(state.receipts, receipt);
  record.receipt = receipt;
  record.status = "failed";
  record.updatedAt = receivedAt;
  deps.transport.notifyChange();
  return "drop";
}

function executableOrRejection(deps: MailboxPlanDeps, record: PlanRecord, snapshot: ProjectSnapshot, item: AgentMailboxItem): MailboxPreparation | Executable {
  if (deps.state.workflowCoordinator.hasPlan(record.plan.planId)) {
    return rejectMailboxPlan(deps, { record, snapshot, code: "WORKFLOW_REBASE_REFUSED", message: "workflow-v1 refuses rebased execution; prepare a new sealed plan against the current snapshot.", projectWorkflow: true });
  }
  const facts = mailboxItemFacts(item);
  const executable = deps.applyAdmission.executableFor(record, snapshot, facts.approvalToken, facts.panelSessionId ?? deps.applyAdmission.panelSessionId());
  if (!("plan" in executable)) return rejectMailboxPlan(deps, { record, snapshot, code: executable.code, message: executable.message, projectWorkflow: false });
  return executable;
}

function queuedRecord(deps: MailboxPlanDeps, planId: string): PlanRecord | undefined {
  const record = deps.state.plans.get(planId);
  if (!record) return undefined;
  const spent = record.status === "cancelled" || TERMINAL_PLAN_STATUSES.has(record.status);
  if (spent) deps.transport.notifyChange();
  return spent ? undefined : record;
}

/** Re-checks a queued plan at claim time: rebased over earlier queued work, or refused before After Effects runs. */
export function prepareMailboxPlan(deps: MailboxPlanDeps, item: AgentMailboxItem, snapshot: ProjectSnapshot | undefined): MailboxPreparation {
  if (!item.planId) return "drop";
  const record = queuedRecord(deps, item.planId);
  if (!record) return "drop";
  if (!snapshot || planMatchesSnapshot(record, snapshot)) return "ready";
  const executable = executableOrRejection(deps, record, snapshot, item);
  if (typeof executable === "string") return executable;
  if (executable.rebasedOver) {
    record.plan = executable.plan;
    record.rebasedOver = executable.rebasedOver;
  }
  item.approvedData = { ...item.approvedData, plan: jsonOf(executable.plan), command: jsonOf(executable.command) };
  return "ready";
}

function projectStaleUndo(deps: MailboxPlanDeps, record: PlanRecord): MailboxPreparation {
  const receipt = { planId: record.plan.planId, operation: "undo_plan", status: "rejected", receivedAt: deps.state.now().toISOString(), error: { code: "UNDO_PROJECT_CHANGED", message: "The project changed before the panel could undo; nothing was undone." } };
  try {
    deps.runtime.projectWorkflowUndoReceipt({ planId: record.plan.planId, receipt, preDispatch: true, strict: true });
  } catch (error) {
    deps.planLog.logPlanEvent("plan.workflow-undo-receipt-unmapped", { planId: record.plan.planId, message: error instanceof Error ? error.message : String(error) });
    return "retry";
  }
  if (!deps.state.workflowCoordinator.hasPlan(record.plan.planId)) {
    record.undoReceipt = receipt;
    record.status = statusFromApplyReceipt(record.receipt);
    record.updatedAt = receipt.receivedAt;
  }
  return "drop";
}

/** The undo guard ran at request time; anything published since means After Effects' next Undo may no longer be the agent's plan, so it is refused before the host runs. */
export function rejectStaleUndo(deps: MailboxPlanDeps, item: AgentMailboxItem, currentFingerprint: string | null): MailboxPreparation {
  const facts = mailboxItemFacts(item);
  if (facts.expectedFingerprint === undefined || facts.expectedFingerprint === currentFingerprint) return "ready";
  const record = deps.state.plans.get(facts.approvedPlanId ?? "");
  if (record && projectStaleUndo(deps, record) === "retry") return "retry";
  deps.transport.notifyChange();
  return "drop";
}
