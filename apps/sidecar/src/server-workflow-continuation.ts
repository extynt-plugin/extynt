// The workflow continuation capability: parks a run until its host receipt settles, wakes it, and starts the next model cycles from the queue; recovers the jobs a restart interrupted.
import { decodeOrThrow } from "@extynt/decode";
import type { ChatProvider } from "@extynt/llm";
import type { Translate } from "@extynt/ui-text";
import type { WorkflowBatch, WorkflowContinuationInput, WorkflowId, WorkflowJob } from "@extynt/workflow";
import type { AgentRunResult } from "./agent.js";
import { appliedSummary } from "./agent-runtime.js";
import { safeWorkflowDiagnostic } from "./workflow-coordinator.js";
import { activityFor } from "./server-activity.js";
import { uiEventsFor } from "./ui-events.js";
import { translatorOf } from "./ui-language.js";
import { pendingBatchFor, type PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { CHAT_TURN_LANDING_MS } from "./server-limits.js";
import type { WorkflowContinuationRun } from "./server-types.js";
import { logTurnRow, turnUsageOf } from "./server-turn-usage.js";
import { retireSettledTerminalContinuations, recoverableWorkflowJob, workflowContinuationMayAdvance, workflowContinuationRuntimeActive, type WorkflowContinuationOwnershipState } from "./server-workflow-continuation-ownership.js";
import { continuationBrief, pendingPlanId, resolveBlockedWorkflow, settleContinuationRun, settledBatchCanWake, terminalJob, type Pairing, type Schedule } from "./server-workflow-continuation-settle.js";
import { thrownMessage } from "./server-workflow-error.js";
import type { WorkflowProgressCapability } from "./server-workflow-progress.js";

const MAX_CLOSING_REPLIES = 32;

type RegisteredTurn = { readonly requestId: string; readonly workflowSeed?: string; readonly message: string; readonly autoApply: boolean; readonly image?: { readonly mediaType: string; readonly base64: string } };

type ContinuationRegistration = { readonly jobId: WorkflowId; readonly turn: RegisteredTurn; readonly nextCycle: number; readonly continuation: WorkflowContinuationInput | null; readonly pendingBatchId: WorkflowId | null };

/** The continuation operations other capabilities call: register a run, settle a receipt, wake and drain the queue, recover after a restart. */
export interface WorkflowContinuationCapability {
  deferWorkflowDrain(): void;
  drainWorkflowContinuations(): void;
  onWorkflowSettlement(planId: string): void;
  registerWorkflowContinuation(registration: ContinuationRegistration): void;
  scheduleWorkflowContinuation(jobId: WorkflowId): void;
  wakeDeferredWorkflowContinuations(): void;
  resumeRecoverableWorkflowJobs(): void;
}

type ContinuationTurn = { readonly requestId: string; readonly message: string; readonly history: Array<{ role: "user" | "assistant"; content: string }>; readonly autoApply: boolean; readonly signal?: AbortSignal; readonly landingAt?: number };

/** What the continuation runs against; `runWorkflowCycles` is bound after construction, because a continuation starts model cycles through the chat services built on top of it. */
export type WorkflowContinuationDeps = {
  readonly state: WorkflowContinuationOwnershipState & Pick<SidecarState, "autoResumedWorkflowJobs" | "chatProvider" | "closingReplies" | "fallbackChatProvider" | "hostFacts" | "now" | "options" | "plans" | "reviewHeldRequests" | "specialistUsage" | "workflowSchedulerRunning">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest" | "pairedWorkflowSnapshot" | "pairedWorkflowRepairSnapshot">;
  readonly workflowProgress: Pick<WorkflowProgressCapability, "setWorkflowTerminalProgress" | "setWorkflowWaitingProgress">;
  readonly runWorkflowCycles: (primary: ChatProvider, fallback: ChatProvider | undefined, turn: ContinuationTurn, continuationRun?: { readonly jobId: WorkflowId; readonly startCycle: number; readonly continuation: WorkflowContinuationInput | null }) => Promise<CycleOutcome>;
};

type Deps = WorkflowContinuationDeps;
type CycleOutcome = { readonly agent: AgentRunResult | undefined; readonly used: ChatProvider; readonly fallbackInfo?: { readonly from: string; readonly reason: string } };
type PairingResult = ReturnType<Deps["planState"]["pairedWorkflowSnapshot"]>;
type Port = { readonly wake: () => void; readonly drain: () => void };
type LaunchInput = Port & { readonly deps: Deps; readonly run: WorkflowContinuationRun; readonly pairing: Pairing; readonly primary: ChatProvider; readonly fallback: ChatProvider | undefined };
type BlockInput = { readonly deps: Deps; readonly run: WorkflowContinuationRun; readonly code: string; readonly blocker: string; readonly reason: string };
type RegisterInput = ContinuationRegistration & { readonly deps: Deps; readonly settle: (planId: string) => void };

function blockContinuation({ deps, run, code, blocker, reason }: BlockInput): void {
  deps.state.workflowCoordinator.recordProviderFailure(run.jobId, code, reason, true);
  deps.state.workflowCoordinator.blockJob(run.jobId, blocker);
  deps.workflowProgress.setWorkflowTerminalProgress(run, "blocked", reason);
  run.state = "terminal";
}

function blockedOutcomeMessage(job: WorkflowJob, agent: AgentRunResult | undefined): string {
  if ((job.blocker === "workflow:cycle-limit" || job.blocker === "workflow:wall-clock") && agent?.failure) return agent.failure.message;
  return job.blocker ?? "Workflow blocked.";
}

function reportContinuationOutcome(deps: Deps, run: WorkflowContinuationRun, job: WorkflowJob | undefined, agent: AgentRunResult | undefined): void {
  if (job?.status === "completed") deps.workflowProgress.setWorkflowTerminalProgress(run, "completed", "Workflow completed from verified receipt evidence.");
  else if (job?.status === "blocked") deps.workflowProgress.setWorkflowTerminalProgress(run, "blocked", blockedOutcomeMessage(job, agent));
  else if (agent?.failure) deps.workflowProgress.setWorkflowTerminalProgress(run, "blocked", agent.failure.message);
}

function reportContinuationTurn(deps: Deps, requestId: string, result: CycleOutcome): void {
  const { agent, used } = result;
  if (!agent) return;
  const turn = turnUsageOf(agent, used, deps.state.specialistUsage.take(requestId));
  logTurnRow(deps.state, { requestId, used, agent, turn, extra: { continuation: true } });
}

function agentClosing(agent: AgentRunResult | undefined, translate: Translate): string | undefined {
  if (agent?.answer) return agent.answer;
  if (agent?.failure) return agent.failure.message;
  return agent?.plans.length ? appliedSummary(agent.plans, translate) : undefined;
}

function closingTextOf(agent: AgentRunResult | undefined, job: WorkflowJob | undefined, translate: Translate): string {
  const said = agentClosing(agent, translate);
  if (said !== undefined) return said;
  return job?.status === "completed" ? translate("plan.done.closing", { goal: job.goalSummary }) : "";
}

function keepClosingReply(deps: Deps, requestId: string, agent: AgentRunResult | undefined, job: WorkflowJob | undefined): void {
  const text = closingTextOf(agent, job, translatorOf(deps.state));
  if (!text) return;
  deps.state.closingReplies.set(requestId, text);
  uiEventsFor(deps.state).publish({ type: "closing", requestId, text });
  for (const oldest of [...deps.state.closingReplies.keys()].slice(0, Math.max(0, deps.state.closingReplies.size - MAX_CLOSING_REPLIES))) deps.state.closingReplies.delete(oldest);
}

function finishContinuation(deps: Deps, jobId: WorkflowId, result: CycleOutcome): void {
  if (!workflowContinuationRuntimeActive(deps.state)) return;
  const current = deps.state.workflowRuns.get(jobId);
  if (!current || current.state === "waiting_receipt" || current.state === "scheduled") return;
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  keepClosingReply(deps, current.requestId, result.agent, job);
  reportContinuationOutcome(deps, current, job, result.agent);
  current.state = "terminal";
  deps.state.reviewHeldRequests.delete(current.requestId);
}

async function runLaunched({ deps, run, pairing, primary, fallback, wake, drain }: LaunchInput): Promise<void> {
  const turn = { requestId: run.requestId, message: run.goalSummary, history: [], autoApply: run.autoApply && !deps.state.reviewHeldRequests.has(run.requestId), signal: run.controller.signal, landingAt: Date.now() + CHAT_TURN_LANDING_MS };
  deps.state.workflowSchedulerRunning = true;
  activityFor(deps.state).via.set(run.jobId, "apply-resume");
  run.state = "running";
  try {
    run.continuation = deps.state.workflowCoordinator.continuation(run.jobId, pairing, run.nextCycle);
    const result = await deps.runWorkflowCycles(primary, fallback, turn, { jobId: run.jobId, startCycle: run.nextCycle, continuation: run.continuation });
    reportContinuationTurn(deps, run.requestId, result);
    finishContinuation(deps, run.jobId, result);
  } catch (error) {
    if (workflowContinuationRuntimeActive(deps.state)) blockContinuation({ deps, run, code: "WORKFLOW_CONTINUATION_FAILED", blocker: "workflow:continuation-failed", reason: decodeOrThrow(thrownMessage, error) });
  } finally {
    deps.state.workflowSchedulerRunning = false;
    if (workflowContinuationRuntimeActive(deps.state)) { wake(); if (deps.state.workflowContinuationQueue.size) drain(); }
  }
}

function launchContinuation(input: LaunchInput): void {
  if (workflowContinuationRuntimeActive(input.deps.state)) void runLaunched(input);
}

function rejectSchedulePairing(deps: Deps, run: WorkflowContinuationRun, jobId: WorkflowId, pairing: PairingResult): pairing is Extract<PairingResult, { ok: true }> {
  if (pairing.ok) return true;
  deps.state.workflowCoordinator.recordProviderFailure(jobId, "WORKFLOW_SNAPSHOT_UNAVAILABLE", pairing.message, true);
  deps.state.workflowCoordinator.blockJob(jobId, "workflow:snapshot-unavailable");
  terminalJob(deps, run, "blocked", pairing.message);
  return false;
}

function deferQueuedDrain(deps: Deps, drain: () => void): void {
  if (deps.state.workflowContinuationQueue.size) drain();
}

function scheduleContext(deps: Deps, jobId: WorkflowId): { readonly run: WorkflowContinuationRun; readonly batch: WorkflowBatch; readonly job: WorkflowJob } | undefined {
  const run = deps.state.workflowRuns.get(jobId);
  if (!run || run.state !== "waiting_receipt" || run.pendingBatchId === null) return undefined;
  const batch = pendingBatchFor(deps.state, run.pendingBatchId);
  if (!batch || batch.lifecycle !== "settled") return undefined;
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  return job ? { run, batch, job } : undefined;
}

function continuationPairing(deps: Deps, jobId: WorkflowId, batch: WorkflowBatch | null, batchId: WorkflowId): PairingResult {
  return batch?.verification.state === "verified" ? deps.planState.pairedWorkflowSnapshot(jobId, batchId) : deps.planState.pairedWorkflowRepairSnapshot(jobId, batchId);
}

function resumeExistingRun({ deps, nextCycle, continuation, pendingBatchId, settle }: RegisterInput, existing: WorkflowContinuationRun): void {
  if (existing.state === "terminal") return;
  if (existing.pendingBatchId === pendingBatchId && existing.nextCycle >= nextCycle) return;
  existing.pendingBatchId = pendingBatchId;
  existing.nextCycle = Math.max(existing.nextCycle, nextCycle);
  existing.continuation = continuation ?? existing.continuation;
  existing.state = "waiting_receipt";
  if (existing.pendingBatchId) {
    deps.workflowProgress.setWorkflowWaitingProgress(existing.requestId, existing.pendingBatchId);
    settle(pendingPlanId(deps, existing.pendingBatchId));
  }
}

function startPendingRun({ deps, jobId, turn, nextCycle, continuation, pendingBatchId, settle }: RegisterInput): void {
  const goalSummary = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId]?.goalSummary ?? safeWorkflowDiagnostic(turn.message);
  deps.state.workflowRuns.set(jobId, { jobId, requestId: turn.workflowSeed ?? turn.requestId, goalSummary, autoApply: turn.autoApply, controller: new AbortController(), state: "waiting_receipt", pendingBatchId, nextCycle, continuation });
  if (!pendingBatchId) return;
  const label = pendingBatchFor(deps.state, pendingBatchId)?.lifecycle === "settled"
    ? `Workflow reached a bounded continuation boundary after batch ${safeWorkflowDiagnostic(pendingBatchId)}; applied work is preserved and extynt is continuing automatically.`
    : undefined;
  deps.workflowProgress.setWorkflowWaitingProgress(turn.requestId, pendingBatchId, label);
  settle(pendingPlanId(deps, pendingBatchId));
}

