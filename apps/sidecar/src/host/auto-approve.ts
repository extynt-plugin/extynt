// "Ask before applying": the sidecar's decision for the plans the in-panel agent seals, and the approval of those it lets through. This
// judges only those plans: an external agent approves its own plan (ae_propose_plan {apply:true} or ae_approve_plan) and its app decides whether to ask.
import type { StoredPlan } from "@extynt/mcp-server";
import type { AskBeforeApplying } from "../ui-contract.js";
import { uiStoreFor } from "../ui-store.js";
import type { SidecarState } from "../server-state.js";
import type { PlanSource } from "./facts.js";
import { jobCreatedIds } from "./job-created-ids.js";
import type { LogFields } from "./lane-types.js";
import { autoApplyAllowed, planRisk } from "./plan-risk.js";

type PlanStoreState = Pick<SidecarState, "options" | "now" | "plans" | "workflowCoordinator">;

/** Approves a ready plan on behalf of `source`: ok, or the refusal code and message. */
export type ReadyApprover = (planId: string, source: PlanSource) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;

interface AutoApproveDeps {
  state: Pick<SidecarState, "agentMailbox" | "inFlight" | "now" | "options" | "plans" | "readyPlans" | "workflowCoordinator">;
  approve: ReadyApprover;
  log(event: string, fields: LogFields): void;
}

/** The user's "ask before applying" setting, from the UI preferences. */
export function askBeforeApplyingOf(state: Pick<SidecarState, "options" | "now">): AskBeforeApplying {
  return uiStoreFor(state).prefs().askBeforeApplying;
}

function jobOf(state: PlanStoreState, record: StoredPlan): string | undefined {
  return state.workflowCoordinator.batchForPlan(record.plan.planId)?.jobId ?? record.jobId;
}

function panelPlanMayAutoApply(state: PlanStoreState, record: StoredPlan): boolean {
  return autoApplyAllowed(askBeforeApplyingOf(state), planRisk(record, "panel", jobCreatedIds(state, jobOf(state, record))));
}

/** The sidecar's decision for a plan the in-panel agent just sealed. */
export function sealedPlanAutoApplies(state: PlanStoreState, planId: string): boolean {
  const record = state.plans.get(planId);
  return !!record && panelPlanMayAutoApply(state, record);
}

function nothingApplying(state: AutoApproveDeps["state"]): boolean {
  const flight = state.inFlight, applyInFlight = flight?.kind === "apply_plan" || flight?.kind === "apply_pending";
  return !applyInFlight && !state.agentMailbox.some((item) => item.approvedData.kind === "apply_plan" || item.planId !== undefined);
}

/** Approves the oldest ready plan the sealing decided to apply without a click, one at a time and in the order sealed: the next waits until the last one's apply is neither queued nor running. True when it settled one (the caller looks again). */
export async function autoApproveReady(deps: AutoApproveDeps): Promise<boolean> {
  const { state } = deps;
  const entry = state.readyPlans.find((candidate) => candidate.deliveredAt === null && candidate.autoApply);
  if (!entry || !nothingApplying(state)) return false;
  const record = state.plans.get(entry.planId);
  if (!record || !panelPlanMayAutoApply(state, record)) { entry.autoApply = false; return true; }
  entry.deliveredAt = state.now().toISOString();
  const answer = await deps.approve(entry.planId, "panel");
  if (!answer.ok) {
    entry.autoApply = false;
    entry.deliveredAt = null;
    deps.log("host.auto-approve-refused", { planId: entry.planId, code: answer.code });
  }
  return true;
}
