/** Reads the model's own reasoning back out of the raw assistant message an adapter kept for replay. */
import { array, decode, type JsonValue, literal, map, object, string, union } from "@extynt/decode";
import { ignored, present } from "./wire-common.js";

const reasoningContent = object({ reasoning_content: string() });
const thinkingBlocks = array(union(object({ type: literal("thinking"), thinking: string() }), ignored));
const replayedBlocks = union(thinkingBlocks, map(object({ content: thinkingBlocks }), (message) => message.content));

/** The provider's own reasoning, in whichever shape the adapter kept it: DeepSeek's `reasoning_content`, or Anthropic's `thinking` blocks, either as the reply's content blocks themselves or under a whole message's `content`. */
export function extractReasoning(raw: JsonValue | undefined): string {
  const direct = decode(reasoningContent, raw);
  if (direct.ok && direct.value.reasoning_content.trim()) return direct.value.reasoning_content;
  const blocks = decode(replayedBlocks, raw);
  return blocks.ok ? blocks.value.filter(present).map((block) => block.thinking).join("\n") : "";
}