function registerContinuation(input: RegisterInput): void {
  const existing = input.deps.state.workflowRuns.get(input.jobId);
  if (existing) resumeExistingRun(input, existing);
  else startPendingRun(input);
}

function wakePendingContinuation(deps: Deps, run: WorkflowContinuationRun, schedule: Schedule): void {
  if (run.state !== "waiting_receipt" || !workflowContinuationMayAdvance(deps.state, run.jobId)) return;
  const coordinator = deps.state.workflowCoordinator;
  if (run.pendingBatchId === null) {
    const latest = deps.planState.normalizedLatest();
    if (!latest) return;
    run.continuation = coordinator.continuation(run.jobId, { fingerprint: latest.fingerprint, revision: latest.revision }, run.nextCycle);
    run.state = "scheduled";
    deps.state.workflowContinuationQueue.add(run.jobId);
    return;
  }
  const pendingPlan = [...deps.state.plans.values()].find((record) => coordinator.batchIdForPlan(record.plan.planId) === run.pendingBatchId);
  const planId = pendingPlan?.plan.planId ?? "";
  if (settledBatchCanWake(coordinator, coordinator.batchForPlan(planId), planId)) schedule(run.jobId);
}

function nextRunnableContinuation(deps: Deps): WorkflowId | undefined {
  if (!workflowContinuationRuntimeActive(deps.state) || deps.state.workflowSchedulerRunning) return undefined;
  retireSettledTerminalContinuations(deps.state);
  const jobId = deps.state.workflowContinuationQueue.values().next().value;
  return jobId && workflowContinuationMayAdvance(deps.state, jobId) ? jobId : undefined;
}

