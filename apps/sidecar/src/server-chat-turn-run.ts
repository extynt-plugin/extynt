// Runs an admitted chat turn on the configured providers and turns the outcome into the route's reply; also ends a turn and releases what it held.
import { type ChatMessage, type ChatProvider, type ChatRequest, type ChatResponse, type ProviderImage, runChat } from "@extynt/llm";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { canRunAgent, type AgentRunResult } from "./agent.js";
import { askBeforeApplyingOf } from "./host/auto-approve.js";
import { answersOnly, type AnswerOnlyState } from "./server-chat-answer-only.js";
import { tierOrder } from "./server-chat-tier.js";
import type { ChatAgentCapability } from "./server-chat-agent-types.js";
import type { ChatTurn, ActiveChatTurn } from "./server-chat-admission.js";
import type { PreparedChat } from "./server-chat-prepare.js";
import { agentTurnAnswer, type AgentTurnReply, type ReplyDeps } from "./server-chat-reply.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import { refuse, answer, type JsonAnswer, type RefusalAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";
import { CHAT_TURN_LANDING_MS } from "./server-limits.js";
import { translatorOf } from "./ui-language.js";
import { boundedAuthoringMs } from "./server-durations.js";
import type { WorkflowContinuationCapability } from "./server-workflow-continuation.js";
import type { WorkflowCyclesCapability } from "./server-workflow-cycles.js";

interface ProviderTurn {
  readonly requestId: string;
  readonly sessionId?: string;
  readonly message: string;
  readonly history: ChatMessage[];
  readonly autoApply: boolean;
  readonly discoveryOnly: boolean;
  readonly signal: AbortSignal;
  readonly landingAt: number;
  readonly image?: { readonly mediaType: string; readonly base64: string };
  readonly images?: ProviderImage[];
  readonly continueJobId?: string;
  readonly allowLongPrompt?: true;
}

interface ProviderRun {
  readonly agent: AgentRunResult | undefined;
  readonly used: ChatProvider;
  readonly fallbackInfo?: { readonly from: string; readonly reason: string };
}

type ReadOnlyReply = ChatResponse & { readonly mode: "read-only" };

/** Every body a chat turn can answer with. */
export type ChatReplyBody = AgentTurnReply | ReadOnlyReply;

type TurnState = Pick<SidecarState, "chatProvider" | "chatSettleWaitMs" | "chatStepUsage" | "fallbackChatProvider" | "latest" | "openQueuePlanId" | "options" | "now" | "readyPlans" | "activeChatTurn" | "hostFacts"> & ReplyDeps["state"] & AnswerOnlyState;

interface TurnRunDeps {
  readonly state: TurnState;
  readonly dispatch: Pick<ChatAgentCapability, "runChatAgent"> & Pick<WorkflowCyclesCapability, "runWorkflowCycles"> & Pick<PlanLogCapability, "logPlanEvent" | "logStepUsage"> & Pick<PlanStateCapability, "normalizedLatest">;
}

type FinishState = Pick<SidecarState, "activeChatTurn" | "chatAuthoring" | "chatProgress" | "chatSteering" | "reviewHeldRequests" | "workflowRuns">;

type FinishWake = Pick<WorkflowContinuationCapability, "deferWorkflowDrain" | "wakeDeferredWorkflowContinuations">;

function attachmentsOf({ image, images }: PreparedChat): Pick<ProviderTurn, "image" | "images"> {
  return { ...(image ? { image } : {}), ...(images ? { images } : {}) };
}

function continuationOf({ continueJobId, allowLongPrompt }: PreparedChat["input"]): Pick<ProviderTurn, "continueJobId" | "allowLongPrompt"> {
  return { ...(continueJobId ? { continueJobId } : {}), ...(allowLongPrompt ? { allowLongPrompt: true } : {}) };
}

function providerTurnOf(state: TurnState, prepared: PreparedChat, turn: ChatTurn): ProviderTurn {
  const { input } = prepared;
  return {
    requestId: input.requestId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    message: input.message,
    history: input.history ?? [],
    autoApply: !prepared.discoveryOnly && askBeforeApplyingOf(state) !== "always",
    discoveryOnly: prepared.discoveryOnly,
    signal: turn.controller.signal,
    landingAt: turn.startedAt + CHAT_TURN_LANDING_MS,
    ...attachmentsOf(prepared),
    ...continuationOf(input),
  };
}

async function discoversOnly(state: TurnRunDeps["state"], turn: ProviderTurn): Promise<boolean> {
  return turn.discoveryOnly || !state.latest || await answersOnly(state, turn);
}

