/** Structured output on the Messages API: one forced tool whose input schema is the caller's, with no thinking, and the tool's input read back as the JSON text. */
import { anthropicMaxTokens } from "./anthropic-reasoning.js";
import type { AnthropicReply } from "./anthropic-wire.js";
import type { ModelCapabilities } from "./model-capabilities.js";
import { ProviderHttpError } from "./provider-http-error.js";
import type { AnthropicStructuredRequest } from "./provider-wire.js";
import { parseableJson } from "./structured-output.js";
import type { JsonCompletionRequest, JsonSchemaSpec } from "./types.js";

export interface AnthropicStructuredSettings {
  model: string;
  maxTokens: number | undefined;
  capabilities: ModelCapabilities;
}

function userTurn(request: JsonCompletionRequest): AnthropicStructuredRequest["messages"][number] {
  const { image } = request;
  if (image === undefined) return { role: "user", content: request.user };
  return { role: "user", content: [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }, { type: "text", text: request.user }] };
}

/** The request that forces the model to call the one tool the schema describes. */
export function anthropicStructuredBody(request: JsonCompletionRequest, schema: JsonSchemaSpec, settings: AnthropicStructuredSettings): AnthropicStructuredRequest {
  return {
    model: settings.model,
    max_tokens: anthropicMaxTokens(settings.capabilities, settings.maxTokens),
    system: request.system,
    messages: [userTurn(request)],
    tools: [{ name: schema.name, description: "Return the answer as this object.", input_schema: schema.schema }],
    tool_choice: { type: "tool", name: schema.name },
  };
}

/** The forced tool's input as JSON text; a reply without that call is refused. */
export function anthropicStructuredText(reply: AnthropicReply, schema: JsonSchemaSpec, status: number): string {
  const call = reply.toolCalls.find((candidate) => candidate.name === schema.name);
  if (!call) throw new ProviderHttpError(status, "The Anthropic Messages API returned no structured output.");
  return parseableJson(JSON.stringify(call.arguments), status);
}
