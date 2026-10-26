// The model settings the panel reads and saves: both slots as configured, the providers actually running, and what saving a change does.
import type { ChatProvider } from "@extynt/llm";


import type { ModelSettingsStore, ModelSettingsUpdates, ModelSettingsView } from "./llm-config.js";
import { reportedCapabilities, type ReportedCapabilities } from "./server-model-efforts.js";
import { translatorOf } from "./ui-language.js";
import { ok, refuse, type JsonAnswer, type RefusalAnswer } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";

type ProviderState = Pick<SidecarState, "chatProvider" | "fallbackChatProvider" | "modelKeyVariables" | "modelSettingsErrors" | "options" | "hostFacts" | "now">;
type LoggedState = Pick<SidecarState, "chatProvider" | "fallbackChatProvider" | "now" | "options">;

interface ActiveModel extends ReportedCapabilities {
  readonly displayName: string;
  readonly model: string;
  readonly keyConfigured: boolean;
  readonly contextWindow: number | null;
  readonly reasoningEffort: string | null;
}

type ModelSettingsBody = ModelSettingsView & {
  readonly ok: true;
  readonly active: { readonly primary: ActiveModel | null; readonly fallback: ActiveModel | null };
  readonly errors: readonly string[];
};

function activeModel(provider: ChatProvider | undefined): ActiveModel | null {
  if (!provider) return null;
  const { displayName, keyConfigured } = provider.displayMetadata;
  return { displayName, model: provider.model, keyConfigured, contextWindow: provider.config.contextWindow ?? null, reasoningEffort: provider.config.reasoningEffort ?? null, ...reportedCapabilities(provider) };
}

/** The settings view with the providers that are running. */
export function modelSettingsBody(state: ProviderState, settings: ModelSettingsStore): ModelSettingsBody {
  return { ok: true, ...settings.view(), active: { primary: activeModel(state.chatProvider), fallback: activeModel(state.fallbackChatProvider) }, errors: state.modelSettingsErrors };
}

/** Rebuilds the providers from the saved settings; a sidecar started without settings keeps the providers it was given. */
export function reloadModelProviders(state: ProviderState): void {
  const settings = state.options.modelSettings;
  if (!settings) return;
  const built = settings.providers(translatorOf(state));
  state.chatProvider = built.primary;
  state.fallbackChatProvider = built.fallback;
  state.modelKeyVariables = built.keyVariables;
  state.modelSettingsErrors = [...built.errors];
}

function logModelSettings(state: LoggedState): void {
  if (state.options.quietAgentLog) return;
  const line = { at: state.now().toISOString(), event: "model.settings", primary: state.chatProvider?.displayMetadata.displayName ?? null, fallback: state.fallbackChatProvider?.displayMetadata.displayName ?? null };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** Saves the changes, then rebuilds the providers so the next turn uses them. */
export function saveModelSettings(state: ProviderState & LoggedState, settings: ModelSettingsStore, updates: ModelSettingsUpdates): JsonAnswer<ModelSettingsBody> | RefusalAnswer {
  const saved = settings.save(updates, translatorOf(state));
  if (!saved.ok) return refuse(422, "INVALID_SETTINGS", saved.error);
  reloadModelProviders(state);
  logModelSettings(state);
  return ok(modelSettingsBody(state, settings));
}
