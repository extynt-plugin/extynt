// The workflow cycles capability: admits a user turn (or resumes the stopped job it names), opens the job, runs the authoring loop window by window and settles the run.
import { decodeOrThrow } from "@extynt/decode";
import type { ChatProvider } from "@extynt/llm";
import { MAX_WORKFLOW_GOAL_LENGTH, MAX_WORKFLOW_PROVIDER_CYCLES, type WorkflowId } from "@extynt/workflow";
import type { AgentRunResult } from "./agent.js";
import { primeJobOpen } from "./decision-prime.js";
import { safeWorkflowDiagnostic } from "./workflow-coordinator.js";
import { workflowGoalText } from "./workflow-coordinator-types.js";
import { setReferences } from "./workflow-references.js";
import { adoptCarriedDesign, answeredGoal, hasCarriedRequest, takeCarriedRequest } from "./server-workflow-carry.js";
import { primeContinuation } from "./decision-continuation.js";
import { awaitStoppedJob, hasBlockedJob, finishWorkflowOwnership, isWorkflowAmendment, selfContinuation, type PausedJob } from "./server-workflow-continuation-ownership.js";
import { startCycleBudget } from "./server-workflow-cycle-budget.js";
import { blockWorkflow, cancelRunAfterAbort, cancelWorkflowJob, releaseSpecialists, snapshotPairing, stopAtCycleBudget } from "./server-workflow-cycle-effects.js";
import { CycleRun, emptyWorkflowResult, initialCycleState, type FallbackInfo, type WorkflowContinuationRunInput, type WorkflowCyclesDeps, type WorkflowTurn } from "./server-workflow-cycle-state.js";
import { runWorkflowCycle, type Providers } from "./server-workflow-cycle-turn.js";
import { takeDesignerCards } from "./server-workflow-designer-cards.js";
import { thrownCode, thrownMessage } from "./server-workflow-error.js";
import { carryFeedback, recordSidecarAction, takeCarriedFeedback } from "./server-workflow-sidecar-actions.js";

export { workflowCycleInput, type WorkflowCycleTurnInput } from "./server-workflow-cycle-brief.js";

type WorkflowCyclesResult = { readonly agent: AgentRunResult | undefined; readonly used: ChatProvider; readonly fallbackInfo?: FallbackInfo };

/** The workflow cycles the chat route and the continuation start and cancel. */
export interface WorkflowCyclesCapability {
  cancelWorkflowJob(jobId: WorkflowId): void;
  runWorkflowCycles(primary: ChatProvider, fallback: ChatProvider | undefined, turn: WorkflowTurn, continuationRun?: WorkflowContinuationRunInput): Promise<WorkflowCyclesResult>;
}

type OnceResult = { readonly jobId: WorkflowId | null; readonly result: WorkflowCyclesResult };
type Admitted = { readonly turn: WorkflowTurn; readonly continuationRun: WorkflowContinuationRunInput | undefined } | { readonly agent: AgentRunResult };
type Resumption = { readonly resumed: { readonly turn: WorkflowTurn; readonly continuationRun: WorkflowContinuationRunInput } } | { readonly refusal: AgentRunResult };
type Begun = { readonly refused: AgentRunResult } | { readonly run: CycleRun; readonly openedJobId: WorkflowId | null };
type LoopInput = { readonly deps: WorkflowCyclesDeps; readonly run: CycleRun; readonly providers: Providers; readonly turn: WorkflowTurn; readonly continuationRun: WorkflowContinuationRunInput | undefined };

/** A new request whose prompt is over the goal limit is refused, so the user can shorten it or choose Send anyway. */
export function promptTooLong(message: string, turn: Pick<WorkflowTurn, "allowLongPrompt">): AgentRunResult | undefined {
  const bytes = Buffer.byteLength(message, "utf8");
  if (turn.allowLongPrompt || bytes <= MAX_WORKFLOW_GOAL_LENGTH) return undefined;
  const kb = (value: number) => Math.ceil(value / 1000);
  const text = `Your prompt is ${kb(bytes)} KB; the limit is ${kb(MAX_WORKFLOW_GOAL_LENGTH)} KB. Shorten the prompt, or choose Send anyway: the first step reads all of it, later steps keep only its first ${kb(MAX_WORKFLOW_GOAL_LENGTH)} KB.`;
  return { ...emptyWorkflowResult("PROMPT_TOO_LONG", text), answer: text };
}

