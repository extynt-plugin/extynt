// Reads the configured decision models from the environment: the TypeSafe shorthand plus a generic list of dialect entries.
import { env as processEnv } from "node:process";
import { array, decode, decodeJson, object, optional, string } from "@extynt/decode";
import { decisionModelEntry, modelOfEntry } from "./config-entries.js";
import type { Environment } from "./config-entries.js";
import type { HttpFetch } from "./http.js";
import { jevDecisionModel } from "./jev.js";
import type { DecisionModel } from "./port.js";

/** The environment variable that holds the TypeSafe key; with it set, the Jev model is configured. */
export const TYPESAFE_KEY_VARIABLE = "TYPESAFE_API_KEY";

/** The environment variable that holds a JSON list of decision-model entries. */
export const DECISION_MODELS_VARIABLE = "EXTYNT_DECISION_MODELS";

const typesafeVariables = object({
  TYPESAFE_API_KEY: optional(string({ nonEmpty: true })),
  TYPESAFE_BASE_URL: optional(string({ nonEmpty: true })),
  TYPESAFE_MODEL: optional(string({ nonEmpty: true })),
});

function jevFromEnvironment(environment: Environment, httpFetch: HttpFetch): ReadonlyArray<DecisionModel> {
  const variables = decode(typesafeVariables, environment);
  if (!variables.ok || variables.value.TYPESAFE_API_KEY === undefined) return [];
  const { TYPESAFE_API_KEY: apiKey, TYPESAFE_BASE_URL: baseUrl, TYPESAFE_MODEL: model } = variables.value;
  return [jevDecisionModel({ apiKey, fetch: httpFetch, ...(baseUrl === undefined ? {} : { baseUrl }), ...(model === undefined ? {} : { model }) })];
}

function entriesFromEnvironment(environment: Environment, httpFetch: HttpFetch): DecisionModelSetup {
  const text = environment[DECISION_MODELS_VARIABLE];
  if (text === undefined || text.trim() === "") return { models: [], skipped: [] };
  const parsed = decodeJson(text, array(decisionModelEntry));
  if (!parsed.ok) return { models: [], skipped: [`${DECISION_MODELS_VARIABLE} ignored: ${parsed.error.message}`] };
  const outcomes = parsed.value.map((config) => modelOfEntry(config, environment, httpFetch));
  return {
    models: outcomes.flatMap((outcome) => (outcome.ok ? [outcome.model] : [])),
    skipped: outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.reason])),
  };
}

/** The configured decision models, and a readable reason for every entry that was left out. */
export interface DecisionModelSetup {
  readonly models: ReadonlyArray<DecisionModel>;
  readonly skipped: ReadonlyArray<string>;
}

/** The decision models and the skipped entries: Jev first when its key is set, then each usable entry in order. */
export function decisionModelSetup(environment: Environment = processEnv, httpFetch: HttpFetch = fetch): DecisionModelSetup {
  const entries = entriesFromEnvironment(environment, httpFetch);
  return { models: [...jevFromEnvironment(environment, httpFetch), ...entries.models], skipped: entries.skipped };
}

/** The configured decision models, Jev first when its key is set; with nothing configured the list is empty and no request is ever made. */
export function decisionModelsFromEnvironment(environment: Environment = processEnv, httpFetch: HttpFetch = fetch): ReadonlyArray<DecisionModel> {
  return decisionModelSetup(environment, httpFetch).models;
}
