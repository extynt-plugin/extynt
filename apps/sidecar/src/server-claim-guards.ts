// The workflow guards on a claimed mailbox item: an apply claim must carry the plan's own approval and a current snapshot, and an undo claim must be admitted by the workflow coordinator; a refused claim answers with the kind's envelope.
import { statusFromApplyReceipt } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { enqueueHostWorkAhead } from "./host/work-queue.js";
import { mailboxItemFacts } from "./server-mailbox-item.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { RuntimeCapability } from "./server-runtime.js";
import type { SidecarState } from "./server-state.js";
import type { AgentMailboxItem } from "./server-types.js";

type ClaimGuardDeps = {
  readonly state: Pick<SidecarState, "agentMailbox" | "inFlight" | "now" | "plans" | "workflowCoordinator">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly runtime: Pick<RuntimeCapability, "projectWorkflowUndoReceipt" | "rejectPlanBeforeDispatch">;
};

type PlanRecord = NonNullable<ReturnType<SidecarState["plans"]["get"]>>;

/** What a refused claim answers with. */
export type ClaimRefusal = { code: string; message: string };

/** Which item a claim names: its kind, its id, the plan it belongs to and that plan's record. */
export type MailboxClaim = { kind: string; id: string; itemPlanId: string | undefined; plan: ReturnType<SidecarState["plans"]["get"]> };

type WorkflowApplyClaimInput = { item: AgentMailboxItem; itemPlanId: string; plan: PlanRecord | undefined; snapshot: ProjectSnapshot | undefined };

const CLAIM_REFUSAL = {
  apply: { envelope: "WORKFLOW_APPLY_REFUSED", busy: "workflow-v1 is temporarily busy; the apply remains queued.", refused: "workflow-v1 refused the apply claim; no host command was dispatched." },
  undo: { envelope: "WORKFLOW_UNDO_REFUSED", busy: "workflow-v1 is temporarily busy; the undo remains queued.", refused: "workflow-v1 refused the undo claim; no host command was dispatched." },
} as const;

function refusalOf(kind: keyof typeof CLAIM_REFUSAL, code: string): ClaimRefusal {
  const wording = CLAIM_REFUSAL[kind];
  return { code: wording.envelope, message: code === "DISPATCH_LANE_BUSY" ? wording.busy : wording.refused };
}

function applyClaimFailure(plan: PlanRecord | undefined, approvalId: string, snapshot: ProjectSnapshot | undefined): ClaimRefusal | undefined {
  if (!plan || !approvalId || approvalId !== plan.approvalCapability?.token) return { code: "WORKFLOW_APPLY_REFUSED", message: "workflow-v1 apply claim requires the real approval capability." };
  if (!snapshot) return { code: "SNAPSHOT_UNAVAILABLE", message: "workflow-v1 apply claim requires a current project snapshot." };
  return undefined;
}

function beginWorkflowUndo(deps: ClaimGuardDeps, planId: string): ClaimRefusal | undefined {
  try {
    deps.state.workflowCoordinator.beginUndo(planId);
    return undefined;
  } catch (error) {
    const given = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return { code: String(given ?? "WORKFLOW_UNDO_REFUSED"), message: error instanceof Error ? error.message : String(error) };
  }
}

function recordRejectedUndoClaim(deps: ClaimGuardDeps, rejected: { planId: string; code: string; message: string }): void {
  const { state } = deps;
  const { planId, code, message } = rejected;
  const receipt = { planId, operation: "undo_plan", status: "rejected", receivedAt: state.now().toISOString(), error: { code, message } };
  try {
    deps.runtime.projectWorkflowUndoReceipt({ planId, receipt, preDispatch: true, strict: true });
  } catch (projectionError) {
    deps.planLog.logPlanEvent("plan.workflow-undo-receipt-unmapped", { planId, message: projectionError instanceof Error ? projectionError.message : String(projectionError) });
  }
  const legacy = state.plans.get(planId);
  if (legacy && !state.workflowCoordinator.hasPlan(planId)) {
    legacy.undoReceipt = receipt;
    legacy.status = statusFromApplyReceipt(legacy.receipt);
    legacy.updatedAt = receipt.receivedAt;
  }
}

/** The kind, id and plan a claimed item names. */
export function mailboxClaimIdentity(deps: ClaimGuardDeps, item: AgentMailboxItem): MailboxClaim {
  const facts = mailboxItemFacts(item);
  return { kind: facts.kind, id: facts.claimId, itemPlanId: facts.planId, plan: facts.planId ? deps.state.plans.get(facts.planId) : undefined };
}

/** Refuses an undo claim the workflow coordinator will not admit; a busy lane puts the item back instead of rejecting its plan. */
export function rejectWorkflowUndoClaim(deps: ClaimGuardDeps, claim: { item: AgentMailboxItem; itemPlanId: string }): ClaimRefusal | undefined {
  const { state } = deps;
  if (!state.workflowCoordinator.hasPlan(claim.itemPlanId)) return undefined;
  const failure = beginWorkflowUndo(deps, claim.itemPlanId);
  if (!failure) return undefined;
  state.inFlight = undefined;
  const { code, message } = failure;
  if (code === "DISPATCH_LANE_BUSY") enqueueHostWorkAhead(state, claim.item);
  else recordRejectedUndoClaim(deps, { planId: claim.itemPlanId, code, message });
  deps.planLog.logPlanEvent("plan.workflow-undo-claim-refused", { planId: claim.itemPlanId, code, message });
  return refusalOf("undo", code);
}

/** Refuses an apply claim that lacks the plan's own approval or a current snapshot; a busy lane puts the item back instead of rejecting its plan. */
export function rejectWorkflowApplyClaim(deps: ClaimGuardDeps, claim: WorkflowApplyClaimInput): ClaimRefusal | undefined {
  const { state } = deps;
  const { item, itemPlanId } = claim;
  if (!state.workflowCoordinator.hasPlan(itemPlanId)) return undefined;
  const failure = applyClaimFailure(claim.plan, mailboxItemFacts(item).approvalToken, claim.snapshot);
  if (!failure) return undefined;
  const { code, message } = failure;
  if (code === "DISPATCH_LANE_BUSY") enqueueHostWorkAhead(state, item);
  else deps.runtime.rejectPlanBeforeDispatch(itemPlanId, code, message);
  deps.planLog.logPlanEvent("plan.workflow-apply-refused", { planId: itemPlanId, code, message });
  return refusalOf("apply", code);
}
