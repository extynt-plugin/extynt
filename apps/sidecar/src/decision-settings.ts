// The decision-model setting: the models configured by the layered environment (TYPESAFE_API_KEY in llm.env, .env or the process environment, or EXTYNT_DECISION_MODELS); with no key the list is empty and every decision stays deterministic.
import { decisionModelsFromEnvironment, type DecisionModel } from "@extynt/decide";
import { effectiveEnvironment, loadEnvironmentLayers, type EnvironmentSources } from "./llm-env-layers.js";

/** The decision models of the settings as they are now: read afresh on each call, and rebuilt only when a setting changed so a model keeps its backoff between calls. */
export function decisionModelsOf(sources: EnvironmentSources, httpFetch: typeof globalThis.fetch = globalThis.fetch): () => ReadonlyArray<DecisionModel> {
  let built: { readonly signature: string; readonly models: ReadonlyArray<DecisionModel> } | undefined;
  return () => {
    const environment = effectiveEnvironment(loadEnvironmentLayers(sources));
    const signature = JSON.stringify(Object.entries(environment).sort());
    if (built?.signature !== signature) built = { signature, models: decisionModelsFromEnvironment(environment, httpFetch) };
    return built.models;
  };
}