function openWorkflowJob(deps: WorkflowCyclesDeps, turn: WorkflowTurn, goalMessage: string, continuationRun: WorkflowContinuationRunInput | undefined): { readonly jobId: WorkflowId | null; readonly failure: AgentRunResult | undefined } {
  if (continuationRun) return { jobId: continuationRun.jobId, failure: undefined };
  try {
    const jobId = deps.state.workflowCoordinator.openJob(turn.requestId, goalMessage, { requestId: turn.requestId, autoApply: turn.autoApply });
    setReferences(deps.state, jobId, turn.images);
    return { jobId, failure: undefined };
  } catch (error) {
    return { jobId: null, failure: emptyWorkflowResult(decodeOrThrow(thrownCode, error) ?? "WORKFLOW_ENGINE_BUSY", safeWorkflowDiagnostic(decodeOrThrow(thrownMessage, error))) };
  }
}

function continueAfterAuthoringWindow(input: LoopInput, startCycle: number): void {
  const { deps, run, turn } = input;
  const jobId = run.state.jobId;
  if (!jobId) return;
  const latest = deps.planState.normalizedLatest();
  if (!latest) {
    blockWorkflow(deps, run, { code: "WORKFLOW_SNAPSHOT_UNAVAILABLE", message: "The bounded authoring window ended without a fresh project snapshot, so extynt needs a new host observation before it can continue.", afterSeal: true });
    return;
  }
  const window = deps.state.workflowMaxCycles;
  const nextCycle = startCycle + window;
  if (stopAtCycleBudget(deps, run, nextCycle)) return;
  recordSidecarAction(deps.state, jobId, `the ${window}-cycle authoring window ended at cycle ${nextCycle}; the sidecar continued the job in a new window (nothing was lost)`);
  try {
    const continuation = deps.state.workflowCoordinator.continuation(jobId, snapshotPairing(latest), nextCycle);
    run.dispatch({ kind: "continuation-set", continuation });
    deps.continuation.registerWorkflowContinuation({ jobId, turn, nextCycle, continuation, pendingBatchId: null });
    run.dispatch({ kind: "planned", answer: `The ${window}-cycle authoring window reached a continuation boundary; applied work and the same brief are preserved while extynt continues automatically.` });
  } catch (error) {
    blockWorkflow(deps, run, { code: "WORKFLOW_CONTINUATION_BOUNDARY_FAILED", message: decodeOrThrow(thrownMessage, error), afterSeal: true });
  }
}

async function runAuthoringWindow(input: LoopInput, startCycle: number): Promise<boolean> {
  const { deps, run, providers, turn, continuationRun } = input;
  const maxCycles = deps.state.workflowMaxCycles;
  for (let offset = 0; offset < maxCycles; offset += 1) {
    if (await runWorkflowCycle({ deps, run, providers, turn, seed: turn.workflowSeed ?? turn.requestId, cycle: startCycle + offset, maxCycles, continuationRun })) return true;
  }
  return false;
}

function windowMayContinue({ run, turn }: LoopInput): boolean {
  return !turn.signal?.aborted && !!run.state.jobId && !run.state.aggregate?.failure;
}

async function runWorkflowLoop(input: LoopInput): Promise<void> {
  const startCycle = input.continuationRun?.startCycle ?? 0;
  if (await runAuthoringWindow(input, startCycle) || !windowMayContinue(input)) return;
  continueAfterAuthoringWindow(input, startCycle);
}

async function pausedJobForTurn(deps: WorkflowCyclesDeps, turn: WorkflowTurn): Promise<PausedJob> {
  if (hasCarriedRequest(deps.state, turn.sessionId)) return { kind: "none" };
  if (hasBlockedJob(deps.state)) await primeContinuation(deps.state.decisions, turn.message, turn.continueJobId ?? null);
  const paused = await awaitStoppedJob(deps.state, turn.message);
  return paused.kind === "resumable" && turn.continueJobId !== undefined && paused.job.jobId !== turn.continueJobId ? { kind: "none" } : paused;
}

