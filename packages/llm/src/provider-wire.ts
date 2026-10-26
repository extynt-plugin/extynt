/** The request bodies the adapters send, as exact wire types: each is a plain object type, so a built body is also JSON. */
import type { JsonObject } from "@extynt/decode";
import type { ReasoningEffort } from "./provider-config.js";
import type { AnthropicBlock, AnthropicCache } from "./anthropic-wire.js";
import type { AgentToolSpec, ChatMessage } from "./types.js";

export type AnthropicMessagesRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: ChatMessage[];
};

export type AnthropicTurn = { role: "user" | "assistant"; content: AnthropicBlock[] };

export type AnthropicThinking = { type: "adaptive"; display?: "summarized" } | { type: "disabled" };

export type AnthropicReasoningParams = { thinking?: AnthropicThinking; output_config?: { effort: ReasoningEffort } };

export type AnthropicToolSchema = { name: string; description: string; input_schema: AgentToolSpec["parameters"] } & AnthropicCache;

export type AnthropicStepRequest = {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string } & AnthropicCache>;
  messages: AnthropicTurn[];
  tools?: AnthropicToolSchema[];
  stream?: true;
} & AnthropicReasoningParams;

export type AnthropicStructuredRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<ChatMessage | { role: "user"; content: AnthropicBlock[] }>;
  tools: AnthropicToolSchema[];
  tool_choice: { type: "tool"; name: string };
};

export type OpenAIResponsesRequest = {
  model: string;
  instructions: string;
  input: Array<{ role: "user" | "assistant"; content: Array<{ type: "input_text"; text: string }> }>;
  store: false;
};

export type OpenRouterProvider = { provider?: JsonObject };

export type ChatToolCallWire = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ChatWireMessage =
  | { role: "system" | "user"; content: string | ChatContentPart[] }
  | { role: "tool"; tool_call_id: string; content: string }
  | { role: "assistant"; content: string; tool_calls?: ChatToolCallWire[] }
  | JsonObject;

export type ChatToolSpec = { type: "function"; function: { name: string; description: string; parameters: AgentToolSpec["parameters"] } };

export type ChatResponseFormat = { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: JsonObject; strict: true } };

export type ChatReasoningParams = { thinking?: { type: "enabled" | "disabled" }; reasoning_effort?: ReasoningEffort };

export type OpenAICompatibleChatRequest = {
  model: string;
  messages: ChatWireMessage[];
  max_tokens?: number;
  tools?: ChatToolSpec[];
  tool_choice?: "auto";
  response_format?: ChatResponseFormat;
  plugins?: Array<{ id: "auto-router"; allowed_models: string[] }>;
  stream?: true;
  stream_options?: { include_usage: true };
  provider?: JsonObject;
} & ChatReasoningParams;

export type ResponsesStructuredRequest = {
  model: string;
  instructions: string;
  input: Array<{ role: "user"; content: ResponsesContentPart[] }>;
  text: { format: { type: "json_schema"; name: string; schema: JsonObject; strict: true } };
  store: false;
  max_output_tokens?: number;
};

export type ResponsesContentPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

export type ResponsesStepRequest = {
  model: string;
  instructions: string;
  input: JsonObject[];
  tools: Array<{ type: "function"; name: string; description: string; parameters: AgentToolSpec["parameters"]; strict: false }>;
  store: false;
  include: ["reasoning.encrypted_content"];
  reasoning?: { effort: ReasoningEffort };
  max_output_tokens?: number;
};