function deferWorkflowAction(deps: Deps, action: () => void): void {
  const server = deps.state.server;
  setTimeout(() => { if (deps.state.server === server && workflowContinuationRuntimeActive(deps.state)) action(); }, 10);
}

function reopenedForRecovery(deps: Deps, job: WorkflowJob): boolean {
  if (job.status !== "blocked") return true;
  try { deps.state.workflowCoordinator.reopenForContinuation(job.jobId); return true; }
  catch { return false; }
}

function recoverableLatestBatch(deps: Deps, job: WorkflowJob): { readonly ready: boolean; readonly batch: WorkflowBatch | undefined } {
  const coordinator = deps.state.workflowCoordinator;
  const latestBatchId = job.batchIds.at(-1);
  const batch = latestBatchId ? coordinator.workflowStore.getState().batches[latestBatchId] : undefined;
  return { ready: !batch || settledBatchCanWake(coordinator, batch, pendingPlanId(deps, batch.batchId)), batch };
}

function resumeRecoverableJob(deps: Deps, service: Pick<WorkflowContinuationCapability, "registerWorkflowContinuation">, job: WorkflowJob): void {
  const latest = recoverableLatestBatch(deps, job);
  if (!latest.ready || !reopenedForRecovery(deps, job)) return;
  deps.state.autoResumedWorkflowJobs.add(job.jobId);
  const context = deps.state.workflowCoordinator.resumeContext(job.jobId);
  if (latest.batch) {
    service.registerWorkflowContinuation({ jobId: job.jobId, turn: { requestId: context.requestId, message: job.goalSummary, autoApply: context.autoApply }, nextCycle: job.providerCycle, continuation: null, pendingBatchId: latest.batch.batchId });
    return;
  }
  deps.state.workflowRuns.set(job.jobId, { jobId: job.jobId, requestId: context.requestId, goalSummary: job.goalSummary, autoApply: context.autoApply, controller: new AbortController(), state: "waiting_receipt", pendingBatchId: null, nextCycle: job.providerCycle, continuation: null });
}

