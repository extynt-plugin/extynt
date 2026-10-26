// The state of one workflow run's authoring loop as a value: the cycle state, the events that change it, and the pure reducer that applies them.
import type { ChatProvider, ProviderImage } from "@extynt/llm";
import type { WorkflowContinuationInput, WorkflowId } from "@extynt/workflow";
import { appliedSummary } from "./agent-runtime.js";
import type { AgentFailure, AgentRunResult, WorkflowPause } from "./agent.js";
import type { SidecarState } from "./server-state.js";
import type { ChatAgentCapability } from "./server-chat-agent-types.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { WorkflowContinuationCapability } from "./server-workflow-continuation.js";
import type { WorkflowProgressCapability } from "./server-workflow-progress.js";
import type { WorkflowOrchestrationBundle } from "./workflow-orchestration.js";
import type { WorkflowContinuationOwnershipState } from "./server-workflow-continuation-ownership.js";

/** The sidecar state, capabilities and ports the workflow cycles run against. */
export type WorkflowCyclesDeps = {
  readonly state: WorkflowContinuationOwnershipState & Pick<SidecarState, "fontSubstitutions" | "agentMailbox" | "decisions" | "eventLog" | "workflowRuns" | "carriedRequests" | "designApprovals" | "changeWaiters" | "now" | "options" | "pendingJobUndo" | "persistWorkflowHandoffs" | "plans" | "readyPlans" | "workflowCycleBudgetBase" | "workflowMaxCycles" | "workflowCycleCeiling" | "workflowProgressMarks" | "workflowSidecarActions" | "workflowRequestLog" | "workflowOrchestrations" | "workflowSpecialistSessions">;
  readonly chatAgent: Pick<ChatAgentCapability, "runChatAgent"> & Partial<Pick<ChatAgentCapability, "prepareCycle">>;
  readonly continuation: Pick<WorkflowContinuationCapability, "registerWorkflowContinuation">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest" | "pairedWorkflowSnapshot">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange">;
  readonly workflowProgress: Pick<WorkflowProgressCapability, "setWorkflowTerminalProgress">;
};

type StopFeedback = { readonly cycle: number; readonly message: string; readonly direct?: true };

/**
 * One user turn of a workflow. `workflowSeed` is the identity of the job a user-resumed turn continues (absent when
 * the turn's own requestId seeded the job), `continueJobId` is set by a panel Continue button to name the one paused job
 * the turn may resume, and `allowLongPrompt` means the user chose Send anyway: a goal over the limit is kept to its
 * first bytes instead of refused.
 */
export type WorkflowTurn = {
  requestId: string;
  sessionId?: string;
  workflowSeed?: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  autoApply: boolean;
  signal?: AbortSignal;
  landingAt?: number;
  image?: { mediaType: string; base64: string };
  images?: ProviderImage[];
  continueJobId?: string;
  allowLongPrompt?: boolean;
  stopFeedback?: StopFeedback;
};

/** The job a background run continues, the cycle it starts at and the brief it starts from. */
export type WorkflowContinuationRunInput = { readonly jobId: WorkflowId; readonly startCycle: number; readonly continuation: WorkflowContinuationInput | null };

/** Which provider answered and why a fallback was used, when one was. */
export type FallbackInfo = { readonly from: string; readonly reason: string };

/** What the cycle in flight is: an authoring cycle, a read-only observation of an executed stage, or a sidecar-decided read-only recheck that completes no stage. */
export type CyclePass = "authoring" | "observation" | "recheck";

type CycleFeedback = { readonly cycle: number; readonly message: string };

type CycleState = {
  readonly jobId: WorkflowId | null;
  readonly aggregate: AgentRunResult | undefined;
  readonly continuation: WorkflowContinuationInput | null;
  readonly used: ChatProvider;
  readonly fallbackInfo: FallbackInfo | undefined;
  readonly orchestration: WorkflowOrchestrationBundle | undefined;
  readonly admissionRefusal: AgentRunResult["workflowAdmissionRefusal"] | undefined;
  readonly feedback: CycleFeedback | undefined;
  readonly pass: CyclePass;
};

