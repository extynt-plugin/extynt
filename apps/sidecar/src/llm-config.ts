// The model settings store: llm.env plus a development .env and the process environment, resolved into providers, a settings view and saved updates.
import type { ChatProvider, ModelCapabilities } from "@extynt/llm";
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_FAILURE_TEXT } from "./failure-english.js";
import { loadEnvironmentLayers, effectiveEnvironment, type EnvironmentLayers, type EnvironmentSources } from "./llm-env-layers.js";
import { loadLlmEnvFile, writeLlmEnvFile } from "./llm-env-file.js";
import { MODEL_SLOTS, SLOT_PREFIX, findModelService, type ModelSlot } from "./llm-model-services.js";
import { modelSettingsView, type ModelSettingsView } from "./llm-settings-view.js";
import { capabilityKey, createSlotProvider, guardedSlot, type BuiltProvider } from "./llm-slot-provider.js";
import { resolveSlot, type ResolvedSlot } from "./llm-slot-resolution.js";
import { applySlotUpdates, type ModelSettingsUpdates } from "./llm-slot-updates.js";

export { MODEL_SERVICES } from "./llm-model-services.js";
export type { ModelService, ModelSlot } from "./llm-model-services.js";
export { modelSettingsUpdates } from "./llm-slot-updates.js";
export type { ModelSettingsUpdates } from "./llm-slot-updates.js";
export type { ModelSettingsView } from "./llm-settings-view.js";
export type { ResolvedSlot } from "./llm-slot-resolution.js";

interface ProviderSet {
  readonly primary?: ChatProvider;
  readonly fallback?: ChatProvider;
  readonly keyVariables: Partial<Record<ModelSlot, string>>;
  readonly errors: readonly string[];
}

/** Whether a settings save was written, or why it was refused. */
export type SaveOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * The model settings the sidecar runs on. `resolve` returns one slot fully resolved, key included, for server-side calls
 * such as model discovery: the key is used in-process, and routes return model ids only. `resolveForService` resolves a slot
 * as if it named another service, using only that service's own saved key and defaults.
 */
export interface ModelSettingsStore {
  view(): ModelSettingsView;
  providers(t?: Translate): ProviderSet;
  resolve(slot: ModelSlot): ResolvedSlot | undefined;
  resolveForService(slot: ModelSlot, serviceId: string): ResolvedSlot | undefined;
  save(updates: ModelSettingsUpdates, t?: Translate): SaveOutcome;
}

interface ModelSettingsStoreOptions extends EnvironmentSources {
  readonly displayPath?: string;
  readonly initialLayers?: EnvironmentLayers;
  readonly discoverCapabilities?: boolean;
}

const SERVICE_PREVIEW_CLEARED_FIELDS = ["API_KEY", "MODEL", "BASE_URL", "FORMAT", "CONTEXT_WINDOW", "ALLOW_TRAINING_RISK"] as const;

function withoutNames<Text>(layer: Readonly<Record<string, Text>>, names: ReadonlySet<string>): Record<string, Text> {
  return Object.fromEntries(Object.entries(layer).filter(([name]) => !names.has(name)));
}

class LayeredModelSettingsStore implements ModelSettingsStore {
  private initialLayers: EnvironmentLayers | undefined;
  private readonly learned = new Map<string, ModelCapabilities>();
  private readonly builtKeys = new Map<ModelSlot, string>();

  public constructor(private readonly options: ModelSettingsStoreOptions) {
    this.initialLayers = options.initialLayers;
  }

  public view(): ModelSettingsView {
    return modelSettingsView(this.layers(), this.options.displayPath ?? this.options.filePath);
  }

  public providers(t: Translate = ENGLISH_FAILURE_TEXT): ProviderSet {
    const layers = this.layers();
    const primary = this.providerOf(layers, "primary", t), fallback = this.providerOf(layers, "fallback", t);
    return {
      ...(primary.provider ? { primary: primary.provider } : {}),
      ...(primary.provider && fallback.provider ? { fallback: fallback.provider } : {}),
      keyVariables: { ...primary.keyVariables, ...fallback.keyVariables },
      errors: [...primary.errors, ...fallback.errors],
    };
  }