function resumeRecoverableJobs(deps: Deps, service: Pick<WorkflowContinuationCapability, "registerWorkflowContinuation">): void {
  if (!workflowContinuationRuntimeActive(deps.state) || !deps.planState.normalizedLatest()) return;
  for (const job of Object.values(deps.state.workflowCoordinator.workflowStore.getState().jobs)) {
    if (deps.state.autoResumedWorkflowJobs.has(job.jobId) || !recoverableWorkflowJob(deps.state, job)) continue;
    resumeRecoverableJob(deps, service, job);
  }
}

function scheduleContinuation(deps: Deps, jobId: WorkflowId, drain: () => void): void {
  if (!workflowContinuationMayAdvance(deps.state, jobId)) return;
  const context = scheduleContext(deps, jobId);
  if (!context || !resolveBlockedWorkflow(deps, context.run, context.job, context.batch)) return;
  const pairing = continuationPairing(deps, jobId, context.batch, context.batch.batchId);
  if (rejectSchedulePairing(deps, context.run, jobId, pairing)) continuationBrief(deps, context.run, { jobId, pairing: { fingerprint: pairing.fingerprint, revision: pairing.revision }, drain });
}

function drainPairing(deps: Deps, run: WorkflowContinuationRun, jobId: WorkflowId): PairingResult {
  const pendingBatch = run.pendingBatchId ? pendingBatchFor(deps.state, run.pendingBatchId) : null;
  if (pendingBatch) return continuationPairing(deps, jobId, pendingBatch, run.pendingBatchId ?? "");
  const latest = deps.planState.normalizedLatest();
  return latest ? { ok: true, fingerprint: latest.fingerprint, revision: latest.revision } : { ok: false, message: "A fresh project snapshot is required before the interrupted workflow can resume." };
}

