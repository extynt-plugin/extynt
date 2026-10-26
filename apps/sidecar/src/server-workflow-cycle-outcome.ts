// What a finished provider cycle means for the job: the stages that read the cycle's result in order, each deciding to stop the run, start the next cycle or leave the decision to the next stage.
import type { WorkflowContinuationInput, WorkflowId } from "@extynt/workflow";
import type { AgentRunResult } from "./agent.js";
import { firstCycleOf, questionAnswered } from "./decision-turn.js";
import { carryAskedRequest } from "./server-workflow-carry.js";
import { completeCoveredJob } from "./server-workflow-auto-complete.js";
import { advanceWorkflowBatch } from "./server-workflow-cycle-batches.js";
import { blockWorkflow, cancelWorkflowJob, snapshotPairing } from "./server-workflow-cycle-effects.js";
import type { CycleRun, WorkflowContinuationRunInput, WorkflowCyclesDeps, WorkflowTurn } from "./server-workflow-cycle-state.js";

type ResultContext = {
  readonly deps: WorkflowCyclesDeps;
  readonly run: CycleRun;
  readonly current: AgentRunResult;
  readonly turn: WorkflowTurn;
  readonly cycle: number;
  readonly maxCycles: number;
  readonly continuationRun: WorkflowContinuationRunInput | undefined;
};

type Verdict = boolean | undefined;
type Stage = (context: ResultContext) => Verdict;
type Completion = NonNullable<AgentRunResult["workflowCompletion"]>;

const PROSE_ENDING_FEEDBACK = "Your cycle ended in prose, so the job is still open. Build the next missing part, or call ae_workflow_complete if everything is built and verified.";

type UnsealedAction =
  | { readonly kind: "block-failure"; readonly failure: NonNullable<AgentRunResult["failure"]> }
  | { readonly kind: "advance" }
  | { readonly kind: "release-answered" }
  | { readonly kind: "feed-prose" }
  | { readonly kind: "block-prose"; readonly continuationCycle: boolean };

type CompletionAction = "none" | "accepted" | "settle-new-batch" | "refused";
type RefusalPlan = "feedback" | "preserve-host-work" | "block";

function sealedWithBatch(result: AgentRunResult): boolean {
  return result.sealed === true && result.plans.length > 0;
}

function afterSeal(run: CycleRun, continuationRun: WorkflowContinuationRunInput | undefined): boolean {
  return continuationRun !== undefined || run.state.aggregate?.sealed === true;
}

function answeredInitialQuestion(current: AgentRunResult, cycle: number, continuationRun: WorkflowContinuationRunInput | undefined): boolean {
  return questionAnswered(firstCycleOf(current, cycle, continuationRun !== undefined));
}

/** What to do with a cycle that did not seal a batch: block on its failure, release the job because the model only answered the user, feed prose back, or block for want of output. */
export function decideUnsealed(facts: { readonly current: AgentRunResult; readonly cycle: number; readonly continuationRun: WorkflowContinuationRunInput | undefined; readonly freeRun: boolean }): UnsealedAction {
  const { current, cycle, continuationRun, freeRun } = facts;
  if (sealedWithBatch(current)) return { kind: "advance" };
  if (current.failure) return { kind: "block-failure", failure: current.failure };
  if (answeredInitialQuestion(current, cycle, continuationRun)) return { kind: "release-answered" };
  const continuationCycle = cycle > 0 || continuationRun !== undefined;
  return continuationCycle && freeRun ? { kind: "feed-prose" } : { kind: "block-prose", continuationCycle };
}

/** How a completion call settles the cycle: accepted, replaced by a freshly sealed correction batch, refused, or absent. */
export function decideCompletion(current: AgentRunResult): CompletionAction {
  if (!current.workflowCompletion) return "none";
  if (current.workflowCompletion.accepted) return "accepted";
  return sealedWithBatch(current) ? "settle-new-batch" : "refused";
}

