// The ready-plan queue: sealed plans the panel has not shown yet are handed out as a lease, and an expired or finished lease is reconciled before each claim.
import { APPROVED_CLAIM_GRACE_MS, IN_FLIGHT_PLAN_STATUSES, readyPlanFinished } from "./server-limits.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { SidecarState } from "./server-state.js";

type ReadyPlansDeps = {
  readonly state: Pick<SidecarState, "now" | "plans" | "readyPlans">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
};

type ReadyPlanEntry = SidecarState["readyPlans"][number];
type PlanRecord = ReturnType<SidecarState["plans"]["get"]>;

/** The plans handed to the panel by one claim, and how many are still leased. */
export type ReadyPlansClaim = { ok: true; plans: ReadyPlanEntry[]; waiting: number };

function shouldKeep(entry: ReadyPlanEntry, record: PlanRecord, now: number): boolean {
  if (readyPlanFinished(record) || !record) return false;
  if (entry.deliveredAt === null || IN_FLIGHT_PLAN_STATUSES.has(record.status)) return true;
  const deliveredAt = Date.parse(entry.deliveredAt);
  return Number.isFinite(deliveredAt) && now - deliveredAt < APPROVED_CLAIM_GRACE_MS;
}

function release(deps: ReadyPlansDeps, entry: ReadyPlanEntry, index: number, now: number): void {
  const { state } = deps;
  if (readyPlanFinished(state.plans.get(entry.planId))) {
    state.readyPlans.splice(index, 1);
    return;
  }
  const deliveredAt = entry.deliveredAt === null ? Number.NaN : Date.parse(entry.deliveredAt);
  entry.deliveredAt = null;
  deps.planLog.logPlanEvent("plan.claim-expired", { planId: entry.planId, status: state.plans.get(entry.planId)?.status, deliveredMs: Number.isFinite(deliveredAt) ? now - deliveredAt : null });
}

function reconcile(deps: ReadyPlansDeps): void {
  const { state } = deps;
  if (!state.readyPlans.length) return;
  const now = state.now().getTime();
  for (let index = state.readyPlans.length - 1; index >= 0; index -= 1) {
    const entry = state.readyPlans[index];
    if (entry && !shouldKeep(entry, state.plans.get(entry.planId), now)) release(deps, entry, index, now);
  }
}

function leasedCount(deps: ReadyPlansDeps): number {
  return deps.state.readyPlans.filter((entry) => entry.deliveredAt !== null).length;
}

/** The sealed plans this turn has not shown the panel yet, oldest first; delivery is a lease, not a handover. */
export function claimReadyPlans(deps: ReadyPlansDeps): ReadyPlansClaim {
  reconcile(deps);
  const { state } = deps;
  const at = state.now().toISOString();
  const claimed = state.readyPlans.filter((entry) => entry.deliveredAt === null);
  for (const entry of claimed) entry.deliveredAt = at;
  if (claimed.length) deps.planLog.logPlanEvent("plan.claimed", { planIds: claimed.map((entry) => entry.planId), waiting: leasedCount(deps) });
  return { ok: true, plans: claimed.map((entry) => ({ ...entry })), waiting: leasedCount(deps) };
}
