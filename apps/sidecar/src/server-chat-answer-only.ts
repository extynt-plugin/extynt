// The answer-only route: a message that asks for an answer and no edit is answered by the bounded discovery agent, with no job opened, when the route decision settled it confidently.
import { REQUEST_ROUTE } from "@extynt/decide";
import type { ChatMessage, ProviderImage } from "@extynt/llm";
import { bookedBand, bookedOneOf } from "./decision-book.js";
import { primeJobOpen } from "./decision-prime.js";
import type { SidecarState } from "./server-state.js";
import { hasCarriedRequest } from "./server-workflow-carry.js";
import { hasBlockedJob, type WorkflowContinuationOwnershipState } from "./server-workflow-continuation-ownership.js";
import { workflowGoalText } from "./workflow-coordinator-types.js";

/** What the answer-only check reads of the sidecar. */
export type AnswerOnlyState = Pick<SidecarState, "carriedRequests" | "decisions"> & WorkflowContinuationOwnershipState;

interface AnswerOnlyTurn {
  readonly message: string;
  readonly history: readonly ChatMessage[];
  readonly sessionId?: string;
  readonly continueJobId?: string;
  readonly image?: ProviderImage;
  readonly images?: readonly ProviderImage[];
}

const ACT_BAND = "act";

function answersAnAssistantQuestion(history: readonly ChatMessage[]): boolean {
  const last = history.at(-1);
  return last?.role === "assistant" && last.content.trim().endsWith("?");
}

function hasPicture(turn: AnswerOnlyTurn): boolean {
  return turn.image !== undefined || (turn.images?.length ?? 0) > 0;
}

function ownsAJob(state: AnswerOnlyState, turn: AnswerOnlyTurn): boolean {
  return turn.continueJobId !== undefined || hasCarriedRequest(state, turn.sessionId) || hasBlockedJob(state);
}

/**
 * Whether this message only asks for an answer. It is taken only when a decision model settled the route as answer-only in the act band; with no model, a pending job, a
 * carried question, an attached picture or a reply to the assistant's own question the message routes normally, so an answer-only turn can never block a later edit.
 */
export async function answersOnly(state: AnswerOnlyState, turn: AnswerOnlyTurn): Promise<boolean> {
  if (!state.decisions.hasModels() || ownsAJob(state, turn) || answersAnAssistantQuestion(turn.history) || hasPicture(turn)) return false;
  const text = workflowGoalText(turn.message);
  await primeJobOpen(state.decisions, { request: text, message: turn.message });
  const entry = { decision: REQUEST_ROUTE.name, text };
  return bookedOneOf(entry, ["answer-only"]) === "answer-only" && bookedBand(entry) === ACT_BAND;
}