type CycleEvents = {
  "provider-answered": { readonly used: ChatProvider; readonly fallbackInfo: FallbackInfo | undefined };
  "orchestration-refreshed": { readonly orchestration: WorkflowOrchestrationBundle | undefined };
  "result-merged": { readonly current: AgentRunResult };
  "failed": { readonly failure: AgentFailure; readonly seed: "none" | "blank" | "empty" };
  "limit-stopped": { readonly failure: AgentFailure; readonly pause: WorkflowPause | null };
  "planned": { readonly answer?: string };
  "cards-added": { readonly cards: AgentRunResult["plans"] };
  "failure-cleared": Record<never, never>;
  "completion-cleared": Record<never, never>;
  "observation-reset": Record<never, never>;
  "aborted": Record<never, never>;
  "finalized": Record<never, never>;
  "feedback-set": { readonly feedback: CycleFeedback };
  "feedback-appended": { readonly cycle: number; readonly message: string };
  "feedback-taken": Record<never, never>;
  "continuation-set": { readonly continuation: WorkflowContinuationInput | null };
  "job-tracked": { readonly jobId: WorkflowId };
  "job-released": Record<never, never>;
  "admission-refused": { readonly refusal: NonNullable<AgentRunResult["workflowAdmissionRefusal"]> };
  "admission-cleared": Record<never, never>;
  "pass-set": { readonly pass: CyclePass };
};

type EventOf<K extends keyof CycleEvents> = { readonly kind: K } & CycleEvents[K];
type Transitions = { readonly [K in keyof CycleEvents]: (state: CycleState, event: EventOf<K>) => CycleState };

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };

function blankResult(): AgentRunResult {
  return { outcome: "failed", notes: [], answer: "", plans: [], tools: [], reasoning: [], steps: 0, steering: [], usage: { ...ZERO_USAGE } };
}

/** The result of a workflow that could not start: failed, with the code and the message the user is shown. */
export function emptyWorkflowResult(code: string, message: string): AgentRunResult {
  return { ...blankResult(), answer: `I couldn't start this workflow: ${message}`, failure: { code, message } };
}

function without(result: AgentRunResult, fields: ReadonlyArray<"failure" | "workflowCompletion">): AgentRunResult {
  const copy = { ...result };
  for (const field of fields) delete copy[field];
  return copy;
}

function failedWith(result: AgentRunResult, failure: AgentFailure): AgentRunResult {
  return { ...result, failure: { ...failure }, outcome: "failed" };
}

function mergedCards(plans: AgentRunResult["plans"], incoming: AgentRunResult["plans"]): AgentRunResult["plans"] {
  const merged = [...plans];
  for (const card of incoming) {
    const prior = merged.findIndex((candidate) => candidate.planId === card.planId);
    if (prior >= 0) merged[prior] = card; else merged.push(card);
  }
  return merged;
}

function answerForPlans(answer: string, before: AgentRunResult["plans"], plans: AgentRunResult["plans"]): string {
  const sidecarMade = answer.trim() !== "" && before.length > 0 && answer === appliedSummary(before);
  return sidecarMade && plans.every((plan) => plan.autoApply) ? appliedSummary(plans) : answer;
}

function withCards(aggregate: AgentRunResult, cards: AgentRunResult["plans"]): AgentRunResult {
  const plans = mergedCards(aggregate.plans, cards);
  const silent = !aggregate.answer.trim() && !aggregate.failure;
  return { ...aggregate, plans, answer: silent ? appliedSummary(plans) : answerForPlans(aggregate.answer, aggregate.plans, plans) };
}

function carriedFlags(current: AgentRunResult): Partial<AgentRunResult> {
  return {
    ...(current.usageReported ? { usageReported: true } : {}),
    ...(current.sealed ? { sealed: true } : {}),
    ...(current.settledInLoop ? { settledInLoop: true } : {}),
    ...(current.answer ? { answer: current.answer } : {}),
  };
}