  public resolve(slot: ModelSlot): ResolvedSlot | undefined {
    return resolveSlot(this.layers(), slot);
  }

  public resolveForService(slot: ModelSlot, serviceId: string): ResolvedSlot | undefined {
    if (!findModelService(serviceId)) return undefined;
    const prefix = SLOT_PREFIX[slot], layers = this.layers();
    const cleared = new Set(SERVICE_PREVIEW_CLEARED_FIELDS.map((field) => `${prefix}${field}`));
    const process = { ...withoutNames(layers.process, cleared), [`${prefix}PROVIDER`]: serviceId };
    return resolveSlot({ file: withoutNames(layers.file, cleared), dotEnv: withoutNames(layers.dotEnv, cleared), process }, slot);
  }

  public save(updates: ModelSettingsUpdates, t: Translate = ENGLISH_FAILURE_TEXT): SaveOutcome {
    const applied = applySlotUpdates(loadLlmEnvFile(this.options.filePath), updates, t);
    if ("error" in applied) return { ok: false, error: applied.error };
    const error = this.firstBuildError({ ...this.layers(), file: applied.values }, t);
    if (error) return { ok: false, error };
    writeLlmEnvFile(this.options.filePath, applied.values);
    return { ok: true };
  }

  private layers(): EnvironmentLayers {
    const current = this.initialLayers ?? loadEnvironmentLayers(this.options);
    this.initialLayers = undefined;
    return current;
  }

  private firstBuildError(layers: EnvironmentLayers, t: Translate): string | undefined {
    for (const slot of MODEL_SLOTS) {
      const { error } = createSlotProvider(resolveSlot(layers, slot), undefined, t);
      if (error) return slot === "primary" ? error : t("failure.settings.fallbackModel", { error });
    }
    return undefined;
  }

  private build(resolved: ResolvedSlot | undefined, slot: ModelSlot, t: Translate): BuiltProvider {
    const key = resolved ? capabilityKey(resolved) : "";
    const built = createSlotProvider(resolved, this.learned.get(key), t);
    built.provider?.capabilities?.subscribe((capabilities) => {
      this.learned.set(key, capabilities);
    });
    if (this.wantsDiscovery(slot, key)) void built.provider?.discoverCapabilities?.();
    this.builtKeys.set(slot, key);
    return built;
  }

  private wantsDiscovery(slot: ModelSlot, key: string): boolean {
    const moved = this.builtKeys.get(slot) !== key;
    return this.options.discoverCapabilities === true && (!this.learned.has(key) || moved);
  }

  private providerOf(layers: EnvironmentLayers, slot: ModelSlot, t: Translate): { provider?: ChatProvider; keyVariables: Partial<Record<ModelSlot, string>>; errors: string[] } {
    const resolved = resolveSlot(layers, slot);
    const requested = effectiveEnvironment(layers)[`${SLOT_PREFIX[slot]}PROVIDER`];
    const name = t(slot === "primary" ? "failure.settings.slotPrimary" : "failure.settings.slotFallback");
    const unknownService = requested && !resolved ? [t("failure.settings.slotUnknownService", { slot: name, service: requested })] : [];
    const guarded = guardedSlot(resolved, this.build(resolved, slot, t), t);
    const errors = [...unknownService, ...guarded.errors.map((message) => t("failure.settings.slotError", { slot: name, message }))];
    const keyVariable = guarded.provider ? resolved?.keyVariable : undefined;
    return { ...(guarded.provider ? { provider: guarded.provider } : {}), keyVariables: keyVariable ? { [slot]: keyVariable } : {}, errors };
  }
}

/** A store over the given files and environment, reading them afresh on every call (`initialLayers` serves only the first). */
export function createModelSettingsStore(options: ModelSettingsStoreOptions): ModelSettingsStore {
  return new LayeredModelSettingsStore(options);
}