function reopenStoppedJob(deps: WorkflowCyclesDeps, turn: WorkflowTurn, job: { readonly jobId: WorkflowId; readonly providerCycle: number }): Resumption | undefined {
  const latest = deps.planState.normalizedLatest();
  if (!latest) return undefined;
  const coordinator = deps.state.workflowCoordinator;
  const seed = coordinator.resumeContext(job.jobId).requestId;
  if (coordinator.jobIdForSeed(seed) !== job.jobId || job.providerCycle + 1 > MAX_WORKFLOW_PROVIDER_CYCLES) return undefined;
  try { coordinator.reopenForContinuation(job.jobId); }
  catch { return undefined; }
  deps.state.workflowCycleBudgetBase.set(job.jobId, job.providerCycle);
  startCycleBudget(deps.state, job.jobId, job.providerCycle);
  deps.state.workflowRuns.delete(job.jobId);
  if (isWorkflowAmendment(turn.message)) deps.state.workflowRequestLog.append(job.jobId, turn.message);
  const continuation = coordinator.continuation(job.jobId, snapshotPairing(latest), job.providerCycle);
  return { resumed: { turn: { ...turn, workflowSeed: seed }, continuationRun: { jobId: job.jobId, startCycle: job.providerCycle, continuation } } };
}

async function resumeStoppedJob(deps: WorkflowCyclesDeps, turn: WorkflowTurn): Promise<Resumption | undefined> {
  const paused = await pausedJobForTurn(deps, turn);
  if (paused.kind === "unsettled") return { refusal: emptyWorkflowResult("PAUSE_UNSETTLED", "The previous run is still finishing its last step. Reply 'continue' again in a moment; nothing new was started.") };
  return paused.kind === "resumable" ? reopenStoppedJob(deps, turn, paused.job) : undefined;
}

async function admitTurn(deps: WorkflowCyclesDeps, turn: WorkflowTurn, continuationRun: WorkflowContinuationRunInput | undefined): Promise<Admitted> {
  const resumption = continuationRun ? undefined : await resumeStoppedJob(deps, turn);
  if (resumption && "refusal" in resumption) return { agent: resumption.refusal };
  if (resumption) return resumption.resumed;
  if (!continuationRun && turn.continueJobId !== undefined) return { agent: emptyWorkflowResult("PAUSE_STALE", "That job is no longer paused at the step limit, so nothing was continued.") };
  return { turn, continuationRun };
}

function bindOwnTurn(deps: WorkflowCyclesDeps, requestId: string, jobId: WorkflowId | null): void {
  const active = deps.state.activeChatTurn;
  const ownTurn = active?.requestId === requestId ? active : undefined;
  if (!ownTurn) return;
  if (jobId) ownTurn.jobId = jobId;
  else if (ownTurn.clientGone && !ownTurn.controller.signal.aborted) ownTurn.controller.abort(new Error("the panel closed this request"));
}

function carriedFeedbackFor(deps: WorkflowCyclesDeps, jobId: WorkflowId | null, continuationRun: WorkflowContinuationRunInput | undefined): { readonly cycle: number; readonly message: string } | undefined {
  const message = continuationRun ? takeCarriedFeedback(deps.state, jobId ?? undefined) : undefined;
  return message && continuationRun ? { cycle: continuationRun.startCycle, message } : undefined;
}

type Carried = ReturnType<typeof takeCarriedRequest>;
type Goal = { readonly refused: AgentRunResult } | { readonly goalMessage: string; readonly carried: Carried };

function goalFor(deps: WorkflowCyclesDeps, turn: WorkflowTurn, continuationRun: WorkflowContinuationRunInput | undefined): Goal {
  if (continuationRun) return { goalMessage: turn.message, carried: undefined };
  const tooLong = promptTooLong(turn.message, turn);
  if (tooLong) return { refused: tooLong };
  const carried = takeCarriedRequest(deps.state, { now: deps.state.now().getTime(), sessionId: turn.sessionId });
  return { goalMessage: carried ? answeredGoal(carried, turn.message) : turn.message, carried };
}

function registerOpenedJob(deps: WorkflowCyclesDeps, turn: WorkflowTurn, opened: { readonly jobId: WorkflowId | null; readonly carried: Carried; readonly goalMessage: string; readonly fresh: boolean }): void {
  const { jobId, carried, goalMessage, fresh } = opened;
  if (carried && jobId) adoptCarriedDesign(deps.state, jobId, carried);
  if (carried?.kind === "design-brief" && jobId) deps.state.designApprovals.set(jobId, "approved");
  bindOwnTurn(deps, turn.requestId, jobId);
  if (fresh && jobId) deps.state.workflowRequestLog.append(jobId, goalMessage);
}

