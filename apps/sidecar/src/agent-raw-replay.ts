// Reads and rewrites the verbatim provider record of an assistant turn so a long turn can drop spent reasoning and bulky accepted arguments without breaking the provider's replay contract.
import { accepts, array, nullable, object, optional, string, union, type Decoder, type Infer } from "@extynt/decode";
import type { AgentMessage } from "@extynt/llm";
import { jsonOf } from "@extynt/mcp-server";
import type { ToolArguments } from "./agent-types.js";

type ProviderRecord = Extract<AgentMessage, { role: "assistant" }>["raw"];

function lenient<T>(decoder: Decoder<T>) {
  return optional(nullable(decoder));
}

const ELIDED_REASONING_PLACEHOLDER = "[earlier reasoning elided to save room; the tool calls it produced and the results that answered them are kept below]";
const SIGNED_THINKING_TYPES: ReadonlySet<string> = new Set(["thinking", "redacted_thinking"]);

const RAW_ENTRY = object({
  type: lenient(string()),
  id: lenient(string()),
  call_id: lenient(string()),
  function: lenient(object({ arguments: lenient(string()) })),
});
const RAW_ENTRIES = array(RAW_ENTRY);
const RAW_CHAT_MESSAGE = object({
  reasoning_content: lenient(string()),
  tool_calls: lenient(RAW_ENTRIES),
  content: lenient(union(string(), RAW_ENTRIES)),
});

type RawEntry = Infer<typeof RAW_ENTRY>;

const isRawEntries = accepts(RAW_ENTRIES);
const isRawChatMessage = accepts(RAW_CHAT_MESSAGE);

function isSignedThinking(block: RawEntry): boolean {
  return typeof block.type === "string" && SIGNED_THINKING_TYPES.has(block.type);
}

function withoutThinkingBlocks(blocks: readonly RawEntry[]): readonly RawEntry[] | undefined {
  const kept = blocks.filter((block) => !isSignedThinking(block));
  return kept.length === blocks.length ? undefined : kept;
}

function foldedChatCall(entry: RawEntry, replaced: ReadonlyMap<string, ToolArguments>): ProviderRecord {
  const folded = typeof entry.id === "string" ? replaced.get(entry.id) : undefined;
  return entry.function && folded ? { ...entry, function: { ...entry.function, arguments: JSON.stringify(folded) } } : entry;
}

function foldedRow(entry: RawEntry, replaced: ReadonlyMap<string, ToolArguments>): ProviderRecord {
  const id = entry.type === "function_call" ? entry.call_id : entry.id;
  const folded = typeof id === "string" ? replaced.get(id) : undefined;
  if (!folded) return entry;
  if (entry.type === "function_call") return { ...entry, arguments: JSON.stringify(folded) };
  if (entry.type === "tool_use") return { ...entry, input: folded };
  return entry;
}

/** Whether the provider record carries plain-text reasoning (DeepSeek-style `reasoning_content`) that can be elided. */
export function hasReasoningText(raw: ProviderRecord): boolean {
  return isRawChatMessage(raw) && typeof raw.reasoning_content === "string";
}

/**
 * The provider record with its reasoning removed, or undefined when there is nothing to remove. Plain-text reasoning keeps its field and only its text goes, because the provider contract is the thinking being there alongside the call.
 * Signed thinking blocks are replayed whole or dropped, never edited, because the provider signs each over its text. The record passed in is never mutated.
 */
export function elideReasoning(raw: ProviderRecord): ProviderRecord | undefined {
  if (isRawEntries(raw)) return withoutThinkingBlocks(raw);
  if (!isRawChatMessage(raw)) return undefined;
  if (typeof raw.reasoning_content === "string") {
    return raw.reasoning_content.length <= ELIDED_REASONING_PLACEHOLDER.length ? undefined : { ...raw, reasoning_content: ELIDED_REASONING_PLACEHOLDER };
  }
  const content = typeof raw.content === "object" && raw.content !== null ? withoutThinkingBlocks(raw.content) : undefined;
  return content ? { ...raw, content } : undefined;
}

/** The provider record with the arguments of the replaced calls swapped in, for each provider's replay shape: chat `tool_calls[].function.arguments` (a JSON string), Responses `function_call` rows and Anthropic `tool_use` blocks. Anything unrecognised is returned as it came. */
export function rawWithArguments(raw: ProviderRecord, replaced: ReadonlyMap<string, ToolArguments>): ProviderRecord {
  if (isRawEntries(raw)) return jsonOf(raw.map((row) => foldedRow(row, replaced)));
  if (!isRawChatMessage(raw)) return raw;
  if (raw.tool_calls) return { ...raw, tool_calls: jsonOf(raw.tool_calls.map((entry) => foldedChatCall(entry, replaced))) };
  if (typeof raw.content === "object" && raw.content !== null) return { ...raw, content: jsonOf(raw.content.map((block) => foldedRow(block, replaced))) };
  return raw;
}
