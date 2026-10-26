/** The Messages API as it arrives: every response, stream event and error body is decoded here into exact types, and a field the provider omits or mistypes reads as absent. */
import { array, boolean, decode, decodeJson, type Infer, jsonObject, literal, number, object, string, taggedUnion, union } from "@extynt/decode";
import type { AgentStepResult, AgentToolCall } from "./types.js";
import { ignored, lenientList, present, softly } from "./wire-common.js";

export const MAX_TOKENS_MESSAGE = "The Anthropic Messages API stopped at its max_tokens limit (stop_reason \"max_tokens\") before the answer finished.";

export type AnthropicCache = { cache_control?: { type: "ephemeral" } };

export type AnthropicBlock =
  | ({ type: "text"; text: string } & AnthropicCache)
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | ({ type: "tool_use"; id: string; name: string; input: AgentToolCall["arguments"] } & AnthropicCache)
  | ({ type: "tool_result"; tool_use_id: string; content: string } & AnthropicCache)
  | ({ type: "image"; source: { type: "base64"; media_type: string; data: string } } & AnthropicCache);

const usageShape = object({
  input_tokens: softly(number()),
  output_tokens: softly(number()),
  cache_read_input_tokens: softly(number()),
  cache_creation_input_tokens: softly(number()),
});

const failureShape = object({ type: softly(string()), message: softly(string()) });

const textWire = object({ type: literal("text"), text: softly(string()) });
const thinkingWire = object({ type: literal("thinking"), thinking: softly(string()), signature: softly(string()) });
const redactedWire = object({ type: literal("redacted_thinking"), data: softly(string()) });
const toolUseWire = object({ type: literal("tool_use"), id: softly(string()), name: softly(string()), input: softly(jsonObject) });

const wireBlock = union(taggedUnion("type", { text: textWire, thinking: thinkingWire, redacted_thinking: redactedWire, tool_use: toolUseWire }), ignored);

const streamEvent = union(
  taggedUnion("type", {
    content_block_delta: object({
      type: literal("content_block_delta"),
      delta: softly(object({ type: softly(string()), text: softly(string()), thinking: softly(string()), signature: softly(string()) })),
    }),
    message_delta: object({ type: literal("message_delta"), delta: softly(object({ stop_reason: softly(string()) })), usage: softly(usageShape) }),
    message_start: object({ type: literal("message_start"), message: softly(object({ usage: softly(usageShape) })) }),
    error: object({ type: literal("error"), error: softly(failureShape) }),
    message_stop: object({ type: literal("message_stop") }),
  }),
  ignored,
);

const capabilityFlag = object({ supported: softly(boolean()) });

export const anthropicReplyShape = object({
  content: lenientList(wireBlock),
  stop_reason: softly(string()),
  usage: softly(usageShape),
});

export const anthropicModelEntryShape = object({
  max_tokens: softly(number()),
  max_input_tokens: softly(number()),
  capabilities: softly(object({
    effort: softly(object({
      supported: softly(boolean()),
      low: softly(capabilityFlag),
      medium: softly(capabilityFlag),
      high: softly(capabilityFlag),
      xhigh: softly(capabilityFlag),
      max: softly(capabilityFlag),
    })),
    thinking: softly(object({ supported: softly(boolean()), types: softly(object({ adaptive: softly(capabilityFlag) })) })),
    image_input: softly(capabilityFlag),
  })),
});

const errorEnvelope = object({ error: softly(failureShape) });

export type AnthropicUsage = Infer<typeof usageShape>;
export type AnthropicStreamEvent = Infer<typeof streamEvent>;
export type AnthropicModelEntry = Infer<typeof anthropicModelEntryShape>;
type AnthropicWireReply = Infer<typeof anthropicReplyShape>;
type WireBlock = Infer<typeof wireBlock>;

export interface AnthropicReply {
  text: string | undefined;
  toolCalls: AgentToolCall[];
  stopReason: string | undefined;
  usage: AnthropicUsage | undefined;
  blocks: AnthropicBlock[];
}