/** What a refused completion becomes: free run feeds it back to the model, otherwise finished host work is kept as planned and anything else blocks the job. */
export function decideRefusal(facts: { readonly freeRun: boolean; readonly hostWorkCompleted: boolean }): RefusalPlan {
  if (facts.freeRun) return "feedback";
  return facts.hostWorkCompleted ? "preserve-host-work" : "block";
}

function continueWithFeedback({ deps, run, cycle }: ResultContext, message: string): boolean {
  const jobId = run.state.jobId;
  if (!jobId) return true;
  const latest = deps.planState.normalizedLatest();
  if (!latest) {
    blockWorkflow(deps, run, { code: "WORKFLOW_SNAPSHOT_UNAVAILABLE", message: "The cycle ended without finishing the job and no fresh project snapshot is available, so extynt needs a new host observation before it can continue.", afterSeal: true });
    return true;
  }
  run.dispatch({ kind: "continuation-set", continuation: deps.state.workflowCoordinator.continuation(jobId, snapshotPairing(latest), cycle + 1) });
  run.dispatch({ kind: "feedback-set", feedback: { cycle: cycle + 1, message } });
  run.dispatch({ kind: "completion-cleared" });
  return false;
}

function refusalReason(completion: Completion): { readonly code: string; readonly message: string } {
  return { code: completion.code ?? "WORKFLOW_COMPLETION_REFUSED", message: completion.message ?? "The sidecar refused the typed completion proposal." };
}

function settleRefusal({ deps, run }: ResultContext, plan: "preserve-host-work" | "block", reason: { readonly jobId: WorkflowId; readonly code: string; readonly message: string }): void {
  const { jobId, code, message } = reason;
  if (plan === "preserve-host-work") {
    run.dispatch({ kind: "planned", answer: `After Effects host work completed, but workflow validation did not close: ${message}` });
    return;
  }
  deps.state.workflowCoordinator.blockJob(jobId, `workflow:${code.toLowerCase()}`);
  run.dispatch({ kind: "failed", failure: { code, message }, seed: "none" });
}

function recordRefusedCompletion(context: ResultContext, completion: Completion): boolean {
  const { deps, run, cycle, continuationRun } = context;
  const jobId = run.state.jobId;
  if (!jobId) return true;
  const { code, message } = refusalReason(completion);
  deps.state.workflowCoordinator.recordProviderFailure(jobId, code, message, cycle > 0 || afterSeal(run, continuationRun));
  const plan = decideRefusal({ freeRun: deps.state.options.workflowFreeRun === true, hostWorkCompleted: (run.state.aggregate?.plans.length ?? 0) > 0 });
  if (plan === "feedback") return continueWithFeedback(context, `Your ae_workflow_complete call was refused (${code}): ${message}\nBuild what is missing, or fix what the refusal names, then call ae_workflow_complete again.`);
  settleRefusal(context, plan, { jobId, code, message });
  return true;
}

function completionStage(context: ResultContext): Verdict {
  if (context.turn.signal?.aborted) return true;
  const action = decideCompletion(context.current);
  if (action === "accepted") return true;
  const completion = context.current.workflowCompletion;
  return action === "refused" && completion ? recordRefusedCompletion(context, completion) : undefined;
}

function blockMissingOutput({ deps, run, continuationRun }: ResultContext, continuationCycle: boolean): boolean {
  const code = continuationCycle ? "WORKFLOW_COMPLETION_REQUIRED" : "WORKFLOW_NO_BATCH";
  const message = continuationCycle
    ? "The continuation cycle stopped in prose. It must author a bounded batch or call ae_workflow_complete with verified receipt evidence."
    : "The initial workflow cycle produced no bounded batch and supplied no sidecar-owned success evidence.";
  blockWorkflow(deps, run, { code, message, afterSeal: afterSeal(run, continuationRun) });
  return true;
}

