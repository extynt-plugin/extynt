// One provider cycle of a workflow run: the budget check before the call, the specialists and the brief, the provider (and its fallback), the close of the cycle and the hand-off of its result.
import { decodeOrThrow } from "@extynt/decode";
import type { ChatProvider } from "@extynt/llm";
import type { WorkflowId } from "@extynt/workflow";
import { shouldFallBack, type AgentRunResult } from "./agent.js";
import { primeCycleEnd } from "./decision-turn.js";
import { workflowGoalText } from "./workflow-coordinator-types.js";
import { orchestrationSummary, WORKFLOW_OWNER } from "./workflow-orchestration.js";
import { cycleCoverage, cycleNotes, workflowCycleInput, type WorkflowCycleRequest } from "./server-workflow-cycle-brief.js";
import { noteRecheckCycle } from "./server-workflow-cycle-budget.js";
import { blockJobWithFailure, stopAtCycleBudget } from "./server-workflow-cycle-effects.js";
import { processWorkflowCycleResult } from "./server-workflow-cycle-outcome.js";
import type { CyclePass, CycleRun, FallbackInfo, WorkflowContinuationRunInput, WorkflowCyclesDeps, WorkflowTurn } from "./server-workflow-cycle-state.js";
import { thrownCode, thrownMessage } from "./server-workflow-error.js";
import { clearRecheck, pendingRecheck } from "./server-workflow-sidecar-actions.js";

type CycleInput = {
  readonly deps: WorkflowCyclesDeps;
  readonly run: CycleRun;
  readonly providers: Providers;
  readonly turn: WorkflowTurn;
  readonly seed: string;
  readonly cycle: number;
  readonly maxCycles: number;
  readonly continuationRun: WorkflowContinuationRunInput | undefined;
};

/** The model the run prefers and the one it falls back to on the first cycle. */
export type Providers = { readonly primary: ChatProvider; readonly fallback: ChatProvider | undefined };

type ProviderCycleResult = { readonly current: AgentRunResult | undefined; readonly used: ChatProvider; readonly fallbackInfo: FallbackInfo | undefined };

function unanswered(used: ChatProvider): ProviderCycleResult {
  return { current: undefined, used, fallbackInfo: undefined };
}

async function runFallbackOnly(deps: WorkflowCyclesDeps, providers: Providers & { readonly fallback: ChatProvider }, input: WorkflowCycleRequest): Promise<ProviderCycleResult> {
  const { primary, fallback } = providers;
  const second = await deps.chatAgent.runChatAgent(fallback, input);
  if (!second) return unanswered(primary);
  return { current: second, used: fallback, fallbackInfo: { from: primary.displayMetadata.displayName, reason: `${primary.displayMetadata.displayName} cannot call tools` } };
}

async function requestWorkflowProvider(deps: WorkflowCyclesDeps, providers: Providers, input: WorkflowCycleRequest, cycle: number): Promise<ProviderCycleResult> {
  const { primary, fallback } = providers;
  const current = await deps.chatAgent.runChatAgent(primary, input);
  const first: ProviderCycleResult = { current, used: primary, fallbackInfo: undefined };
  if (cycle !== 0 || !fallback) return first;
  if (!current) return runFallbackOnly(deps, { primary, fallback }, input);
  if (current.sealed || !shouldFallBack(current)) return first;
  const reason = current.failure ? `${current.failure.code}: ${current.failure.message}` : `${primary.displayMetadata.displayName} cannot call tools`;
  const second = await deps.chatAgent.runChatAgent(fallback, input);
  return second ? { current: second, used: fallback, fallbackInfo: { from: primary.displayMetadata.displayName, reason: reason.slice(0, 240) } } : first;
}

function boundedWorkflowGoal(deps: WorkflowCyclesDeps, jobId: WorkflowId | null, message: string): string {
  return (jobId ? deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId]?.goalSummary : undefined) ?? workflowGoalText(message);
}

function refreshOrchestration(deps: WorkflowCyclesDeps, run: CycleRun): void {
  const jobId = run.state.jobId;
  if (jobId) run.dispatch({ kind: "orchestration-refreshed", orchestration: deps.state.workflowOrchestrations.get(jobId) });
}

async function sidecarSpecialists(input: CycleInput, goal: string, jobId: WorkflowId): Promise<void> {
  const { deps, run, providers, turn, seed, cycle } = input;
  if (!deps.chatAgent.prepareCycle) return;
  const request = { ...turn, history: [], stopAfterSeal: true as const, workflowJobId: seed, workflowGoalSummary: goal, workflowCycle: cycle, workflowRole: WORKFLOW_OWNER };
  try {
    const feedback = await deps.chatAgent.prepareCycle(providers.primary, request, deps.state.workflowRequestLog.text(jobId) ?? goal);
    if (feedback) run.dispatch({ kind: "feedback-appended", cycle, message: feedback });
  } catch (error) {
    process.stderr.write(`[extynt] sidecar specialists failed: ${decodeOrThrow(thrownMessage, error)}\n`);
  }
}

