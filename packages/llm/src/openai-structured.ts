/** Structured output on the OpenAI-compatible endpoints: a `json_schema` response format, else `json_object` with the schema in the prompt, else the prompt alone; the Responses API takes `text.format`. */
import { chatCompletionShape, interpretChatCompletion, responsesItems, responsesOutputText, responsesPayloadShape } from "./openai-wire.js";
import { MAX_TOKENS_MESSAGE, postJson, responseFailure, type Transport } from "./openai-transport.js";
import { ProviderHttpError } from "./provider-http-error.js";
import { readBody } from "./wire-common.js";
import { isOpenRouterEndpoint, withOpenRouterDeny } from "./openai-compatible-capabilities.js";
import type { ChatRequestSettings } from "./openai-request.js";
import type { ModelCapabilities, StructuredMode } from "./model-capabilities.js";
import { refusalDetail } from "./model-capabilities.js";
import type { ChatContentPart, ChatResponseFormat, OpenAICompatibleChatRequest, ResponsesContentPart, ResponsesStructuredRequest } from "./provider-wire.js";
import { parseableJson, schemaInstruction } from "./structured-output.js";
import type { JsonCompletionRequest, JsonSchemaSpec, ProviderImage } from "./types.js";

const NEXT_MODE: { readonly [mode in StructuredMode]: StructuredMode | undefined } = { json_schema: "json_object", json_object: "prompt", prompt: undefined };

const FORMAT_REFUSAL: { readonly [mode in StructuredMode]: RegExp } = {
  json_schema: /response_format|json_schema|structured/i,
  json_object: /response_format|json_object|json mode/i,
  prompt: /$^/,
};

function dataUrlOf(image: ProviderImage): string {
  return `data:${image.mediaType};base64,${image.base64}`;
}

function chatUserContent(request: JsonCompletionRequest): string | ChatContentPart[] {
  if (request.image === undefined) return request.user;
  return [{ type: "text", text: request.user }, { type: "image_url", image_url: { url: dataUrlOf(request.image) } }];
}

function responsesImage(request: JsonCompletionRequest): ResponsesContentPart[] {
  return request.image === undefined ? [] : [{ type: "input_image", image_url: dataUrlOf(request.image) }];
}

/** The chat request that asks for JSON in the given mode. */
export function chatStructuredBody(request: JsonCompletionRequest, schema: JsonSchemaSpec, mode: StructuredMode, settings: ChatRequestSettings): OpenAICompatibleChatRequest {
  const system = mode === "json_schema" ? request.system : schemaInstruction(request.system, schema);
  return withOpenRouterDeny<OpenAICompatibleChatRequest>(isOpenRouterEndpoint(settings.config.id, settings.config.endpoint), {
    model: settings.model,
    messages: [{ role: "system", content: system }, { role: "user", content: chatUserContent(request) }],
    ...responseFormat(mode, schema),
    ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
  });
}

/** The Responses request that asks for JSON through `text.format`. */
export function responsesStructuredBody(request: JsonCompletionRequest, schema: JsonSchemaSpec, settings: ChatRequestSettings): ResponsesStructuredRequest {
  return {
    model: settings.model,
    instructions: request.system,
    input: [{ role: "user", content: [{ type: "input_text", text: request.user }, ...responsesImage(request)] }],
    text: { format: { type: "json_schema", name: schema.name, schema: schema.schema, strict: true } },
    store: false,
    ...(settings.maxTokens ? { max_output_tokens: settings.maxTokens } : {}),
  };
}

/** The richest mode the endpoint has not refused. */
export function structuredModeOf(capabilities: ModelCapabilities): StructuredMode {
  return capabilities.structuredOutput ?? "json_schema";
}

/** The next simpler mode when a refusal names the response format the request used, else undefined. */
export function structuredRefusalLesson(detail: string, mode: StructuredMode): ModelCapabilities | undefined {
  const next = NEXT_MODE[mode];
  return next !== undefined && FORMAT_REFUSAL[mode].test(refusalDetail(detail).message) ? { structuredOutput: next, reportedBy: "refusal" } : undefined;
}

function responseFormat(mode: StructuredMode, schema: JsonSchemaSpec): { response_format?: ChatResponseFormat } {
  if (mode === "json_schema") return { response_format: { type: "json_schema", json_schema: { name: schema.name, schema: schema.schema, strict: true } } };
  return mode === "json_object" ? { response_format: { type: "json_object" } } : {};
}

/** Posts a structured chat request and returns the reply's JSON text. */
export async function chatStructuredText(transport: Transport, body: OpenAICompatibleChatRequest, signal: AbortSignal): Promise<string> {
  const response = await postJson(transport, "/chat/completions", body, signal);
  if (!response.ok) throw await responseFailure(response);
  const reply = interpretChatCompletion(await readBody(response, chatCompletionShape, {}));
  if (reply.finishReason === "length") throw new ProviderHttpError(response.status, MAX_TOKENS_MESSAGE);
  if (!reply.text) throw new ProviderHttpError(response.status, "The compatible API returned no text output.");
  return parseableJson(reply.text, response.status);
}

/** Posts a structured Responses request and returns the reply's JSON text. */
export async function responsesStructuredText(transport: Transport, body: ResponsesStructuredRequest, signal: AbortSignal): Promise<string> {
  const response = await postJson(transport, "/responses", body, signal);
  if (!response.ok) throw await responseFailure(response);
  const payload = await readBody(response, responsesPayloadShape, {});
  const text = payload.output_text ?? responsesOutputText(responsesItems(payload.output ?? []));
  if (!text) throw new ProviderHttpError(response.status, "The Responses API returned no text output.");
  return parseableJson(text, response.status);
}