function unsealedEffect(context: ResultContext, action: Exclude<UnsealedAction, { readonly kind: "advance" }>): boolean {
  const { deps, run, continuationRun } = context;
  const jobId = run.state.jobId;
  if (action.kind === "release-answered") {
    if (jobId) cancelWorkflowJob(deps, jobId);
    run.dispatch({ kind: "job-released" });
    return true;
  }
  if (!jobId) return true;
  switch (action.kind) {
    case "block-failure":
      blockWorkflow(deps, run, { ...action.failure, afterSeal: afterSeal(run, continuationRun) });
      return true;
    case "feed-prose": return continueWithFeedback(context, PROSE_ENDING_FEEDBACK);
    case "block-prose": return blockMissingOutput(context, action.continuationCycle);
  }
}

function unsealedStage(context: ResultContext): Verdict {
  const { deps, current, cycle, continuationRun } = context;
  const action = decideUnsealed({ current, cycle, continuationRun, freeRun: deps.state.options.workflowFreeRun === true });
  return action.kind === "advance" ? undefined : unsealedEffect(context, action);
}

function admissionStage(context: ResultContext): Verdict {
  const { deps, run, current, cycle } = context;
  const refusal = current.workflowAdmissionRefusal;
  const jobId = run.state.jobId;
  if (!refusal || !jobId) return undefined;
  run.dispatch({ kind: "admission-refused", refusal });
  deps.state.workflowCoordinator.recordProviderFailure(jobId, refusal.code, refusal.message, false);
  const latest = deps.planState.normalizedLatest();
  if (!latest) {
    blockWorkflow(deps, run, { code: "WORKFLOW_SNAPSHOT_UNAVAILABLE", message: "The plan was rejected before host mutation, but a fresh project snapshot is required before correcting it.", afterSeal: false });
    return true;
  }
  run.dispatch({ kind: "continuation-set", continuation: deps.state.workflowCoordinator.continuation(jobId, snapshotPairing(latest), cycle + 1) });
  run.dispatch({ kind: "planned", answer: `The sidecar rejected plan ${refusal.planId} before host mutation (${refusal.code}). The same workflow is correcting it from fresh project context.` });
  return false;
}

function sealedAdmissionStage({ deps, run, current }: ResultContext): Verdict {
  if (!current.sealed) return undefined;
  const jobId = run.state.jobId;
  if (run.state.admissionRefusal && jobId) deps.state.workflowCoordinator.clearProviderFailure(jobId);
  run.dispatch({ kind: "admission-cleared" });
  return undefined;
}

function askedStage({ deps, run, turn }: ResultContext): Verdict {
  const asked = run.state.aggregate?.askedUser;
  const jobId = run.state.jobId;
  if (!asked || !jobId) return undefined;
  carryAskedRequest(deps.state, { jobId, asked, now: deps.state.now().getTime(), sessionId: turn.sessionId });
  cancelWorkflowJob(deps, jobId);
  run.dispatch({ kind: "job-released" });
  run.dispatch({ kind: "failure-cleared" });
  return true;
}

function observedVisually(deps: WorkflowCyclesDeps, continuation: WorkflowContinuationInput): boolean {
  return Object.values(deps.state.workflowCoordinator.workflowStore.getState().observations).some((evidence) => evidence.stageId === continuation.stageId && evidence.kind === "visual" && evidence.observedFingerprint === continuation.snapshot.fingerprint);
}

function closeRecheckCycle({ deps, run, cycle }: ResultContext): boolean {
  const latest = deps.planState.normalizedLatest();
  const jobId = run.state.jobId;
  if (!latest || !jobId || run.state.aggregate?.failure) return false;
  run.dispatch({ kind: "continuation-set", continuation: deps.state.workflowCoordinator.continuation(jobId, snapshotPairing(latest), cycle + 1) ?? run.state.continuation });
  run.dispatch({ kind: "observation-reset" });
  return true;
}

