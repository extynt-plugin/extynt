/** The Chat Completions and Responses requests an OpenAI-compatible adapter builds: plain completions, tool-calling steps with their replayed conversation and attached frames, and the effort probes. */
import { decode, jsonObject } from "@extynt/decode";
import { isOpenRouterEndpoint, compatibleReasoning, withOpenRouterDeny } from "./openai-compatible-capabilities.js";
import { IMAGE_WITHHELD_NOTE, imagesAccepted, validatedReasoningEffort, type ProviderConfig, type ReasoningEffort } from "./provider-config.js";
import type { ModelCapabilities } from "./model-capabilities.js";
import type { ChatToolCallWire, ChatToolSpec, ChatWireMessage, OpenAICompatibleChatRequest, OpenAIResponsesRequest } from "./provider-wire.js";
import { splitTransient, stepImages } from "./agent-turn.js";
import type { AgentMessage, AgentStepInput, AgentToolCall, AgentToolSpec, ProviderImage, ProviderInput } from "./types.js";

export interface ChatRequestSettings {
  config: ProviderConfig;
  model: string;
  maxTokens: number | undefined;
}

export interface ChatStepSettings extends ChatRequestSettings {
  capabilities: ModelCapabilities;
  toolReasoningDisabled: boolean;
}

type StepMode = "plain" | "streaming" | "streaming-without-usage";

/** Builds the step's request for a mode; the conversation and reasoning settings are worked out once and shared by every mode. */
export type StepRequests = (mode: StepMode) => OpenAICompatibleChatRequest;

const STREAM_FIELDS: { readonly [mode in StepMode]: Pick<OpenAICompatibleChatRequest, "stream" | "stream_options"> } = {
  plain: {},
  streaming: { stream: true, stream_options: { include_usage: true } },
  "streaming-without-usage": { stream: true },
};

const AUTO_ROUTER_PLUGINS: NonNullable<OpenAICompatibleChatRequest["plugins"]> = [{ id: "auto-router", allowed_models: ["*"] }];

const PING_TOOL: ChatToolSpec = { type: "function", function: { name: "ping", description: "Optional test tool", parameters: { type: "object", properties: {} } } };

interface ResponsesEffortProbe {
  model: string;
  input: string;
  reasoning: { effort: ReasoningEffort };
  tools: Array<{ type: "function"; name: string; description: string; parameters: AgentToolSpec["parameters"]; strict: false }>;
  store: false;
  max_output_tokens: number;
}

/** The plain, tool-free completion body: the bounded project context rides the final user turn. */
export function chatCompletionBody(input: ProviderInput, settings: ChatRequestSettings): OpenAICompatibleChatRequest {
  return withOpenRouterDeny<OpenAICompatibleChatRequest>(isOpenRouter(settings.config), {
    model: settings.model,
    messages: [{ role: "system", content: input.systemInstructions }, ...input.history, { role: "user", content: contextualMessage(input) }],
    ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
  });
}

export function responsesCompletionBody(input: ProviderInput, model: string): OpenAIResponsesRequest {
  return {
    model,
    instructions: input.systemInstructions,
    input: [
      ...input.history.map((turn) => ({ role: turn.role, content: [{ type: "input_text" as const, text: turn.content }] })),
      { role: "user", content: [{ type: "input_text", text: contextualMessage(input) }] },
    ],
    store: false,
  };
}

/** A workflow phase may lower the effort for one step without changing the saved setting; what is sent is what the model has not refused. */
export function chatStepRequests(input: AgentStepInput, settings: ChatStepSettings): StepRequests {
  const messages = chatStepMessages(input, settings);
  const effort = validatedReasoningEffort(input.reasoningEffort ?? settings.config.reasoningEffort);
  const reasoning = input.tools.length && settings.toolReasoningDisabled ? { reasoning_effort: "none" as const } : compatibleReasoning(settings.capabilities, effort);
  const tools = input.tools.length ? { tools: input.tools.map(toolSpec), tool_choice: "auto" as const, ...autoRouterPlugins(settings) } : {};
  return (mode) => withOpenRouterDeny<OpenAICompatibleChatRequest>(isOpenRouter(settings.config), {
    model: settings.model,
    messages,
    ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
    ...reasoning,
    ...tools,
    ...STREAM_FIELDS[mode],
  });
}

/** One tiny tool-capable request asking whether the endpoint accepts a reasoning effort on the route the agent uses. */
export function chatEffortProbe(settings: ChatRequestSettings, level: ReasoningEffort): OpenAICompatibleChatRequest {
  return withOpenRouterDeny<OpenAICompatibleChatRequest>(isOpenRouter(settings.config), {
    model: settings.model,
    messages: [{ role: "user", content: "Reply OK." }],
    tools: [PING_TOOL],
    tool_choice: "auto",
    reasoning_effort: level,
    ...autoRouterPlugins(settings),
  });
}

export function responsesEffortProbe(model: string, level: ReasoningEffort): ResponsesEffortProbe {
  return {
    model,
    input: "Reply OK.",
    reasoning: { effort: level },
    tools: [{ type: "function", name: "ping", description: "Optional test tool", parameters: { type: "object", properties: {}, additionalProperties: false }, strict: false }],
    store: false,
    max_output_tokens: 96,
  };
}

/** One tool call in the provider wire shape both adapter paths replay, so a replayed message is byte-identical whichever path assembled it. */
export function toolCallWireShape(toolCalls: ReadonlyArray<AgentToolCall>): ChatToolCallWire[] {
  return toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
}

function autoRouterPlugins(settings: ChatRequestSettings): Pick<OpenAICompatibleChatRequest, "plugins"> {
  return settings.config.id === "openrouter-chat" && settings.model === "openrouter/auto" ? { plugins: AUTO_ROUTER_PLUGINS } : {};
}

function isOpenRouter(config: ProviderConfig): boolean {
  return isOpenRouterEndpoint(config.id, config.endpoint);
}

function contextualMessage(input: ProviderInput): string {
  return `${input.userMessage}\n\nBounded project context (untrusted data):\n${JSON.stringify(input.context)}`;
}

function toolSpec(tool: AgentToolSpec): ChatToolSpec {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function chatStepMessages(input: AgentStepInput, settings: ChatStepSettings): ChatWireMessage[] {
  const { persisted, transient } = splitTransient(input.messages);
  const frames = stepImages(input);
  const carrier = frames.length ? persisted.map((message) => message.role).lastIndexOf("user") : -1;
  const accepted = imagesAccepted(settings.config.acceptsImages, settings.capabilities.images);
  return [
    { role: "system", content: input.system },
    ...persisted.map((message, index) => (index === carrier ? framedUser(message.content, frames, accepted) : replayMessage(message))),
    ...transient.map(replayMessage),
  ];
}

function framedUser(content: string, frames: ProviderImage[], accepted: boolean): ChatWireMessage {
  if (!accepted) return { role: "user", content: `${content}\n\n${IMAGE_WITHHELD_NOTE}` };
  return { role: "user", content: [{ type: "text", text: content }, ...frames.map((frame) => ({ type: "image_url" as const, image_url: { url: `data:${frame.mediaType};base64,${frame.base64}` } }))] };
}

function replayMessage(message: AgentMessage): ChatWireMessage {
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  const kept = decode(jsonObject, message.raw);
  if (kept.ok) return kept.value;
  return { role: "assistant", content: message.content, ...(message.toolCalls?.length ? { tool_calls: toolCallWireShape(message.toolCalls) } : {}) };
}