export function decodeStreamEvent(line: string): AnthropicStreamEvent {
  const decoded = decodeJson(line, streamEvent);
  return decoded.ok ? decoded.value : undefined;
}

/** The provider-native blocks of an earlier assistant turn that are complete enough to replay, or none when the turn kept no blocks. */
export function replayableBlocks(raw: AgentStepResult["raw"]): AnthropicBlock[] {
  const decoded = decode(array(wireBlock), raw);
  return decoded.ok ? decoded.value.map(replayBlock).filter(present) : [];
}

export function interpretAnthropicReply(wire: AnthropicWireReply): AnthropicReply {
  const content = wire.content ?? [];
  return {
    text: answerText(content),
    toolCalls: toolCallsOf(content),
    stopReason: wire.stop_reason,
    usage: wire.usage,
    blocks: content.map(replayBlock).filter(present),
  };
}

export function anthropicTokenUsage(usage: AnthropicUsage) {
  const cached = usage.cache_read_input_tokens ?? 0;
  const inputTokens = (usage.input_tokens ?? 0) + cached + (usage.cache_creation_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedInputTokens: cached };
}

export function mergeAnthropicUsage(earlier: AnthropicUsage | undefined, later: AnthropicUsage | undefined): AnthropicUsage {
  const newest = (key: keyof AnthropicUsage): number | undefined => later?.[key] ?? earlier?.[key];
  return {
    input_tokens: newest("input_tokens"),
    output_tokens: newest("output_tokens"),
    cache_read_input_tokens: newest("cache_read_input_tokens"),
    cache_creation_input_tokens: newest("cache_creation_input_tokens"),
  };
}

/** The API's own error type and message from an error body, or the body itself when it says neither. */
export function anthropicErrorDetail(body: string): string {
  const decoded = decodeJson(body, errorEnvelope);
  return (decoded.ok ? failureText(decoded.value.error) : "") || body;
}

export function streamFailureText(error: Infer<typeof failureShape> | undefined): string {
  return failureText(error) || "the stream reported an error";
}

function failureText(error: Infer<typeof failureShape> | undefined): string {
  return [error?.type, error?.message].filter(Boolean).join(": ");
}

function replayBlock(block: WireBlock): AnthropicBlock | undefined {
  switch (block?.type) {
    case "text": return replayText(block);
    case "thinking": return replayThinking(block);
    case "redacted_thinking": return replayRedacted(block);
    case "tool_use": return replayToolUse(block);
    default: return undefined;
  }
}

function replayText(block: Infer<typeof textWire>): AnthropicBlock | undefined {
  return block.text === undefined ? undefined : { type: "text", text: block.text };
}

function replayThinking(block: Infer<typeof thinkingWire>): AnthropicBlock | undefined {
  return block.thinking === undefined || block.signature === undefined ? undefined : { type: "thinking", thinking: block.thinking, signature: block.signature };
}

function replayRedacted(block: Infer<typeof redactedWire>): AnthropicBlock | undefined {
  return block.data === undefined ? undefined : { type: "redacted_thinking", data: block.data };
}

function replayToolUse(block: Infer<typeof toolUseWire>): AnthropicBlock | undefined {
  return block.id && block.name && block.input ? { type: "tool_use", id: block.id, name: block.name, input: block.input } : undefined;
}

function answerText(content: ReadonlyArray<WireBlock>): string | undefined {
  const texts = content.flatMap((block) => (block?.type === "text" && block.text?.trim() ? [block.text] : []));
  return texts.length ? texts.join("\n") : undefined;
}

function toolCallsOf(content: ReadonlyArray<WireBlock>): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  for (const block of content) {
    if (block?.type !== "tool_use" || !block.name) continue;
    calls.push({ id: block.id ?? `toolu-${calls.length}`, name: block.name, arguments: block.input ?? {} });
  }
  return calls;
}