function closeObservationCycle(context: ResultContext, continuation: WorkflowContinuationInput, jobId: WorkflowId): boolean {
  const { deps, run, cycle } = context;
  const coordinator = deps.state.workflowCoordinator;
  try {
    coordinator.completeStageForContinuation(jobId);
    const latest = deps.planState.normalizedLatest();
    run.dispatch({ kind: "continuation-set", continuation: coordinator.continuation(jobId, latest ? snapshotPairing(latest) : continuation.snapshot, cycle + 1) });
    run.dispatch({ kind: "observation-reset" });
    return true;
  } catch (error) {
    blockWorkflow(deps, run, { code: "WORKFLOW_OBSERVATION_FAILED", message: error instanceof Error ? error.message : String(error), afterSeal: true });
    return false;
  }
}

function observationStage(context: ResultContext): Verdict {
  const { deps, run } = context;
  const { continuation, jobId, pass } = run.state;
  if (pass === "authoring" || !continuation || !jobId) return undefined;
  if (pass === "recheck") return closeRecheckCycle(context) ? false : undefined;
  if (!observedVisually(deps, continuation)) return undefined;
  return closeObservationCycle(context, continuation, jobId) ? false : undefined;
}

function trackJobStage({ deps, run, current }: ResultContext): Verdict {
  const card = current.plans.at(-1);
  const jobId = card ? deps.state.workflowCoordinator.jobIdForPlan(card.planId) : undefined;
  if (jobId) run.dispatch({ kind: "job-tracked", jobId });
  return undefined;
}

function settledLoopCard(current: AgentRunResult, jobId: WorkflowId | null): AgentRunResult["plans"][number] | undefined {
  return current.settledInLoop && !current.sealed && !current.failure && jobId ? current.plans.at(-1) : undefined;
}

function settledInLoopStage(context: ResultContext): Verdict {
  const { deps, run, current, turn, cycle, maxCycles } = context;
  const jobId = run.state.jobId;
  const card = settledLoopCard(current, jobId);
  if (!jobId || !card) return undefined;
  const freeRun = deps.state.options.workflowFreeRun === true;
  if (!freeRun && completeCoveredJob(deps, jobId)) return true;
  const feedback = { cycle: cycle + 1, message: PROSE_ENDING_FEEDBACK };
  if (freeRun) run.dispatch({ kind: "feedback-set", feedback });
  return advanceWorkflowBatch({ deps, run, turn: freeRun ? { ...turn, stopFeedback: { ...feedback, direct: true } } : turn, cycle, maxCycles, continuation: run.state.continuation, card });
}

function advanceStage({ deps, run, current, turn, cycle, maxCycles }: ResultContext): boolean {
  const card = current.plans.at(-1);
  if (current.failure) {
    blockWorkflow(deps, run, { ...current.failure, afterSeal: true });
    return true;
  }
  if (!card) {
    blockWorkflow(deps, run, { code: "WORKFLOW_ADMISSION_REFUSED", message: "The sealed batch was not admitted by workflow-v1, so no host dispatch or continuation was started.", afterSeal: true });
    return true;
  }
  return advanceWorkflowBatch({ deps, run, turn, cycle, maxCycles, continuation: run.state.continuation, card });
}

function mergeStage({ run, current }: ResultContext): Verdict {
  run.dispatch({ kind: "result-merged", current });
  return undefined;
}

const STAGES: readonly Stage[] = [mergeStage, admissionStage, sealedAdmissionStage, askedStage, observationStage, trackJobStage, completionStage, settledInLoopStage, unsealedStage];

/** Reads one finished provider cycle: true when the run stops, false when the next cycle starts. */
export function processWorkflowCycleResult(context: ResultContext): boolean {
  for (const stage of STAGES) {
    const verdict = stage(context);
    if (verdict !== undefined) return verdict;
  }
  return advanceStage(context);
}
