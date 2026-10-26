// The model settings the panel's form shows: each slot's resolved service, address and limits, never the key itself; `keyHint` is the last four characters of a long key, `set` for a short one, and `overriddenBy` lists the layers above llm.env that override the slot's settings.
import type { ReasoningEffort } from "@extynt/llm";
import { sourceOf, type EnvSource, type EnvironmentLayers } from "./llm-env-layers.js";
import { API_FORMATS, MODEL_SERVICES, SLOT_FIELDS, SLOT_PREFIX, type ApiFormat, type ModelService, type ModelSlot } from "./llm-model-services.js";
import { resolveSlot, type ResolvedSlot } from "./llm-slot-resolution.js";
import type { TrainingPolicy } from "./training-policy.js";

interface ModelSlotView {
  readonly service: string;
  readonly format: ApiFormat;
  readonly baseUrl: string;
  readonly model: string;
  readonly keyConfigured: boolean;
  readonly keyHint: string | null;
  readonly keySource: string | null;
  readonly overriddenBy: readonly string[];
  readonly contextWindow: number;
  readonly contextWindowSource: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly acceptsImages?: boolean;
  readonly trainingPolicy: TrainingPolicy;
  readonly trainingRiskAcknowledged: boolean;
}

/** Everything the settings form needs: both slots, the services and formats to choose from, and the file the settings live in. */
export interface ModelSettingsView {
  readonly slots: Readonly<Record<ModelSlot, ModelSlotView | null>>;
  readonly services: readonly ModelService[];
  readonly formats: Readonly<Record<ApiFormat, string>>;
  readonly settingsFile: string;
}

const KEY_HINT_MINIMUM_LENGTH = 8;
const KEY_HINT_VISIBLE_CHARACTERS = 4;

function keyHintOf(apiKey: string | undefined): string | null {
  if (!apiKey) return null;
  return apiKey.length >= KEY_HINT_MINIMUM_LENGTH ? `…${apiKey.slice(-KEY_HINT_VISIBLE_CHARACTERS)}` : "set";
}

function overridingLayers(layers: EnvironmentLayers, slot: ModelSlot): EnvSource[] {
  const sources = SLOT_FIELDS.map((field) => sourceOf(layers, `${SLOT_PREFIX[slot]}${field}`));
  return [...new Set(sources.filter((source): source is EnvSource => source !== undefined && source !== "llm.env"))];
}

function viewOfSlot(layers: EnvironmentLayers, slot: ModelSlot, resolved: ResolvedSlot): ModelSlotView {
  return {
    service: resolved.service.id, format: resolved.format, baseUrl: resolved.baseUrl, model: resolved.model,
    keyConfigured: !!resolved.apiKey, keyHint: keyHintOf(resolved.apiKey), keySource: resolved.keySource ?? null,
    trainingPolicy: resolved.trainingPolicy, trainingRiskAcknowledged: resolved.trainingRiskAcknowledged,
    overriddenBy: overridingLayers(layers, slot), contextWindow: resolved.contextWindow, contextWindowSource: resolved.contextWindowSource,
    ...(resolved.acceptsImages !== undefined ? { acceptsImages: resolved.acceptsImages } : {}),
    ...(resolved.reasoningEffort ? { reasoningEffort: resolved.reasoningEffort } : {}),
  };
}

function slotViewOf(layers: EnvironmentLayers, slot: ModelSlot): ModelSlotView | null {
  const resolved = resolveSlot(layers, slot);
  return resolved ? viewOfSlot(layers, slot, resolved) : null;
}

/** The settings view of both slots; a slot that names no known service is null. */
export function modelSettingsView(layers: EnvironmentLayers, settingsFile: string): ModelSettingsView {
  return { slots: { primary: slotViewOf(layers, "primary"), fallback: slotViewOf(layers, "fallback") }, services: MODEL_SERVICES, formats: API_FORMATS, settingsFile };
}
