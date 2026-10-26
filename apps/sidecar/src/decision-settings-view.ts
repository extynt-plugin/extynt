// The decision-model settings as the route and the key page show them: which models are set up, where each setting comes from and why an entry is unusable. Never a key, only whether one is set.
import { array, decodeJson } from "@extynt/decode";
import { decisionModelEntry, decisionModelSetup, type DecisionModelEntry, type DecisionModelSetup } from "@extynt/decide";
import { defaultBaseUrlOf, defaultModelOf, ENTRIES_VARIABLE, JEV_VARIABLES, type DecisionProvider } from "./decision-providers.js";
import { effectiveEnvironment, sourceOf, type EnvironmentLayers, type EnvSource } from "./llm-env-layers.js";

interface DecisionModelStatus {
  readonly provider: DecisionProvider;
  readonly id: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly keySet: boolean;
  readonly source: EnvSource | null;
  readonly usable: boolean;
  readonly reason: string | null;
}

/** The whole decision-model state: the models, the entries that were left out and whether the generic list is unreadable. */
export interface DecisionState {
  readonly configured: boolean;
  readonly models: ReadonlyArray<DecisionModelStatus>;
  readonly skipped: ReadonlyArray<string>;
  readonly listProblem: string | null;
  readonly llmEnvPath: string;
}

function jevStatus(environment: Readonly<Record<string, string | undefined>>, layers: EnvironmentLayers): ReadonlyArray<DecisionModelStatus> {
  if ((environment[JEV_VARIABLES.key] ?? "") === "") return [];
  return [{
    provider: "jev",
    id: "jev",
    model: environment[JEV_VARIABLES.model] ?? defaultModelOf("jev"),
    baseUrl: environment[JEV_VARIABLES.baseUrl] ?? defaultBaseUrlOf("jev"),
    keySet: true,
    source: sourceOf(layers, JEV_VARIABLES.key) ?? null,
    usable: true,
    reason: null,
  }];
}

function reasonOf(setup: DecisionModelSetup, id: string): string | null {
  const found = setup.skipped.find((line) => line.includes(`"${id}"`));
  return found === undefined ? null : found.replace(/^decision model ".*?" skipped: /, "");
}

function entryStatus(entry: DecisionModelEntry, setup: DecisionModelSetup, layers: EnvironmentLayers): DecisionModelStatus {
  const environment = effectiveEnvironment(layers);
  const keyVariable = entry.keyEnv ?? "";
  const usable = setup.models.some((model) => model.id === entry.id);
  return {
    provider: entry.dialect,
    id: entry.id,
    model: entry.model,
    baseUrl: entry.dialect === "cloudflare" ? "" : entry.baseUrl ?? defaultBaseUrlOf(entry.dialect),
    keySet: keyVariable !== "" && (environment[keyVariable] ?? "") !== "",
    source: sourceOf(layers, ENTRIES_VARIABLE) ?? null,
    usable,
    reason: usable ? null : reasonOf(setup, entry.id),
  };
}

function listedEntries(text: string | undefined): { readonly entries: ReadonlyArray<DecisionModelEntry>; readonly problem: string | null } {
  if (text === undefined || text.trim() === "") return { entries: [], problem: null };
  const parsed = decodeJson(text, array(decisionModelEntry));
  return parsed.ok ? { entries: parsed.value, problem: null } : { entries: [], problem: parsed.error.message };
}

/** The decision-model state of the layered settings now; `llmEnvPath` is only the display path of llm.env. */
export function decisionStateOf(layers: EnvironmentLayers, llmEnvPath: string): DecisionState {
  const environment = effectiveEnvironment(layers);
  const setup = decisionModelSetup(environment, globalThis.fetch);
  const listed = listedEntries(environment[ENTRIES_VARIABLE]);
  const generic = listed.entries.map((entry) => entryStatus(entry, setup, layers));
  const models = [...jevStatus(environment, layers), ...generic];
  return { configured: setup.models.length > 0, models, skipped: setup.skipped, listProblem: listed.problem, llmEnvPath };
}