function newRun(deps: WorkflowCyclesDeps, primary: ChatProvider, start: { readonly jobId: WorkflowId | null; readonly continuationRun: WorkflowContinuationRunInput | undefined }): CycleRun {
  const { jobId, continuationRun } = start;
  const orchestration = jobId ? deps.state.workflowOrchestrations.get(jobId) : undefined;
  const feedback = carriedFeedbackFor(deps, jobId, continuationRun);
  return new CycleRun(initialCycleState({ used: primary, jobId, continuation: continuationRun?.continuation ?? null, orchestration, feedback }));
}

function beginRun(deps: WorkflowCyclesDeps, primary: ChatProvider, admitted: { readonly turn: WorkflowTurn; readonly continuationRun: WorkflowContinuationRunInput | undefined }): Begun {
  const { turn, continuationRun } = admitted;
  const goal = goalFor(deps, turn, continuationRun);
  if ("refused" in goal) return goal;
  const opened = openWorkflowJob(deps, turn, goal.goalMessage, continuationRun);
  if (opened.failure) return { refused: opened.failure };
  registerOpenedJob(deps, turn, { jobId: opened.jobId, carried: goal.carried, goalMessage: goal.goalMessage, fresh: continuationRun === undefined });
  return { run: newRun(deps, primary, { jobId: opened.jobId, continuationRun }), openedJobId: opened.jobId };
}

function settleWorkflowRun(deps: WorkflowCyclesDeps, run: CycleRun, turn: WorkflowTurn, openedJobId: WorkflowId | null): OnceResult {
  const feedback = run.state.feedback;
  if (feedback) carryFeedback(deps.state, openedJobId ?? undefined, feedback.message);
  if (turn.signal?.aborted) {
    cancelRunAfterAbort(deps, run);
    run.dispatch({ kind: "aborted" });
  }
  finishWorkflowOwnership(deps.state, run.state.jobId, (id, reason) => releaseSpecialists(deps, id, reason));
  const cards = run.state.jobId ? takeDesignerCards(deps.state, run.state.jobId) : [];
  if (cards.length) run.dispatch({ kind: "cards-added", cards });
  run.dispatch({ kind: "finalized" });
  const { aggregate, used, fallbackInfo } = run.state;
  return { jobId: run.state.jobId, result: { agent: aggregate, used, ...(fallbackInfo ? { fallbackInfo } : {}) } };
}

async function runWorkflowOnce(deps: WorkflowCyclesDeps, providers: Providers, turn: WorkflowTurn, continuationRun?: WorkflowContinuationRunInput): Promise<OnceResult> {
  const admitted = await admitTurn(deps, turn, continuationRun);
  if ("agent" in admitted) return { jobId: null, result: { agent: admitted.agent, used: providers.primary } };
  if (continuationRun === undefined) await primeJobOpen(deps.state.decisions, { request: workflowGoalText(turn.message), message: turn.message });
  const begun = beginRun(deps, providers.primary, admitted);
  if ("refused" in begun) return { jobId: null, result: { agent: begun.refused, used: providers.primary } };
  await runWorkflowLoop({ deps, run: begun.run, providers, turn: admitted.turn, continuationRun: admitted.continuationRun });
  return settleWorkflowRun(deps, begun.run, admitted.turn, begun.openedJobId);
}

async function runWorkflowCycles(deps: WorkflowCyclesDeps, providers: Providers, turn: WorkflowTurn, continuationRun: WorkflowContinuationRunInput | undefined): Promise<WorkflowCyclesResult> {
  let ran = await runWorkflowOnce(deps, providers, turn, continuationRun);
  let latestTurn = turn;
  for (;;) {
    const next = selfContinuation(deps, latestTurn, ran.jobId, ran.result.agent?.failure);
    if (!next) return ran.result;
    ran = await runWorkflowOnce(deps, providers, next.turn, next.run);
    latestTurn = next.turn;
  }
}

/** The workflow cycles over the sidecar state and the capabilities they run against. */
export function createWorkflowCycles(deps: WorkflowCyclesDeps): WorkflowCyclesCapability {
  return {
    runWorkflowCycles: (primary, fallback, turn, continuationRun) => runWorkflowCycles(deps, { primary, fallback }, turn, continuationRun),
    cancelWorkflowJob: (jobId) => cancelWorkflowJob(deps, jobId),
  };
}