function passOf(request: WorkflowCycleRequest, recheck: string | undefined): CyclePass {
  if (request.workflowObservationOnly !== true) return "authoring";
  return recheck === undefined ? "observation" : "recheck";
}

async function prepareCycleInput(input: CycleInput): Promise<WorkflowCycleRequest> {
  const { deps, run, turn, seed, cycle } = input;
  refreshOrchestration(deps, run);
  const goal = boundedWorkflowGoal(deps, run.state.jobId, turn.message);
  const jobId = run.state.jobId ?? undefined;
  const freeRun = deps.state.options.workflowFreeRun === true;
  if (jobId && freeRun) await sidecarSpecialists(input, goal, jobId);
  const recheck = cycle > 0 && freeRun ? pendingRecheck(deps.state, jobId) : undefined;
  const { continuation, orchestration, admissionRefusal } = run.state;
  const request = workflowCycleInput({ turn, seed, cycle, goal, request: deps.state.workflowRequestLog.text(run.state.jobId), continuation, orchestration, admissionRefusal, coverage: cycleCoverage(run, cycle), notes: cycleNotes(deps, run, cycle), ...(recheck ? { recheck } : {}) });
  const pass = passOf(request, recheck);
  run.dispatch({ kind: "pass-set", pass });
  if (pass === "recheck") { clearRecheck(deps.state, jobId); noteRecheckCycle(deps.state, jobId); }
  return request;
}

function blockUnavailable(input: CycleInput): void {
  const { deps, run } = input;
  const jobId = run.state.jobId;
  if (!jobId) return;
  const message = input.cycle === 0 ? "No provider completed the initial workflow cycle." : "No provider completed the continuation cycle after the prior batch settled.";
  blockJobWithFailure(deps.state.workflowCoordinator, { jobId, code: "WORKFLOW_PROVIDER_UNAVAILABLE", message, afterSeal: input.cycle > 0 || input.continuationRun !== undefined, blocker: "workflow:provider-unavailable" });
  run.dispatch({ kind: "failed", failure: { code: "WORKFLOW_PROVIDER_UNAVAILABLE", message }, seed: "blank" });
}

function closeProviderCycleOrBlock(deps: WorkflowCyclesDeps, run: CycleRun, jobId: WorkflowId, cycle: number): boolean {
  try { deps.state.workflowCoordinator.closeProviderCycle(jobId, cycle + 1); return true; }
  catch (error) {
    const limit = decodeOrThrow(thrownCode, error) === "LIMIT_EXCEEDED";
    const reason = decodeOrThrow(thrownMessage, error);
    const code = limit ? "WORKFLOW_CYCLE_LIMIT" : "WORKFLOW_CYCLE_CLOSE_FAILED";
    const message = limit ? `The workflow reached its bounded provider-cycle safeguard; no further authoring cycle was started (${reason}).` : `The workflow could not close its cycle, so no further authoring cycle was started: ${reason}`;
    blockJobWithFailure(deps.state.workflowCoordinator, { jobId, code, message, afterSeal: true, blocker: limit ? "workflow:cycle-limit" : "workflow:cycle-close-failed" });
    run.dispatch({ kind: "failed", failure: { code, message }, seed: "empty" });
    return false;
  }
}

function acceptProviderResult(input: CycleInput, provider: ProviderCycleResult): AgentRunResult | undefined {
  const { run } = input;
  run.dispatch({ kind: "provider-answered", used: provider.used, fallbackInfo: provider.fallbackInfo });
  if (!provider.current) { blockUnavailable(input); return undefined; }
  const orchestration = run.state.orchestration;
  return orchestration ? { ...provider.current, orchestration: orchestrationSummary(orchestration) } : provider.current;
}

/** Runs one provider cycle and reads its result; true when the run stops, false when the next cycle starts. */
export async function runWorkflowCycle(input: CycleInput): Promise<boolean> {
  const { deps, run, providers, turn, cycle, maxCycles, continuationRun } = input;
  if (turn.signal?.aborted) return true;
  if (run.state.jobId && stopAtCycleBudget(deps, run, cycle)) return true;
  const request = await prepareCycleInput(input);
  const provider = await requestWorkflowProvider(deps, providers, request, cycle);
  refreshOrchestration(deps, run);
  const jobId = run.state.jobId;
  if (jobId && !closeProviderCycleOrBlock(deps, run, jobId, cycle)) return true;
  const current = acceptProviderResult(input, provider);
  await primeCycleEnd(deps.state.decisions, current, { index: cycle, continued: continuationRun !== undefined, jobId });
  return !current || processWorkflowCycleResult({ deps, run, current, turn, cycle, maxCycles, continuationRun });
}
