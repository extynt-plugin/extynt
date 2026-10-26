// The `plans` UI event: the plan list changed (proposed, amended, sealed, offered, approved, discarded, or ran out its approval window), so the panel reads it again. One timer per sidecar waits for the earliest expiry among plans that could still be applied.
import type { JsonValue } from "@extynt/decode";
import type { StoredPlan } from "@extynt/mcp-server";
import type { PlanSource } from "./host/facts.js";
import type { SidecarState } from "./server-state.js";
import { uiEventsFor } from "./ui-events.js";

type PlansReason = "proposed" | "amended" | "completed" | "variants" | "approved" | "discarded" | "presented" | "expired";

const TOOL_REASONS: ReadonlyMap<string, PlansReason> = new Map<string, PlansReason>([
  ["ae_propose_plan", "proposed"],
  ["ae_amend_plan", "amended"],
  ["ae_plan_complete", "completed"],
  ["ae_queue_finish", "completed"],
  ["ae_offer_variants", "variants"],
  ["ae_approve_plan", "approved"],
  ["ae_cancel_plan", "discarded"],
  ["ae_present_plan", "presented"],
]);

const AUTHORING_REASONS: ReadonlySet<PlansReason> = new Set<PlansReason>(["proposed", "completed", "variants"]);

const OPEN_STATUSES: ReadonlySet<StoredPlan["status"]> = new Set<StoredPlan["status"]>(["draft", "prepared", "presented"]);
const MAX_TIMER_MS = 2_147_000_000;

type PlansState = Pick<SidecarState, "plans" | "now">;

interface ExpiryTimer {
  cancel(): void;
}

/** How the expiry watch waits: `start` returns a timer that can still be called off, and is injected so a test can fire the wait by hand. */
export interface ExpiryTimers {
  start(run: () => void, delayMs: number): ExpiryTimer;
}

const realTimers: ExpiryTimers = {
  start: (run, delayMs) => {
    const handle = setTimeout(run, delayMs);
    handle.unref();
    return { cancel: () => clearTimeout(handle) };
  },
};

function expiriesOf(record: StoredPlan): number[] {
  return [record.approvalCapability?.expiresAt, record.plan.expiresAt].flatMap((text) => {
    const at = Date.parse(text ?? "");
    return Number.isFinite(at) ? [at] : [];
  });
}

/** The earliest expiry after `after` among plans that have not been applied or withdrawn, or null when there is none. */
export function earliestExpiry(plans: Iterable<StoredPlan>, after: number): number | null {
  let earliest: number | null = null;
  for (const record of plans) {
    if (!OPEN_STATUSES.has(record.status)) continue;
    for (const at of expiriesOf(record)) if (at > after && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest;
}

class PlanExpiryWatch {
  private timer: ExpiryTimer | undefined;
  private handled = 0;

  constructor(private readonly state: PlansState, private readonly timers: ExpiryTimers) {}

  public schedule(): void {
    this.stop();
    const now = this.state.now().getTime();
    const at = earliestExpiry(this.state.plans.values(), Math.max(now, this.handled));
    if (at === null) return;
    this.timer = this.timers.start(() => this.fire(at), Math.min(MAX_TIMER_MS, Math.max(1, at - now + 1)));
  }

  public stop(): void {
    this.timer?.cancel();
    this.timer = undefined;
  }

  private fire(at: number): void {
    this.timer = undefined;
    if (this.state.now().getTime() >= at) {
      this.handled = at;
      uiEventsFor(this.state).publish({ type: "plans", reason: "expired" });
    }
    this.schedule();
  }
}

const watches = new WeakMap<PlansState, PlanExpiryWatch>();

/** Replaces the timers the state's expiry watch uses; for tests, before the first plan event. */
export function setPlanExpiryTimers(state: PlansState, timers: ExpiryTimers): void {
  watches.get(state)?.stop();
  watches.set(state, new PlanExpiryWatch(state, timers));
}

function watchOf(state: PlansState): PlanExpiryWatch {
  const existing = watches.get(state);
  if (existing) return existing;
  const created = new PlanExpiryWatch(state, realTimers);
  watches.set(state, created);
  return created;
}

/** Tells every open panel stream the plan list changed, and re-aims the expiry timer at the plans as they now are. */
export function publishPlans(state: PlansState, reason: PlansReason, planId?: string): void {
  uiEventsFor(state).publish({ type: "plans", reason, ...(planId ? { planId } : {}) });
  watchOf(state).schedule();
}

function isPlanId(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

/** A plan tool succeeded: the plan list changed, and a plan that was just authored belongs to whoever authored it from that moment, not only from its approval. A tool that does not change the plan list announces nothing. */
export function announcePlanTool(state: PlansState & Pick<SidecarState, "hostFacts">, call: { name: string; planId: JsonValue | undefined; source: PlanSource }): void {
  const reason = TOOL_REASONS.get(call.name);
  if (!reason) return;
  const planId = isPlanId(call.planId) ? call.planId : undefined;
  if (planId && AUTHORING_REASONS.has(reason) && !state.hostFacts.planSources.has(planId)) state.hostFacts.planSources.set(planId, call.source);
  publishPlans(state, reason, planId);
}
