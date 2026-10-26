/** One Chat Completions tool-calling step: the streaming attempt, the ordinary request it falls back to, and the reply either one becomes. */
import type { JsonObject } from "@extynt/decode";
import { chatCompletionShape, compatibleTokenCounts, interpretChatCompletion, type ChatReply, type CompatibleUsage } from "./openai-wire.js";
import type { StepRequests } from "./openai-request.js";
import { compatibleHttpFailure, MAX_TOKENS_MESSAGE, postJson, responseFailure, type Transport } from "./openai-transport.js";
import { AGENT_STEP_TIMEOUT_FLOOR_MS, type StallGuard } from "./provider-stall.js";
import { ProviderHttpError } from "./provider-http-error.js";
import { assembleAssistantMessage, readCompatibleStream, type CompatibleStreamCallbacks, type CompatibleStreamOutcome } from "./stream.js";
import type { AgentStepInput, AgentStepResult, AgentToolCall } from "./types.js";
import { completionUsage, readBody } from "./wire-common.js";

export interface ChatStepRoute {
  transport: Transport;
  input: AgentStepInput;
  signal: AbortSignal;
  guard: StallGuard;
  requestTimeoutMs: number;
  streaming: boolean;
}

interface StepParts {
  text: string;
  toolCalls: AgentToolCall[];
  raw: JsonObject;
  finishReason: string | undefined;
  usage: CompatibleUsage | undefined;
}

const CHAT_PATH = "/chat/completions";

/** Sends the step. Streaming is never a new failure mode: any failure of the streaming attempt falls through to the ordinary request, so the reply is whole and unduplicated even when the caller already saw partial deltas. */
export async function sendChatStep(route: ChatStepRoute, requests: StepRequests): Promise<AgentStepResult> {
  if (route.streaming) {
    const streamed = await streamedStep(route, requests);
    if (streamed) return streamed;
  }
  route.guard.cap(Math.max(route.requestTimeoutMs, AGENT_STEP_TIMEOUT_FLOOR_MS));
  return plainStep(route, requests("plain"));
}

async function streamedStep(route: ChatStepRoute, requests: StepRequests): Promise<AgentStepResult | null> {
  const outcome = await attemptStream(route, requests);
  return outcome ? streamResult(outcome) : null;
}

async function attemptStream(route: ChatStepRoute, requests: StepRequests): Promise<CompatibleStreamOutcome | null> {
  try {
    const stream = (await requestStream(route, requests, true)).body;
    return stream ? await readCompatibleStream(stream, streamCallbacks(route)) : null;
  } catch (error) {
    if (route.signal.aborted) throw error;
    return null;
  }
}

function streamCallbacks({ guard, input }: ChatStepRoute): CompatibleStreamCallbacks {
  return {
    onText: (text) => { guard.touch(); input.onDelta?.({ text, reasoning: "" }); },
    onReasoning: (reasoning) => { guard.touch(); input.onDelta?.({ text: "", reasoning }); },
    onToolFragment: () => guard.touch(),
  };
}

function streamResult({ reply, sawDone }: CompatibleStreamOutcome): AgentStepResult | null {
  const cutOff = (!reply.text && !reply.toolCalls.length) || (!sawDone && !reply.finishReason);
  if (cutOff) return null;
  if (reply.finishReason === "length") throw new ProviderHttpError(200, MAX_TOKENS_MESSAGE);
  return stepResult({ text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw, finishReason: reply.finishReason, usage: reply.usage });
}

async function requestStream(route: ChatStepRoute, requests: StepRequests, withUsage: boolean): Promise<Response> {
  const response = await postJson(route.transport, CHAT_PATH, requests(withUsage ? "streaming" : "streaming-without-usage"), route.signal);
  if (response.ok) return response;
  const detail = await response.text().catch(() => "");
  if (withUsage && refusesStreamOptions(response.status, detail)) return requestStream(route, requests, false);
  throw compatibleHttpFailure(response.status, detail);
}

function refusesStreamOptions(status: number, detail: string): boolean {
  return (status === 400 || status === 422) && detail.includes("stream_options");
}

async function plainStep(route: ChatStepRoute, body: ReturnType<StepRequests>): Promise<AgentStepResult> {
  const response = await postJson(route.transport, CHAT_PATH, body, route.signal);
  if (!response.ok) throw await responseFailure(response);
  return replyStep(interpretChatCompletion(await readBody(response, chatCompletionShape, {})), response.status);
}

function replyStep(reply: ChatReply, status: number): AgentStepResult {
  if (!reply.message) throw new ProviderHttpError(status, "The compatible API returned no message.");
  const text = reply.text ?? "";
  if (reply.finishReason === "length") throw new ProviderHttpError(status, MAX_TOKENS_MESSAGE);
  if (!text && !reply.toolCalls.length) throw new ProviderHttpError(status, "The compatible API returned no text or tool calls.");
  return stepResult({ text, toolCalls: reply.toolCalls, raw: assembleAssistantMessage(reply.message, reply.toolCalls), finishReason: reply.finishReason, usage: reply.usage });
}

function stepResult(parts: StepParts): AgentStepResult {
  return {
    text: parts.text,
    toolCalls: parts.toolCalls,
    raw: parts.raw,
    ...(parts.finishReason ? { finishReason: parts.finishReason } : {}),
    ...(parts.usage ? { usage: completionUsage(compatibleTokenCounts(parts.usage)) } : {}),
  };
}
