/** Reasoning controls for the Messages API, decided by what the model itself reports: its Models API entry and, where that is missing, the API's own refusal of a request. No model names are listed here. */
import type { ReasoningEffort } from "./provider-config.js";
import { effortLadder, effortWithin, effortsFromRefusal, refusalDetail, type ModelCapabilities } from "./model-capabilities.js";
import type { AnthropicModelEntry } from "./anthropic-wire.js";
import type { AnthropicReasoningParams, AnthropicThinking } from "./provider-wire.js";

const THINKING_MAX_TOKENS = 64_000;
const DEFAULT_MAX_TOKENS = 8_192;
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface SentFeatures {
  effort?: ReasoningEffort;
  display: boolean;
  adaptive: boolean;
  image: boolean;
}

type ModelCapabilitiesEntry = NonNullable<AnthropicModelEntry["capabilities"]>;

/** One Models API entry (`GET /v1/models/{id}`) read into capabilities; a branch the entry omits stays unreported. */
export function anthropicCapabilities(entry: AnthropicModelEntry): ModelCapabilities {
  const capabilities = entry.capabilities;
  return { ...reportedEfforts(capabilities?.effort), ...reportedThinking(capabilities?.thinking), ...reportedImages(capabilities?.image_input), ...reportedLimits(entry), reportedBy: "provider" };
}

function reportedEfforts(effort: ModelCapabilitiesEntry["effort"]): ModelCapabilities {
  if (!effort) return {};
  return { efforts: effort.supported === true ? effortLadder(ANTHROPIC_EFFORTS.filter((level) => effort[level]?.supported === true)) : [] };
}

function reportedThinking(thinking: ModelCapabilitiesEntry["thinking"]): ModelCapabilities {
  return thinking ? { adaptiveThinking: thinking.supported === true && thinking.types?.adaptive?.supported === true } : {};
}

function reportedImages(images: ModelCapabilitiesEntry["image_input"]): ModelCapabilities {
  return images === undefined ? {} : { images: images.supported === true };
}

function reportedLimits(entry: AnthropicModelEntry): ModelCapabilities {
  const maxOutput = entry.max_tokens ?? 0, window = entry.max_input_tokens ?? 0;
  return { ...(maxOutput > 0 ? { maxOutputTokens: maxOutput } : {}), ...(window > 0 ? { contextWindow: window } : {}) };
}

/** The request fields one step sends for the chosen effort. `none` never disables thinking on a model that thinks:
 * that is a 400 on some models and on others turns tool calls into plain text, so it becomes the lowest effort. */
export function anthropicReasoningParams(capabilities: ModelCapabilities, effort: ReasoningEffort | undefined): AnthropicReasoningParams {
  if (effort === undefined) return {};
  if (capabilities.efforts === undefined && capabilities.adaptiveThinking === undefined) return unreportedModelParams(effort);
  const level = reportedLevel(capabilities, effort);
  const thinks = capabilities.adaptiveThinking === true && effort !== "none";
  return { ...(thinks ? { thinking: adaptiveThinking(capabilities) } : {}), ...(level ? { output_config: { effort: level } } : {}) };
}

/** The output limit one step asks for: the user's own setting within the model's ceiling, else the model's own maximum,
 * else the thinking ceiling for a model that thinks and a conventional 8192 for one that does not. */
export function anthropicMaxTokens(capabilities: ModelCapabilities, configured: number | undefined): number {
  const ceiling = capabilities.maxOutputTokens;
  if (configured) return ceiling ? Math.min(configured, ceiling) : configured;
  return ceiling ?? (capabilities.adaptiveThinking === true ? THINKING_MAX_TOKENS : DEFAULT_MAX_TOKENS);
}

/** What a refused step says the model does not take, or undefined when the refusal is about something else. */
export function anthropicRefusalLesson(body: string, sent: SentFeatures): ModelCapabilities | undefined {
  const { message } = refusalDetail(body);
  const lower = message.toLowerCase();
  return thinkingLesson(sent, lower) ?? effortLesson(sent, lower, message) ?? imageLesson(sent, lower);
}

function reportedLevel(capabilities: ModelCapabilities, effort: ReasoningEffort): ReasoningEffort | undefined {
  if (capabilities.efforts?.length === 0) return undefined;
  return effortWithin(capabilities.efforts, effort === "none" || effort === "minimal" ? "low" : effort);
}

function thinkingLesson(sent: SentFeatures, lower: string): ModelCapabilities | undefined {
  if (sent.display && lower.includes("display")) return { thinkingDisplay: false, reportedBy: "refusal" };
  return sent.adaptive && lower.includes("adaptive") ? { adaptiveThinking: false, reportedBy: "refusal" } : undefined;
}

function effortLesson(sent: SentFeatures, lower: string, message: string): ModelCapabilities | undefined {
  return sent.effort && lower.includes("effort") ? { efforts: effortsFromRefusal(message, sent.effort), reportedBy: "refusal" } : undefined;
}

function imageLesson(sent: SentFeatures, lower: string): ModelCapabilities | undefined {
  return sent.image && /\bimages?\b/.test(lower) ? { images: false, reportedBy: "refusal" } : undefined;
}

function unreportedModelParams(effort: ReasoningEffort): AnthropicReasoningParams {
  if (effort === "none") return { thinking: { type: "disabled" } };
  return { output_config: { effort: effort === "minimal" ? "low" : effort } };
}

function adaptiveThinking(capabilities: ModelCapabilities): AnthropicThinking {
  return capabilities.thinkingDisplay === false ? { type: "adaptive" } : { type: "adaptive", display: "summarized" };
}
