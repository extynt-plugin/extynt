/** The Messages API requests an adapter builds: replayed turns with their cache breakpoints, tool schemas, attached frames, and the plain completion body. */
import { IMAGE_WITHHELD_NOTE, imagesAccepted, validatedReasoningEffort, type ProviderConfig } from "./provider-config.js";
import { anthropicMaxTokens, anthropicReasoningParams, type SentFeatures } from "./anthropic-reasoning.js";
import { replayableBlocks, type AnthropicBlock } from "./anthropic-wire.js";
import type { ModelCapabilities } from "./model-capabilities.js";
import type { AnthropicMessagesRequest, AnthropicStepRequest, AnthropicToolSchema, AnthropicTurn } from "./provider-wire.js";
import { splitTransient, stepImages } from "./agent-turn.js";
import type { AgentMessage, AgentStepInput, AgentToolSpec, ChatMessage, ProviderImage, ProviderInput } from "./types.js";

export interface AnthropicStepSettings {
  config: ProviderConfig;
  model: string;
  maxTokens: number | undefined;
  replayThinking: boolean;
  capabilities: ModelCapabilities;
}

/** The plain, tool-free completion body: the bounded project context rides the final user turn. */
export function anthropicCompletionBody(input: ProviderInput, model: string, maxTokens: number): AnthropicMessagesRequest {
  return {
    model,
    max_tokens: maxTokens,
    system: input.systemInstructions,
    messages: mergedTurns([
      ...input.history,
      { role: "user", content: `${input.userMessage}\n\nBounded project context (untrusted data):\n${JSON.stringify(input.context)}` },
    ]),
  };
}

export function anthropicStepBody(input: AgentStepInput, settings: AnthropicStepSettings): AnthropicStepRequest {
  const image = imagesAccepted(settings.config.acceptsImages, settings.capabilities.images);
  const effort = validatedReasoningEffort(input.reasoningEffort ?? settings.config.reasoningEffort);
  return {
    model: settings.model,
    max_tokens: anthropicMaxTokens(settings.capabilities, settings.maxTokens),
    system: systemBlocks(input),
    messages: stepTurns(input, settings.replayThinking, image),
    ...anthropicReasoningParams(settings.capabilities, effort),
    ...(input.tools.length ? { tools: toolSchemas(input.tools) } : {}),
  };
}

/** Which of the refusable fields a built request carries, so a refusal is only read as being about one of them. */
export function sentFeatures(body: AnthropicStepRequest): SentFeatures {
  const adaptive = body.thinking?.type === "adaptive" ? body.thinking : undefined;
  return {
    ...(body.output_config ? { effort: body.output_config.effort } : {}),
    display: adaptive?.display !== undefined,
    adaptive: adaptive !== undefined,
    image: body.messages.some((turn) => turn.content.some((block) => block.type === "image")),
  };
}

function mergedTurns(history: ChatMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of history) {
    if (!messages.length && turn.role === "assistant") continue;
    const last = messages.at(-1);
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else messages.push({ role: turn.role, content: turn.content });
  }
  return messages;
}

function stepTurns(input: AgentStepInput, replayThinking: boolean, image: boolean): AnthropicTurn[] {
  const { persisted, transient } = splitTransient(input.messages);
  const turns = new AnthropicTurns();
  pushMessages(turns, persisted, replayThinking, true);
  for (const picture of stepImages(input)) turns.attachImage(picture, image);
  turns.markLastBlockCacheable();
  pushMessages(turns, transient, replayThinking, false);
  return turns.value;
}

function pushMessages(turns: AnthropicTurns, messages: AgentMessage[], replayThinking: boolean, leadingUser: boolean): void {
  let started = !leadingUser;
  for (const message of messages) {
    if (!started && message.role === "assistant") continue;
    started = true;
    const turn = turnOf(message, replayThinking);
    turns.push(turn.role, turn.blocks);
  }
}

function turnOf(message: AgentMessage, replayThinking: boolean): { role: "user" | "assistant"; blocks: AnthropicBlock[] } {
  if (message.role === "user") return { role: "user", blocks: [{ type: "text", text: message.content }] };
  if (message.role === "tool") return { role: "user", blocks: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
  const replay = replayableBlocks(message.raw).filter((block) => replayThinking || (block.type !== "thinking" && block.type !== "redacted_thinking"));
  return { role: "assistant", blocks: replay.length ? replay : rebuiltBlocks(message) };
}

function rebuiltBlocks(message: Extract<AgentMessage, { role: "assistant" }>): AnthropicBlock[] {
  return [
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ...(message.toolCalls ?? []).map((call) => ({ type: "tool_use" as const, id: call.id, name: call.name, input: call.arguments })),
  ];
}

class AnthropicTurns {
  private readonly messages: AnthropicTurn[] = [];

  public get value(): AnthropicTurn[] { return this.messages; }

  public push(role: "user" | "assistant", blocks: AnthropicBlock[]): void {
    if (!blocks.length) return;
    const last = this.messages.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else this.messages.push({ role, content: blocks });
  }

  public markLastBlockCacheable(): void {
    const block = this.messages.at(-1)?.content.at(-1);
    if (block && block.type !== "thinking" && block.type !== "redacted_thinking") block.cache_control = { type: "ephemeral" };
  }

  public attachImage(image: ProviderImage, accepted: boolean): void {
    const message = [...this.messages].reverse().find((turn) => turn.role === "user");
    message?.content.push(accepted ? { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } } : { type: "text", text: IMAGE_WITHHELD_NOTE });
  }
}

function systemBlocks(input: AgentStepInput): AnthropicStepRequest["system"] {
  const segments = input.systemSegments?.length ? input.systemSegments : [{ text: input.system, cache: true }];
  return segments.map((segment) => ({ type: "text", text: segment.text, ...(segment.cache ? { cache_control: { type: "ephemeral" as const } } : {}) }));
}

function toolSchemas(tools: AgentToolSpec[]): AnthropicToolSchema[] {
  return tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    ...(index === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}