function carriedFindings(current: AgentRunResult): Partial<AgentRunResult> {
  return {
    ...(current.stopReason ? { stopReason: current.stopReason } : {}),
    ...(current.failure ? { failure: current.failure } : {}),
    ...(current.workflowCompletion ? { workflowCompletion: current.workflowCompletion } : {}),
    ...(current.workflowAdmissionRefusal ? { workflowAdmissionRefusal: current.workflowAdmissionRefusal } : {}),
    ...(current.orchestration ? { orchestration: current.orchestration } : {}),
  };
}

function summedUsage(a: AgentRunResult["usage"], b: AgentRunResult["usage"]): AgentRunResult["usage"] {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, totalTokens: a.totalTokens + b.totalTokens, cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens };
}

function copiedReasoning(entries: AgentRunResult["reasoning"], stepOffset: number): AgentRunResult["reasoning"] {
  return entries.map((entry) => ({ ...entry, step: entry.step + stepOffset, tools: [...entry.tools] }));
}

/** The run's result so far with one more cycle's result folded in: cards replaced by plan id, traces and usage added, and the cycle's answer, findings and flags taken when it has them. */
export function mergeAgentResult(aggregate: AgentRunResult | undefined, current: AgentRunResult): AgentRunResult {
  if (!aggregate) return { ...current, notes: [...current.notes], plans: [...current.plans], tools: [...current.tools], reasoning: copiedReasoning(current.reasoning, 0), steering: [...current.steering], usage: { ...current.usage } };
  const plans = mergedCards(aggregate.plans, current.plans);
  return {
    ...aggregate,
    notes: [...aggregate.notes, ...current.notes],
    plans,
    tools: [...aggregate.tools, ...current.tools],
    reasoning: [...aggregate.reasoning, ...copiedReasoning(current.reasoning, aggregate.steps)],
    steering: [...aggregate.steering, ...current.steering],
    steps: aggregate.steps + current.steps,
    usage: summedUsage(aggregate.usage, current.usage),
    ...carriedFlags(current),
    ...carriedFindings(current),
    answer: current.answer ? answerForPlans(current.answer, current.plans, plans) : answerForPlans(aggregate.answer, aggregate.plans, plans),
  };
}

/**
 * A workflow the sidecar stopped says why first, in its own words: the model writes its wrap-up without knowing a later
 * batch was blocked, and once explained a block as having "run out of time". A first cycle that only answered in prose
 * (WORKFLOW_NO_BATCH) is the model's answer, not a stop.
 */
