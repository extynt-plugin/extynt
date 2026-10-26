// Turns the layered llm.env settings of a model slot into one resolved description of the service, address, key and limits it uses.
import { ASSUMED_CONTEXT_WINDOW, REASONING_EFFORTS, type ReasoningEffort } from "@extynt/llm";
import { effectiveEnvironment, sourceOf, type EnvSource, type EnvironmentLayers } from "./llm-env-layers.js";
import { SLOT_PREFIX, findModelService, isApiFormat, type ApiFormat, type ModelService, type ModelSlot } from "./llm-model-services.js";
import { effectiveTrainingPolicy, type TrainingPolicy } from "./training-policy.js";

/**
 * A slot ready to build a provider from. `maxOutputTokens` is sent as max_tokens: the user's AE_LLM_MAX_OUTPUT_TOKENS,
 * else the service's documented maximum for its default model; absent sends none.
 */
export interface ResolvedSlot {
  readonly service: ModelService;
  readonly format: ApiFormat;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string | undefined;
  readonly keyVariable: string | undefined;
  readonly keySource: EnvSource | undefined;
  readonly maxOutputTokens?: number;
  readonly contextWindow: number;
  readonly contextWindowSource: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly acceptsImages?: boolean;
  readonly stream: boolean;
  readonly trainingPolicy: TrainingPolicy;
  readonly trainingRiskAcknowledged: boolean;
}

interface SlotEnvironment {
  readonly layers: EnvironmentLayers;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly prefix: string;
}

function settingOf(slotEnv: SlotEnvironment, field: string): string | undefined {
  return slotEnv.env[`${slotEnv.prefix}${field}`];
}

function positiveInteger(text: string | undefined): number | undefined {
  const declared = Number(text);
  return Number.isInteger(declared) && declared > 0 ? declared : undefined;
}

function resolvedFormat(slotEnv: SlotEnvironment, service: ModelService): ApiFormat {
  const candidate = settingOf(slotEnv, "FORMAT");
  return isApiFormat(candidate) ? candidate : service.format;
}

function resolvedContextWindow(slotEnv: SlotEnvironment, service: ModelService): { contextWindow: number; contextWindowSource: string } {
  const declared = positiveInteger(settingOf(slotEnv, "CONTEXT_WINDOW"));
  if (declared !== undefined) return { contextWindow: declared, contextWindowSource: `declared in ${sourceOf(slotEnv.layers, `${slotEnv.prefix}CONTEXT_WINDOW`) ?? "settings"}` };
  if (service.contextWindow) return { contextWindow: service.contextWindow, contextWindowSource: "service default" };
  return { contextWindow: ASSUMED_CONTEXT_WINDOW, contextWindowSource: "conservative assumption" };
}

function resolvedMaxOutput(slotEnv: SlotEnvironment, service: ModelService, model: string): { maxOutputTokens?: number } {
  const declared = positiveInteger(settingOf(slotEnv, "MAX_OUTPUT_TOKENS"));
  if (declared !== undefined) return { maxOutputTokens: declared };
  return service.maxOutputTokens && model === service.model ? { maxOutputTokens: service.maxOutputTokens } : {};
}

function resolvedKey(slotEnv: SlotEnvironment, service: ModelService): Pick<ResolvedSlot, "apiKey" | "keyVariable" | "keySource"> {
  const slotKeyName = `${slotEnv.prefix}API_KEY`;
  const keyName = slotEnv.env[slotKeyName] ? slotKeyName : service.keyVariable && slotEnv.env[service.keyVariable] ? service.keyVariable : undefined;
  if (keyName === undefined) return { apiKey: undefined, keyVariable: service.keyVariable || slotKeyName, keySource: undefined };
  return { apiKey: slotEnv.env[keyName], keyVariable: keyName, keySource: sourceOf(slotEnv.layers, keyName) };
}

function resolvedReasoning(slotEnv: SlotEnvironment): { reasoningEffort?: ReasoningEffort } {
  const effort = REASONING_EFFORTS.find((level) => level === settingOf(slotEnv, "REASONING_EFFORT"));
  return effort ? { reasoningEffort: effort } : {};
}

function resolvedImages(slotEnv: SlotEnvironment): { acceptsImages?: boolean } {
  const declared = settingOf(slotEnv, "ACCEPTS_IMAGES")?.trim().toLowerCase();
  if (declared === "true") return { acceptsImages: true };
  return declared === "false" ? { acceptsImages: false } : {};
}

function isStreaming(slotEnv: SlotEnvironment): boolean {
  const declared = settingOf(slotEnv, "STREAM")?.trim().toLowerCase();
  return declared !== "0" && declared !== "false" && declared !== "off";
}

/**
 * The slot the layers describe, or undefined when no known service is named for it.
 *
 * An explicit context window wins over the service default, so a user on a service whose window is unknown can
 * declare theirs. `AE_LLM_ACCEPTS_IMAGES` is the user's own answer and outranks the model's; unset means ask the
 * model. `AE_LLM_REASONING_EFFORT` is the only source of a thinking depth: absent sends no effort parameter. Streaming
 * is on unless `AE_LLM_STREAM` switches it off: the adapter falls back to an ordinary request when a gateway cannot
 * stream, so leaving it on costs one wasted request where leaving it off costs the feature. It is environment-only
 * because the escape hatch for a misbehaving gateway must not wait for a UI change.
 */
export function resolveSlot(layers: EnvironmentLayers, slot: ModelSlot): ResolvedSlot | undefined {
  const slotEnv: SlotEnvironment = { layers, env: effectiveEnvironment(layers), prefix: SLOT_PREFIX[slot] };
  const service = findModelService(settingOf(slotEnv, "PROVIDER")?.trim());
  if (!service) return undefined;
  const model = (settingOf(slotEnv, "MODEL") || service.model).trim();
  const baseUrl = (settingOf(slotEnv, "BASE_URL") || service.baseUrl).trim();
  return {
    service, model, baseUrl,
    format: resolvedFormat(slotEnv, service),
    ...resolvedKey(slotEnv, service),
    ...resolvedContextWindow(slotEnv, service),
    ...resolvedReasoning(slotEnv),
    ...resolvedMaxOutput(slotEnv, service, model),
    ...resolvedImages(slotEnv),
    stream: isStreaming(slotEnv),
    trainingPolicy: effectiveTrainingPolicy(service, baseUrl),
    trainingRiskAcknowledged: settingOf(slotEnv, "ALLOW_TRAINING_RISK")?.trim() === "1",
  };
}
