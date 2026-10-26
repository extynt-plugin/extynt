/** Provider-advertised capabilities and exact refusal lessons for compatible requests, and the OpenRouter data-collection denial. */
import { effortLadder, effortWithin, effortsFromRefusal, refusalDetail, type ModelCapabilities } from "./model-capabilities.js";
import type { ModelList, ModelRow } from "./openai-wire.js";
import type { ReasoningEffort } from "./provider-config.js";
import type { ChatReasoningParams, OpenAICompatibleChatRequest, OpenRouterProvider } from "./provider-wire.js";
import { present } from "./wire-common.js";

/** DeepSeek's `thinking` switch alongside the effort, until the provider refuses either; a refused effort list narrows the level to the nearest one the model named. */
export function compatibleReasoning(capabilities: ModelCapabilities, effort: ReasoningEffort | undefined): ChatReasoningParams {
  if (effort === undefined) return {};
  const thinkingField = capabilities.thinkingField !== false;
  if (effort === "none" && thinkingField) return { thinking: { type: "disabled" } };
  const level = capabilities.efforts?.length === 0 ? undefined : effortWithin(capabilities.efforts, effort);
  return { ...(thinkingField ? { thinking: { type: "enabled" } } : {}), ...(level ? { reasoning_effort: level } : {}) };
}

/** What a refused step says the model does not take, or undefined when the refusal is about something else. */
export function compatibleRefusalLesson(detail: string, body: OpenAICompatibleChatRequest): ModelCapabilities | undefined {
  const { message, param } = refusalDetail(detail);
  const lower = message.toLowerCase();
  const names = (field: string, pattern: RegExp): boolean => param === field || pattern.test(lower);
  if (body.thinking !== undefined && names("thinking", /\bthinking\b/)) return { thinkingField: false, reportedBy: "refusal" };
  if (body.reasoning_effort !== undefined && names("reasoning_effort", /reasoning[_ ]?effort|reasoningeffort/)) return { efforts: effortsFromRefusal(message, body.reasoning_effort), reportedBy: "refusal" };
  return sentImage(body) && /image|multimodal|vision/.test(lower) ? { images: false, reportedBy: "refusal" } : undefined;
}

/** True when a refusal says function tools cannot be combined with the reasoning effort the request carried. */
export function refusesToolReasoning(detail: string, body: OpenAICompatibleChatRequest): boolean {
  return Boolean(body.tools?.length) && body.reasoning_effort !== undefined && /function tools with reasoning[_ ]?effort are not supported/i.test(refusalDetail(detail).message);
}

/** The configured model's row in a `/models` list, read for what it says the model takes. */
export function compatibleCapabilities(list: ModelList, model: string): ModelCapabilities {
  const row = (list.data ?? []).find((entry) => entry?.id === model);
  const reported = row ? reportedFields(row) : {};
  return Object.keys(reported).length ? { ...reported, reportedBy: "provider" } : {};
}

/** OpenRouter routes to whichever host serves the model; `data_collection: "deny"` keeps a request off hosts that retain or train on prompts. Any `provider` fields the body already carries stay. */
export function withOpenRouterDeny<Body extends OpenRouterProvider>(isOpenRouter: boolean, body: Body): Body {
  return isOpenRouter ? { ...body, provider: { ...body.provider, data_collection: "deny" } } : body;
}

export function isOpenRouterEndpoint(configId: string, endpoint: string): boolean {
  return configId === "openrouter-chat" || (URL.canParse(endpoint) && new URL(endpoint).hostname === "openrouter.ai");
}

function reportedFields(row: ModelRow): ModelCapabilities {
  const images = (row.architecture?.input_modalities ?? row.input_modalities ?? row.modalities)?.includes("image");
  const contextWindow = [row.context_length, row.context_window].find(isPositive);
  const efforts = effortsOf(row);
  return {
    ...(images === undefined ? {} : { images }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(efforts === undefined ? {} : { efforts }),
  };
}

function effortsOf(row: ModelRow): ReasoningEffort[] | undefined {
  const levels = row.effort?.supported_levels;
  return levels ? effortLadder(levels.filter(present)) : undefined;
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && value > 0;
}

function sentImage(body: OpenAICompatibleChatRequest): boolean {
  return JSON.stringify(body.messages).includes("\"image_url\"");
}
