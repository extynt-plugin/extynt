/** The Responses API as a tool-calling step sends and reads it: the replayed conversation with its attached frames, and the ordered text and function calls of the output. */
import { array, decode, jsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { effortWithin } from "./model-capabilities.js";
import { responsesItems, responsesTokenCounts, type ResponsesItem, type ResponsesPayload } from "./openai-wire.js";
import { IMAGE_WITHHELD_NOTE, imagesAccepted, validatedReasoningEffort, type ProviderConfig, type ReasoningEffort } from "./provider-config.js";
import { ProviderHttpError } from "./provider-http-error.js";
import type { ResponsesStepRequest } from "./provider-wire.js";
import { splitTransient, stepImages } from "./agent-turn.js";
import { toolCallArguments } from "./tool-arguments.js";
import type { AgentMessage, AgentStepInput, AgentStepResult, AgentToolCall, ProviderImage } from "./types.js";
import { completionUsage } from "./wire-common.js";

interface ResponsesStepOptions {
  model: string;
  acceptsImages: ProviderConfig["acceptsImages"];
  observedImages: boolean | undefined;
  reasoningEffort: ProviderConfig["reasoningEffort"];
  efforts?: ReasoningEffort[] | undefined;
  maxTokens: number | undefined;
}

type ToolMessage = Extract<AgentMessage, { role: "tool" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

export function responsesStepBody(input: AgentStepInput, options: ResponsesStepOptions): ResponsesStepRequest {
  const { persisted, transient } = splitTransient(input.messages);
  const requested = validatedReasoningEffort(input.reasoningEffort ?? options.reasoningEffort);
  const effort = options.efforts?.length === 0 ? undefined : effortWithin(options.efforts, requested);
  return {
    model: options.model,
    instructions: input.system,
    input: [...withFrames(responsesMessages(persisted), input, options), ...responsesMessages(transient)],
    tools: input.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
    store: false,
    include: ["reasoning.encrypted_content"],
    ...(effort ? { reasoning: { effort } } : {}),
    ...(options.maxTokens ? { max_output_tokens: options.maxTokens } : {}),
  };
}

/** The step a completed Responses payload carries; a payload that did not complete, or answered with neither text nor a function call, is a provider error. */
export function completedResponsesStep(payload: ResponsesPayload, httpStatus: number): AgentStepResult {
  if (payload.status !== "completed") throw new ProviderHttpError(httpStatus, `The Responses API did not complete (${payload.status ?? "unknown status"}).`);
  const result = responsesStepResult(payload);
  if (!result.text && !result.toolCalls.length) throw new ProviderHttpError(httpStatus, "The Responses API returned no text or tool calls.");
  return result;
}

/** The output items replayed verbatim as `raw`, their message text, their function calls and the usage with cached tokens reported separately. */
export function responsesStepResult(payload: ResponsesPayload): AgentStepResult {
  const output = payload.output ?? [];
  const items = responsesItems(output);
  const toolCalls = functionCalls(items);
  const usage = payload.usage;
  return {
    text: items.map(messageText).join(""),
    toolCalls,
    raw: output,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
    ...(usage ? { usage: completionUsage(responsesTokenCounts(usage)) } : {}),
  };
}

function toolResultItem(message: ToolMessage, calls: ReadonlySet<string>): JsonObject {
  if (calls.has(message.toolCallId)) return { type: "function_call_output", call_id: message.toolCallId, output: message.content };
  return { role: "user", content: `Result of ${message.name}:\n${message.content}` };
}

function replayedItems(items: ReadonlyArray<JsonObject>, calls: Set<string>): JsonObject[] {
  for (const item of items) {
    const callId = item.call_id;
    if (item.type === "function_call" && typeof callId === "string") calls.add(callId);
  }
  return [...items];
}

function rebuiltAssistantItems(message: AssistantMessage, calls: Set<string>): JsonObject[] {
  const items: JsonObject[] = [];
  if (message.content || !message.toolCalls?.length) items.push({ role: "assistant", content: message.content });
  for (const call of message.toolCalls ?? []) {
    calls.add(call.id);
    items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
  }
  return items;
}

function messageItems(message: AgentMessage, calls: Set<string>): JsonObject[] {
  if (message.role === "tool") return [toolResultItem(message, calls)];
  if (message.role !== "assistant") return [{ role: message.role, content: message.content }];
  const raw = decode(array(jsonObject), message.raw);
  return raw.ok ? replayedItems(raw.value, calls) : rebuiltAssistantItems(message, calls);
}

function responsesMessages(messages: ReadonlyArray<AgentMessage>): JsonObject[] {
  const calls = new Set<string>();
  return messages.flatMap((message) => messageItems(message, calls));
}

function withFrames(items: JsonObject[], input: AgentStepInput, options: ResponsesStepOptions): JsonObject[] {
  const frames = stepImages(input);
  const carrier = items.map((item) => item.role).lastIndexOf("user");
  if (!frames.length || carrier < 0) return items;
  const accepted = imagesAccepted(options.acceptsImages, options.observedImages);
  return items.map((item, index) => (index === carrier ? framedItem(item, frames, accepted) : item));
}

function framedItem(item: JsonObject, frames: ReadonlyArray<ProviderImage>, accepted: boolean): JsonObject {
  const text = typeof item.content === "string" ? item.content : "";
  if (!accepted) return { ...item, content: `${text}\n\n${IMAGE_WITHHELD_NOTE}` };
  return { ...item, content: [{ type: "input_text", text }, ...frames.map((frame) => ({ type: "input_image", image_url: `data:${frame.mediaType};base64,${frame.base64}` }))] };
}

function functionCalls(items: ReadonlyArray<ResponsesItem>): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  for (const item of items) {
    if (item.type === "function_call" && item.name !== undefined) calls.push({ id: item.call_id ?? `call-${calls.length}`, name: item.name, ...toolCallArguments(item.arguments) });
  }
  return calls;
}

function messageText(item: ResponsesItem): string {
  if (item.type !== "message") return "";
  return (item.content ?? []).flatMap((part) => (part?.type === "output_text" && part.text !== undefined ? [part.text] : [])).join("");
}