async function runChatProviders(deps: Pick<TurnRunDeps, "dispatch" | "state">, providers: { readonly primary: ChatProvider; readonly fallback: ChatProvider | undefined }, turn: ProviderTurn): Promise<ProviderRun> {
  const { primary, fallback } = providers;
  const runner = canRunAgent(primary) ? primary : canRunAgent(fallback) ? fallback : undefined;
  if (!runner) return { agent: undefined, used: primary };
  if (await discoversOnly(deps.state, turn)) {
    const agent = await deps.dispatch.runChatAgent(runner, { ...turn, autoApply: false, discoveryOnly: true });
    return { agent, used: runner };
  }
  const active = deps.state.activeChatTurn;
  if (active?.requestId === turn.requestId) active.detachable = true;
  const order = await tierOrder(deps.state, { primary, fallback }, turn.message);
  return deps.dispatch.runWorkflowCycles(order.primary, order.fallback, turn);
}

function readOnlyAnswer(response: ChatResponse): JsonAnswer<ReadOnlyReply> {
  const reply: ReadOnlyReply = { ...response, mode: "read-only" };
  if (response.ok) return answer(200, reply);
  return { ...answer(502, reply, "failed"), errorCode: "PROVIDER_ERROR" };
}

async function readOnlyReply(deps: TurnRunDeps, primary: ChatProvider, prepared: PreparedChat, snapshot: ProjectSnapshot | undefined): Promise<JsonAnswer<ReadOnlyReply> | RefusalAnswer> {
  const { input } = prepared;
  if (!snapshot) return refuse(409, "NO_SNAPSHOT", translatorOf(deps.state)("failure.chat.noSnapshot"));
  if (!deps.state.latest) return refuse(409, "PROJECT_CHANGED", translatorOf(deps.state)("failure.chat.projectChanged"));
  const request: ChatRequest = { schemaVersion: "0.1", requestId: input.requestId, message: input.message, snapshot, ...(input.history ? { history: input.history } : {}), ...(input.context ? { context: input.context } : {}) };
  return readOnlyAnswer(await runChat(request, primary));
}

/**
 * Runs one admitted turn and returns its reply. The message runs on the primary provider, or on the fallback when only
 * that one can call tools: only a tool-calling model can own a workflow job. Without a project snapshot, or for a
 * discovery-only turn, the agent gets bounded discovery tools and no authoring. When no provider can run an agent the
 * turn answers read-only from the project snapshot, refusing with NO_SNAPSHOT when there was none at the start and with
 * PROJECT_CHANGED when the project changed mid-turn, because the start-of-turn snapshot would present stale facts as current.
 */
export async function executeChatTurn(deps: TurnRunDeps, prepared: PreparedChat, turn: ChatTurn): Promise<JsonAnswer<ChatReplyBody> | RefusalAnswer> {
  const { state, dispatch } = deps;
  const { input } = prepared;
  const primary = state.chatProvider;
  if (!primary) throw new Error("A chat turn cannot run without a configured provider.");
  state.readyPlans = [];
  state.openQueuePlanId = null;
  const snapshot = dispatch.normalizedLatest();
  const providerTurn = providerTurnOf(state, prepared, turn);
  state.chatSettleWaitMs = 0;
  state.chatStepUsage = null;
  const authoringStartedAt = Date.now();
  dispatch.logPlanEvent("turn.started", { requestId: input.requestId, provider: primary.displayMetadata.displayName });
  const run = await runChatProviders(deps, { primary, fallback: state.fallbackChatProvider }, providerTurn);
  const timing = { authoringMs: boundedAuthoringMs(Date.now() - authoringStartedAt), hostSettleMs: boundedAuthoringMs(state.chatSettleWaitMs) };
  const { agent } = run;
  if (!agent) return readOnlyReply(deps, primary, prepared, snapshot);
  return agentTurnAnswer(deps, { input, workflow: { ...run, agent }, timing });
}

function continuationPending(state: FinishState, requestId: string): boolean {
  return [...state.workflowRuns.values()].some((run) => run.requestId === requestId && run.state !== "terminal");
}

function forgetTurnTraces(state: FinishState, requestId: string): void {
  state.chatProgress.delete(requestId);
  state.chatSteering.delete(requestId);
  state.reviewHeldRequests.delete(requestId);
  if (state.chatAuthoring?.requestId === requestId) state.chatAuthoring = null;
}

/**
 * Ends a turn: marks it settled and, when it is still the active turn, clears it and the progress, steering and
 * review hold it kept, unless a workflow continuation of the same request is still pending. A turn that a newer turn
 * has already replaced only marks itself settled and touches nothing the newer turn owns.
 */
export function finishChatTurn(state: FinishState, wake: FinishWake, requestId: string, active: ActiveChatTurn): void {
  if (state.activeChatTurn !== active.turn) {
    active.markSettled();
    return;
  }
  if (!continuationPending(state, requestId)) forgetTurnTraces(state, requestId);
  state.activeChatTurn = undefined;
  active.markSettled();
  wake.wakeDeferredWorkflowContinuations();
  wake.deferWorkflowDrain();
}
