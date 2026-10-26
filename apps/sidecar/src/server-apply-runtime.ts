// Settling the plans a call depends on: which in-flight plans a new seal must wait for, how long it waits, and the refusal when one is still applying.
import { type JsonObject, presentFields } from "@extynt/decode";
import type { StoredPlan } from "@extynt/mcp-server";

import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { AGENT_DEFAULT_WAIT_SECONDS, AGENT_WAIT_MAX_SECONDS, BATCH_SETTLE_SECONDS } from "./server-limits.js";
import { AUTHORING_MS_CEILING, boundedElapsedMs } from "./server-durations.js";

type BatchDetail = { settled: false; planId: string; status: string; mayHaveMutated: boolean };

type BatchSettleRefusal = { ok: false; error: BatchDetail & { code: string; message: string }; data: BatchDetail };

type BatchSettled = { ok: true } | { ok: false; refusal: BatchSettleRefusal };

/** What settling in-flight plans offers a chat turn: the plans a seal depends on, a wait for them and the wait a tool call asks for. */
export interface ApplyRuntimeCapability {
  settleDependencies(callerPlanId: string | null): Set<string>;
  settleInFlightBatch(callerPlanId: string | null, seconds?: number, signal?: AbortSignal): Promise<BatchSettled>;
  settleWaitSeconds(name: string, args: JsonObject): number;
}

type ApplyRuntimeDeps = {
  readonly state: Pick<SidecarState, "chatSettleWaitMs" | "plans" | "readyPlans" | "settledBatchIds">;
  readonly planState: Pick<PlanStateCapability, "lineageChain" | "normalizedLatest" | "planIsInFlight" | "settledCreatedIds">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly transport: Pick<HttpCoreCapability, "waitUntil">;
};

function addPlanJobDependencies(deps: ApplyRuntimeDeps, dependencies: Set<string>, record: { plan: { planId: string }; jobId?: string | null; rebasedOver?: readonly string[] }): void {
  dependencies.add(record.plan.planId);
  if (record.jobId) {
    for (const candidate of deps.state.plans.values()) {
      if (candidate.jobId === record.jobId) dependencies.add(candidate.plan.planId);
    }
  }
  for (const planId of record.rebasedOver ?? []) dependencies.add(planId);
}

function addSnapshotDependencies(deps: ApplyRuntimeDeps, dependencies: Set<string>, record: { plan: { snapshotFingerprint: string } }): void {
  const current = deps.planState.normalizedLatest()?.fingerprint;
  if (!current || current === record.plan.snapshotFingerprint) return;
  for (const planId of deps.planState.lineageChain(record.plan.snapshotFingerprint, current) ?? []) dependencies.add(planId);
}

function settleWaitSeconds(name: string, args: JsonObject): number {
  const requested = args.waitSeconds;
  return typeof requested === "number" && Number.isFinite(requested)
    ? Math.max(0, Math.min(AGENT_WAIT_MAX_SECONDS, requested))
    : AGENT_DEFAULT_WAIT_SECONDS[name] ?? BATCH_SETTLE_SECONDS;
}

function settleDependencies(deps: ApplyRuntimeDeps, callerPlanId: string | null): Set<string> {
  const dependencies = new Set<string>();
  for (const entry of deps.state.readyPlans) dependencies.add(entry.planId);
  const record = callerPlanId ? deps.state.plans.get(callerPlanId) : undefined;
  if (!record) return dependencies;
  addPlanJobDependencies(deps, dependencies, record);
  addSnapshotDependencies(deps, dependencies, record);
  return dependencies;
}

function stillApplying(current: StoredPlan, seconds: number): BatchSettleRefusal {
  const detail: BatchDetail = { settled: false, planId: current.plan.planId, status: String(current.status), mayHaveMutated: current.receipt ? current.receipt.mayHaveMutated === true : true };
  const message = `Plan ${current.plan.planId} is still being applied after ${seconds} seconds, so this plan was not sealed and nothing was changed by this call. Read ae_get_plan_status for that plan, then call ae_plan_complete again once it has settled.`;
  return { ok: false, error: { code: "BATCH_STILL_APPLYING", message, ...detail }, data: detail };
}

async function settleInFlightBatch(deps: ApplyRuntimeDeps, callerPlanId: string | null, wait: { seconds: number; signal?: AbortSignal }): Promise<BatchSettled> {
  const dependencies = settleDependencies(deps, callerPlanId);
  const inFlight = () => [...deps.state.plans.values()].find((record) => dependencies.has(record.plan.planId) && deps.planState.planIsInFlight(record));
  const waiting = inFlight();
  if (waiting) {
    deps.planLog.logPlanEvent("plan.settle-wait", { planId: waiting.plan.planId, status: waiting.status, seconds: wait.seconds, ...(callerPlanId ? { callerPlanId } : {}) });
    const startedAt = Date.now();
    await deps.transport.waitUntil(() => !inFlight(), wait.seconds, wait.signal);
    const waitedMs = boundedElapsedMs(startedAt, AUTHORING_MS_CEILING) ?? 0;
    deps.state.chatSettleWaitMs += waitedMs;
    const current = inFlight();
    if (current) {
      deps.planLog.logPlanEvent("plan.settle-timeout", { planId: current.plan.planId, status: current.status, waitedMs: boundedElapsedMs(startedAt, AUTHORING_MS_CEILING) ?? 0 });
      return { ok: false, refusal: stillApplying(current, wait.seconds) };
    }
    deps.planLog.logPlanEvent("plan.settled", { planId: waiting.plan.planId, waitedMs: boundedElapsedMs(startedAt, AUTHORING_MS_CEILING) ?? 0 });
  }
  deps.state.settledBatchIds = deps.planState.settledCreatedIds();
  return { ok: true };
}

/** Settling bound to one session's state and plan bookkeeping. */
export function createApplyRuntime(deps: ApplyRuntimeDeps): ApplyRuntimeCapability {
  return {
    settleWaitSeconds,
    settleDependencies: (callerPlanId) => settleDependencies(deps, callerPlanId),
    settleInFlightBatch: (callerPlanId, seconds = BATCH_SETTLE_SECONDS, signal) => settleInFlightBatch(deps, callerPlanId, presentFields({ seconds, signal })),
  };
}