export function withStopReason(aggregate: AgentRunResult): AgentRunResult {
  const failure = aggregate.failure;
  if (!failure || !failure.code.startsWith("WORKFLOW_") || failure.code === "WORKFLOW_NO_BATCH" || aggregate.answer.startsWith("Stopped:")) return aggregate;
  const notes = aggregate.answer.trim();
  return { ...aggregate, answer: `Stopped: ${failure.message}${notes ? `\n\nThe model's notes:\n${notes}` : ""}` };
}

function withAggregate(state: CycleState, change: (aggregate: AgentRunResult) => AgentRunResult): CycleState {
  return state.aggregate ? { ...state, aggregate: change(state.aggregate) } : state;
}

function seededAggregate(state: CycleState, event: EventOf<"failed">): AgentRunResult | undefined {
  if (state.aggregate || event.seed === "none") return state.aggregate;
  return event.seed === "blank" ? blankResult() : emptyWorkflowResult(event.failure.code, event.failure.message);
}

function aborted(aggregate: AgentRunResult | undefined): AgentRunResult {
  if (!aggregate) return { ...blankResult(), failure: { code: "CANCELLED", message: "This workflow turn was stopped before it finished." } };
  return aggregate.failure ? aggregate : failedWith(aggregate, { code: "CANCELLED", message: "This workflow turn was stopped; future batches were cancelled and any late host receipt remains authoritative." });
}

function finalized(aggregate: AgentRunResult): AgentRunResult {
  const outcome = aggregate.failure ? "failed" : aggregate.plans.length ? "planned" : "answered";
  return withStopReason({ ...aggregate, outcome });
}

function appendedFeedback(state: CycleState, event: EventOf<"feedback-appended">): CycleFeedback {
  const prior = state.feedback;
  return { cycle: event.cycle, message: prior?.cycle === event.cycle ? `${prior.message}\n\n${event.message}` : event.message };
}

const TRANSITIONS: Transitions = {
  "provider-answered": (state, event) => ({ ...state, used: event.used, fallbackInfo: event.fallbackInfo ?? state.fallbackInfo }),
  "orchestration-refreshed": (state, event) => ({ ...state, orchestration: event.orchestration }),
  "result-merged": (state, event) => ({ ...state, aggregate: mergeAgentResult(state.aggregate, event.current) }),
  "failed": (state, event) => {
    const aggregate = seededAggregate(state, event);
    return { ...state, aggregate: aggregate && failedWith(aggregate, event.failure) };
  },
  "limit-stopped": (state, event) => {
    const failed = failedWith(state.aggregate ?? blankResult(), event.failure);
    return { ...state, aggregate: { ...failed, answer: event.failure.message, ...(event.pause ? { pause: event.pause } : {}) } };
  },
  "planned": (state, event) => withAggregate(state, (aggregate) => ({ ...without(aggregate, ["failure"]), outcome: "planned", ...(event.answer === undefined ? {} : { answer: event.answer }) })),
  "cards-added": (state, event) => withAggregate(state, (aggregate) => withCards(aggregate, event.cards)),
  "failure-cleared": (state) => withAggregate(state, (aggregate) => without(aggregate, ["failure"])),
  "completion-cleared": (state) => withAggregate(state, (aggregate) => ({ ...without(aggregate, ["failure", "workflowCompletion"]), outcome: "planned" })),
  "observation-reset": (state) => withAggregate(state, (aggregate) => ({ ...without(aggregate, ["failure", "workflowCompletion"]), answer: "", outcome: aggregate.plans.length ? "planned" : "answered" })),
  "aborted": (state) => ({ ...state, aggregate: aborted(state.aggregate) }),
  "finalized": (state) => withAggregate(state, finalized),
  "feedback-set": (state, event) => ({ ...state, feedback: event.feedback }),
  "feedback-appended": (state, event) => ({ ...state, feedback: appendedFeedback(state, event) }),
  "feedback-taken": (state) => ({ ...state, feedback: undefined }),
  "continuation-set": (state, event) => ({ ...state, continuation: event.continuation }),
  "job-tracked": (state, event) => ({ ...state, jobId: event.jobId }),
  "job-released": (state) => ({ ...state, jobId: null }),
  "admission-refused": (state, event) => ({ ...state, admissionRefusal: event.refusal }),
  "admission-cleared": (state) => ({ ...state, admissionRefusal: undefined }),
  "pass-set": (state, event) => ({ ...state, pass: event.pass }),
};

/** The state after one event; pure, so every transition of the loop can be checked without a sidecar. */
export function reduceCycle<K extends keyof CycleEvents>(state: CycleState, event: EventOf<K>): CycleState {
  return TRANSITIONS[event.kind](state, event);
}

/** The state a run starts in: the job it follows, the brief it starts from and the feedback carried over from the run before. */
export function initialCycleState(start: { readonly used: ChatProvider; readonly jobId: WorkflowId | null; readonly continuation: WorkflowContinuationInput | null; readonly orchestration: WorkflowOrchestrationBundle | undefined; readonly feedback: CycleFeedback | undefined }): CycleState {
  return { jobId: start.jobId, aggregate: undefined, continuation: start.continuation, used: start.used, fallbackInfo: undefined, orchestration: start.orchestration, admissionRefusal: undefined, feedback: start.feedback, pass: "authoring" };
}

/** The mutable cell a run keeps its immutable state in: every change goes through `dispatch` and the reducer. */
export class CycleRun {
  state: CycleState;

  constructor(state: CycleState) {
    this.state = state;
  }

  dispatch<K extends keyof CycleEvents>(event: EventOf<K>): void {
    this.state = reduceCycle(this.state, event);
  }
}
