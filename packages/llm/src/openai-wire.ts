/** The chat-completions, streaming, model-list and Responses payloads of OpenAI-compatible providers, decoded into exact types: a field a provider omits or mistypes reads as absent. */
import { array, decode, decodeJson, type Infer, jsonObject, jsonValue, number, object, string } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { toolCallArguments } from "./tool-arguments.js";
import type { AgentToolCall } from "./types.js";
import { lenientList, present, softly } from "./wire-common.js";

const usageShape = object({
  prompt_tokens: softly(number()),
  completion_tokens: softly(number()),
  total_tokens: softly(number()),
  prompt_cache_hit_tokens: softly(number()),
  prompt_tokens_details: softly(object({ cached_tokens: softly(number()) })),
});

const toolCallShape = object({
  id: softly(string()),
  function: softly(object({ name: softly(string()), arguments: softly(jsonValue) })),
});

const messageFields = object({ content: softly(string()), tool_calls: lenientList(toolCallShape) });

export const chatCompletionShape = object({
  choices: lenientList(object({ message: softly(jsonObject), finish_reason: softly(string()) })),
  usage: softly(usageShape),
});

const toolFragmentShape = object({
  index: softly(number()),
  id: softly(string()),
  function: softly(object({ name: softly(string()), arguments: softly(string()) })),
});

const streamDeltaShape = object({ content: softly(string()), reasoning_content: softly(string()), tool_calls: lenientList(toolFragmentShape) });

const streamChunkShape = object({
  usage: softly(usageShape),
  choices: lenientList(object({ finish_reason: softly(string()), delta: softly(streamDeltaShape) })),
});

const modelRowShape = object({
  id: softly(string()),
  context_length: softly(number()),
  context_window: softly(number()),
  architecture: softly(object({ input_modalities: lenientList(string()) })),
  input_modalities: lenientList(string()),
  modalities: lenientList(string()),
  effort: softly(object({ supported_levels: lenientList(string()) })),
});

export const modelListShape = object({ data: lenientList(modelRowShape) });

const responsesItemShape = object({
  type: softly(string()),
  name: softly(string()),
  call_id: softly(string()),
  arguments: softly(jsonValue),
  content: lenientList(object({ type: softly(string()), text: softly(string()) })),
});

const responsesUsageShape = object({
  input_tokens: softly(number()),
  output_tokens: softly(number()),
  total_tokens: softly(number()),
  input_tokens_details: softly(object({ cached_tokens: softly(number()) })),
});

export const responsesPayloadShape = object({
  status: softly(string()),
  output_text: softly(string()),
  output: softly(array(jsonValue)),
  usage: softly(responsesUsageShape),
});

export type CompatibleUsage = Infer<typeof usageShape>;
export type ToolFragment = Infer<typeof toolFragmentShape>;
export type ModelRow = Infer<typeof modelRowShape>;
export type ModelList = Infer<typeof modelListShape>;
export type ResponsesItem = Infer<typeof responsesItemShape>;
export type ResponsesUsage = Infer<typeof responsesUsageShape>;
export type ResponsesPayload = Infer<typeof responsesPayloadShape>;
type StreamDelta = Infer<typeof streamDeltaShape>;
type ChatCompletionWire = Infer<typeof chatCompletionShape>;

/** One streamed chunk: its usage, its first choice's finish reason, text and tool-call fragments. */
export interface StreamChunk {
  usage: CompatibleUsage | undefined;
  finishReason: string | undefined;
  text: string | undefined;
  reasoning: string | undefined;
  fragments: ReadonlyArray<ToolFragment>;
}

/** The first choice of a non-streaming reply, with the provider's own message kept whole for replay. */
export interface ChatReply {
  message: JsonObject | undefined;
  text: string | undefined;
  toolCalls: AgentToolCall[];
  finishReason: string | undefined;
  usage: CompatibleUsage | undefined;
}

/** A chunk from one `data:` frame; JSON that is not an object decodes to nothing. */
export function decodeStreamChunk(frame: string): StreamChunk | undefined {
  const decoded = decodeJson(frame, streamChunkShape);
  if (!decoded.ok) return undefined;
  const choice = decoded.value.choices?.[0];
  return { usage: decoded.value.usage, finishReason: choice?.finish_reason, ...deltaFields(choice?.delta) };
}

export function interpretChatCompletion(wire: ChatCompletionWire): ChatReply {
  const choice = wire.choices?.[0];
  const message = choice?.message;
  const fields = messageFieldsOf(message);
  return {
    message,
    text: fields.content,
    toolCalls: callsOf(fields.tool_calls ?? []),
    finishReason: choice?.finish_reason,
    usage: wire.usage,
  };
}

/** Token counts in the provider's field names; cached prompt tokens are DeepSeek's `prompt_cache_hit_tokens` or OpenAI's `prompt_tokens_details.cached_tokens`. */
export function compatibleTokenCounts(usage: CompatibleUsage) {
  return {
    input: usage.prompt_tokens,
    output: usage.completion_tokens,
    total: usage.total_tokens,
    cached: usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/** The Responses `usage` object as token counts; cached tokens are already counted in the input. */
export function responsesTokenCounts(usage: ResponsesUsage) {
  return { input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens, cached: usage.input_tokens_details?.cached_tokens };
}

/** The Responses output items in the order the provider sent them; an item that is not an object reads as an empty one. */
export function responsesItems(output: ReadonlyArray<JsonValue>): ResponsesItem[] {
  return output.map((item) => {
    const decoded = decode(responsesItemShape, item);
    return decoded.ok ? decoded.value : {};
  });
}

/** Every text part of every output item, whatever its type, in the order the provider sent them. */
export function responsesOutputText(items: ReadonlyArray<ResponsesItem>): string | undefined {
  const chunks = items.flatMap((item) => (item.content ?? []).flatMap((part) => part?.text ?? []));
  return chunks.length ? chunks.join("\n") : undefined;
}

function messageFieldsOf(message: JsonObject | undefined): Infer<typeof messageFields> {
  const decoded = message ? decode(messageFields, message) : undefined;
  return decoded?.ok ? decoded.value : {};
}

function deltaFields(delta: StreamDelta | undefined): Pick<StreamChunk, "text" | "reasoning" | "fragments"> {
  return { text: delta?.content, reasoning: delta?.reasoning_content, fragments: (delta?.tool_calls ?? []).filter(present) };
}

function callsOf(wire: ReadonlyArray<Infer<typeof toolCallShape> | undefined>): AgentToolCall[] {
  const named = wire.flatMap((call) => {
    const name = call?.function?.name;
    return name === undefined ? [] : [{ call, name }];
  });
  return named.map(({ call, name }, index) => ({ id: call?.id ?? `call-${index}`, name, ...toolCallArguments(call?.function?.arguments) }));
}
