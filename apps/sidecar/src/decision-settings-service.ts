// The decision-model settings store: reads the layered settings, writes llm.env only, reports a setting that a higher layer overrides, and tests a model. Keys go in and are never returned.
import { decisionModelSetup, type FailureReason } from "@extynt/decide";
import { probeDecisionModel, type DecisionProbe } from "./decision-probe.js";
import { clearDecision, setDecision, type DecisionIssue, type DecisionSet, type DecisionWrite } from "./decision-settings-write.js";
import { decisionStateOf, type DecisionState } from "./decision-settings-view.js";
import type { DecisionProvider } from "./decision-providers.js";
import { loadLlmEnvFile, writeLlmEnvFile } from "./llm-env-file.js";
import { effectiveEnvironment, loadEnvironmentLayers, sourceOf, type EnvironmentSources, type EnvSource } from "./llm-env-layers.js";

const SECRET_NAME = /KEY|TOKEN|SECRET/;

/** A setting that was written to llm.env but is overridden by a higher layer, so the write does not take effect. */
export interface DecisionShadow {
  readonly variable: string;
  readonly source: EnvSource;
}

/** The outcome of a change: the state afterwards and the settings it could not win, or the issue that stopped it. */
export type DecisionApplied =
  | { readonly ok: true; readonly state: DecisionState; readonly shadowed: ReadonlyArray<DecisionShadow> }
  | { readonly ok: false; readonly issue: DecisionIssue };

/** The outcome of a test: the probe of the model, or that no such model is set up. */
export type DecisionTest = (DecisionProbe | { readonly ok: false; readonly reason: "not-set-up"; readonly code: null }) & { readonly provider: DecisionProvider | null };

type DecisionTried =
  | { readonly ok: true; readonly applied: Extract<DecisionApplied, { readonly ok: true }>; readonly ms: number }
  | { readonly ok: false; readonly issue: DecisionIssue }
  | { readonly ok: false; readonly reason: string; readonly code: FailureReason | null };

/** The store: the state now, a change, a tested change, a removal and a live test. */
export interface DecisionSettings {
  state(): DecisionState;
  save(update: DecisionSet): DecisionApplied;
  saveTested(update: DecisionSet): Promise<DecisionTried>;
  remove(provider: DecisionProvider): DecisionApplied;
  test(provider: DecisionProvider | null): Promise<DecisionTest>;
}

interface DecisionSettingsOptions {
  readonly sources: EnvironmentSources;
  readonly displayPath: string;
  readonly fetch?: typeof globalThis.fetch;
}

function shadowsOf(sources: EnvironmentSources, touched: ReadonlyArray<string>): ReadonlyArray<DecisionShadow> {
  const layers = loadEnvironmentLayers(sources);
  return touched.flatMap((variable) => {
    const source = sourceOf(layers, variable);
    return source === "environment" || source === ".env" ? [{ variable, source }] : [];
  });
}

function persisted(options: DecisionSettingsOptions, written: DecisionWrite, state: () => DecisionState): DecisionApplied {
  if (!written.ok) return written;
  writeLlmEnvFile(options.sources.filePath, written.values);
  return { ok: true, state: state(), shadowed: shadowsOf(options.sources, written.touched) };
}

async function probeIn(environment: Readonly<Record<string, string | undefined>>, provider: DecisionProvider | null, httpFetch: typeof globalThis.fetch): Promise<DecisionProbe | { readonly ok: false; readonly reason: "not-set-up"; readonly code: null }> {
  const models = decisionModelSetup(environment, httpFetch).models;
  const model = provider === null ? models[0] : models.find((candidate) => candidate.id === provider);
  if (model === undefined) return { ok: false, reason: "not-set-up", code: null };
  const secrets = Object.entries(environment).flatMap(([name, text]) => (text !== undefined && SECRET_NAME.test(name) ? [text] : []));
  return probeDecisionModel(model, secrets);
}

/** Creates the store over llm.env, the optional .env and the process environment. */
export function createDecisionSettings(options: DecisionSettingsOptions): DecisionSettings {
  const httpFetch = options.fetch ?? globalThis.fetch;
  const layers = () => loadEnvironmentLayers(options.sources);
  const state = () => decisionStateOf(layers(), options.displayPath);
  return {
    state,
    save: (update) => persisted(options, setDecision(loadLlmEnvFile(options.sources.filePath), update, effectiveEnvironment(layers())), state),
    remove: (provider) => persisted(options, clearDecision(loadLlmEnvFile(options.sources.filePath), provider), state),
    saveTested: async (update) => {
      const written = setDecision(loadLlmEnvFile(options.sources.filePath), update, effectiveEnvironment(layers()));
      if (!written.ok) return written;
      const probe = await probeIn(effectiveEnvironment({ ...layers(), file: written.values }), update.provider, httpFetch);
      if (!probe.ok) return { ok: false, reason: probe.reason, code: probe.code };
      const applied = persisted(options, written, state);
      return applied.ok ? { ok: true, applied, ms: probe.ms } : applied;
    },
    test: async (provider) => ({ ...(await probeIn(effectiveEnvironment(layers()), provider, httpFetch)), provider }),
  };
}
