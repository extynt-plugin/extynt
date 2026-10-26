// The reply to a chat turn that ran an agent: its exact wire shape, the usage it reports, and the log row and answer it produces.
import type { ChatProvider } from "@extynt/llm";

import type { AgentRunResult } from "./agent.js";
import type { ChatProjectLinks } from "./chat-project-links.js";
import type { ChatInput } from "./server-chat-request.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import { answer, type JsonAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";
import { logTurnRow, turnUsageOf, type TurnUsage } from "./server-turn-usage.js";

interface AgentWorkflow {
  readonly agent: AgentRunResult;
  readonly used: ChatProvider;
  readonly fallbackInfo?: { readonly from: string; readonly reason: string };
}

interface ReplyTiming {
  readonly authoringMs?: number | undefined;
  readonly hostSettleMs?: number | undefined;
}

interface AgentReply {
  readonly ok: true;
  readonly schemaVersion: "0.1";
  readonly requestId: string;
  readonly mode: "agent";
  readonly provider: ChatProvider["displayMetadata"];
  readonly model: string;
  readonly outcome: AgentRunResult["outcome"];
  readonly notes: AgentRunResult["notes"];
  readonly answer: string;
  readonly plans: AgentRunResult["plans"];
  readonly tools: AgentRunResult["tools"];
  readonly reasoning: AgentRunResult["reasoning"];
  readonly steps: number;
  readonly usage: AgentRunResult["usage"];
  readonly authoringMs?: number;
  readonly hostSettleMs?: number;
  readonly orchestration?: NonNullable<AgentRunResult["orchestration"]>;
  readonly steering?: number;
  readonly stopReason?: string;
  readonly failure?: NonNullable<AgentRunResult["failure"]>;
  readonly pause?: NonNullable<AgentRunResult["pause"]>;
  readonly approval?: { readonly kind: "design-brief" };
  readonly fallback?: { readonly from: string; readonly reason: string };
}

/** An agent reply with the project links the turn produced and the session the panel sent it under. */
export interface AgentTurnReply extends AgentReply {
  readonly projectLinks: ReturnType<ChatProjectLinks["links"]>;
  readonly sessionId?: string;
}

type ReplyState = Pick<SidecarState, "chatAuthoring" | "chatProjectLinks" | "now" | "options" | "specialistUsage">;

/** What an agent turn's answer reads and writes. */
export interface ReplyDeps {
  readonly state: ReplyState;
  readonly dispatch: Pick<PlanLogCapability, "logStepUsage">;
}

interface AgentTurn {
  readonly input: ChatInput;
  readonly workflow: AgentWorkflow;
  readonly timing: ReplyTiming;
}

function agentAnswer(agent: AgentRunResult): string {
  if (agent.answer) return agent.answer;
  return agent.failure ? `I couldn't finish that: ${agent.failure.message}` : "";
}

function usageOf(agent: AgentRunResult, turn: TurnUsage | undefined): AgentRunResult["usage"] {
  if (!turn) return agent.usage;
  return { ...agent.usage, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, cachedInputTokens: turn.cachedInputTokens, totalTokens: turn.totalTokens };
}

function timingFields({ authoringMs, hostSettleMs }: ReplyTiming): Pick<AgentReply, "authoringMs" | "hostSettleMs"> {
  return { ...(authoringMs === undefined ? {} : { authoringMs }), ...(hostSettleMs ? { hostSettleMs } : {}) };
}

function agentStateFields(agent: AgentRunResult): Pick<AgentReply, "orchestration" | "steering" | "stopReason" | "failure" | "pause" | "approval"> {
  return {
    ...(agent.orchestration ? { orchestration: agent.orchestration } : {}),
    ...(agent.steering.length ? { steering: agent.steering.length } : {}),
    ...(agent.stopReason ? { stopReason: agent.stopReason } : {}),
    ...(agent.failure ? { failure: agent.failure } : {}),
    ...(agent.pause ? { pause: agent.pause } : {}),
    ...(agent.askedUser?.kind === "design-brief" ? { approval: { kind: "design-brief" as const } } : {}),
  };
}

/** The reply body for an agent run. The usage is the whole turn's when `turn` is given, specialists included. */
export function agentReply(input: ChatInput, workflow: AgentWorkflow, timing: ReplyTiming, turn?: TurnUsage): AgentReply {
  const { agent, used, fallbackInfo } = workflow;
  return {
    ok: true,
    schemaVersion: "0.1",
    requestId: input.requestId,
    mode: "agent",
    provider: used.displayMetadata,
    model: used.model,
    outcome: agent.outcome,
    notes: agent.notes,
    answer: agentAnswer(agent),
    plans: agent.plans,
    tools: agent.tools,
    reasoning: agent.reasoning,
    steps: agent.steps,
    usage: usageOf(agent, turn),
    ...timingFields(timing),
    ...agentStateFields(agent),
    ...(fallbackInfo ? { fallback: fallbackInfo } : {}),
  };
}

function logAgentTurn(state: ReplyState, turn: AgentTurn, usage: TurnUsage): void {
  const { input, workflow, timing } = turn;
  const extra = { ...timingFields(timing), ...(workflow.fallbackInfo ? { fallbackFrom: workflow.fallbackInfo.from } : {}) };
  logTurnRow(state, { requestId: input.requestId, used: workflow.used, agent: workflow.agent, turn: usage, extra });
}

function answerOf(reply: AgentTurnReply, agent: AgentRunResult): JsonAnswer<AgentTurnReply> {
  if (agent.outcome !== "failed") return answer(200, reply);
  const errorCode = agent.failure?.code;
  return { ...answer(200, reply, "failed"), ...(errorCode === undefined ? {} : { errorCode }) };
}

/**
 * Settles the books of a finished agent turn and answers it: the step and turn usage are logged, the authoring
 * progress is released, and the reply carries the project links and the session. A failed run is still a 200 reply
 * whose diagnostic outcome is "failed" with the failure's code.
 */
export function agentTurnAnswer(deps: ReplyDeps, turn: AgentTurn): JsonAnswer<AgentTurnReply> {
  const { input, workflow } = turn;
  const { agent } = workflow;
  deps.dispatch.logStepUsage(input.requestId, agent.steps, agent.usage);
  const usage = turnUsageOf(agent, workflow.used, deps.state.specialistUsage.take(input.requestId));
  logAgentTurn(deps.state, turn, usage);
  if (deps.state.chatAuthoring?.requestId === input.requestId) deps.state.chatAuthoring = null;
  const reply: AgentTurnReply = { ...agentReply(input, workflow, turn.timing, usage), projectLinks: deps.state.chatProjectLinks.links(input.requestId), ...(input.sessionId ? { sessionId: input.sessionId } : {}) };
  return answerOf(reply, agent);
}
