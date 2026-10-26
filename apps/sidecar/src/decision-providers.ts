// The decision-model providers the settings can set up, and the llm.env variables each one lives in.
import { DECISION_PROVIDERS, type DecisionProvider } from "@extynt/ui-text";
import { JEV_BASE_URL, JEV_DEFAULT_MODEL, OPENAI_BASE_URL, TYPESAFE_KEY_VARIABLE } from "@extynt/decide";

/** The providers and the type of one of them, defined with the fields each asks for so the panel and the key page agree. */
export { DECISION_PROVIDERS };
export type { DecisionProvider };

/** The variable that holds the list of generic decision-model entries. */
export const ENTRIES_VARIABLE = "EXTYNT_DECISION_MODELS";

/** The three variables of the Jev shorthand. */
export const JEV_VARIABLES = { key: TYPESAFE_KEY_VARIABLE, baseUrl: "TYPESAFE_BASE_URL", model: "TYPESAFE_MODEL" } as const;

/** The variable a key typed into the settings is stored in. */
export function keyVariableOf(provider: DecisionProvider): string {
  return provider === "jev" ? JEV_VARIABLES.key : `EXTYNT_DECISION_${provider.toUpperCase()}_KEY`;
}

/** The address a provider talks to when none is given; empty for a provider that always needs one. */
export function defaultBaseUrlOf(provider: DecisionProvider): string {
  if (provider === "jev") return JEV_BASE_URL;
  return provider === "openai" ? OPENAI_BASE_URL : "";
}

/** The model a provider uses when none is given; empty for a provider that always needs one. */
export function defaultModelOf(provider: DecisionProvider): string {
  return provider === "jev" ? JEV_DEFAULT_MODEL : "";
}

/** The name the settings and the key page give a provider, as a catalogue key. */
export const PROVIDER_LABEL_KEYS = {
  jev: "settings.decision.provider.jev",
  openai: "settings.decision.provider.openai",
  cloudflare: "settings.decision.provider.cloudflare",
  systemone: "settings.decision.provider.systemone",
} as const;