function drainContinuation(deps: Deps, port: Port): void {
  const jobId = nextRunnableContinuation(deps);
  if (!jobId) return;
  deps.state.workflowContinuationQueue.delete(jobId);
  const run = deps.state.workflowRuns.get(jobId);
  if (!run || run.state !== "scheduled") { port.drain(); return; }
  const primary = deps.state.chatProvider, fallback = deps.state.fallbackChatProvider;
  if (!primary) {
    blockContinuation({ deps, run, code: "WORKFLOW_PROVIDER_UNAVAILABLE", blocker: "workflow:provider-unavailable", reason: "No provider is available for the receipt-driven continuation." });
    deferQueuedDrain(deps, port.drain);
    return;
  }
  const pairing = drainPairing(deps, run, jobId);
  if (!pairing.ok) {
    blockContinuation({ deps, run, code: "WORKFLOW_SNAPSHOT_UNPAIRED", blocker: "workflow:snapshot-unpaired", reason: pairing.message });
    deferQueuedDrain(deps, port.drain);
    return;
  }
  launchContinuation({ deps, run, pairing, primary, fallback, wake: port.wake, drain: port.drain });
}

/** The continuation capability over the sidecar state and the ports it runs against. */
export function createWorkflowContinuation(deps: WorkflowContinuationDeps): WorkflowContinuationCapability {
  const service: WorkflowContinuationCapability = {
    registerWorkflowContinuation(registration) {
      registerContinuation({ ...registration, deps, settle: service.onWorkflowSettlement });
      if (registration.pendingBatchId === null) { service.wakeDeferredWorkflowContinuations(); service.deferWorkflowDrain(); }
    },
    deferWorkflowDrain: () => deferWorkflowAction(deps, service.drainWorkflowContinuations),
    onWorkflowSettlement(planId) {
      for (const run of deps.state.workflowRuns.values()) settleContinuationRun(deps, run, planId, service.scheduleWorkflowContinuation);
      service.wakeDeferredWorkflowContinuations();
      deferWorkflowAction(deps, service.wakeDeferredWorkflowContinuations);
    },
    resumeRecoverableWorkflowJobs: () => resumeRecoverableJobs(deps, service),
    wakeDeferredWorkflowContinuations() {
      if (!workflowContinuationRuntimeActive(deps.state)) return;
      retireSettledTerminalContinuations(deps.state);
      if (!deps.planState.normalizedLatest()) return;
      service.resumeRecoverableWorkflowJobs();
      for (const run of deps.state.workflowRuns.values()) wakePendingContinuation(deps, run, service.scheduleWorkflowContinuation);
      deferQueuedDrain(deps, service.deferWorkflowDrain);
    },
    scheduleWorkflowContinuation: (jobId) => scheduleContinuation(deps, jobId, service.deferWorkflowDrain),
    drainWorkflowContinuations: () => drainContinuation(deps, { wake: service.wakeDeferredWorkflowContinuations, drain: service.deferWorkflowDrain }),
  };
  return service;
}
