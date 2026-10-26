// The generic decision-model entries of EXTYNT_DECISION_MODELS: one decoder per dialect, and what each builds from the environment.
import { boolean, number, object, optional, string, taggedUnion, literal } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { cloudflareDecisionModel, CLOUDFLARE_KEY_VARIABLE } from "./cloudflare.js";
import type { HttpFetch } from "./http.js";
import { OPENAI_BASE_URL, OPENAI_KEY_VARIABLE, bandsOfEntry, openAiDecisionModel } from "./openai.js";
import type { DecisionModel } from "./port.js";
import { addressProblem, isLoopback } from "./url-rules.js";
import { systemOneDecisionModel } from "./system-one.js";

/** The environment an entry reads its key from. */
export type Environment = Readonly<Record<string, string | undefined>>;

const text = string({ nonEmpty: true });

/** The decoder of one list entry: the dialect decides which fields it holds. */
export const decisionModelEntry = taggedUnion("dialect", {
  systemone: object({ dialect: literal("systemone"), id: text, baseUrl: text, model: text, keyEnv: optional(text), threshold: optional(number({ min: 0, max: 1 })), calibrated: optional(boolean()) }),
  openai: object({ dialect: literal("openai"), id: text, model: text, baseUrl: optional(text), keyEnv: optional(text), threshold: optional(number({ min: 0, max: 1 })), calibrated: optional(boolean()), acceptsImages: optional(boolean()) }),
  cloudflare: object({ dialect: literal("cloudflare"), id: text, accountId: text, model: text, keyEnv: optional(text), gateway: optional(text) }),
});

/** One entry of the list, as the dialect declares it. */
export type DecisionModelEntry = Infer<typeof decisionModelEntry>;

type Entry = DecisionModelEntry;

type EntryOutcome =
  | { readonly ok: true; readonly model: DecisionModel }
  | { readonly ok: false; readonly reason: string };

function skipped(id: string, reason: string): EntryOutcome {
  return { ok: false, reason: `decision model "${id}" skipped: ${reason}` };
}

function keyOf(environment: Environment, variable: string): string | undefined {
  const key = environment[variable];
  return key === undefined || key === "" ? undefined : key;
}

function systemOne(config: Extract<Entry, { readonly dialect: "systemone" }>, environment: Environment, httpFetch: HttpFetch): EntryOutcome {
  const problem = addressProblem(config.baseUrl);
  if (problem !== null) return skipped(config.id, problem);
  const apiKey = config.keyEnv === undefined ? undefined : environment[config.keyEnv];
  const calibrated = config.calibrated ?? false;
  return {
    ok: true,
    model: systemOneDecisionModel({
      id: config.id, baseUrl: config.baseUrl, model: config.model, threshold: config.threshold ?? 0.7, calibrated, bands: bandsOfEntry(calibrated, config.threshold), fetch: httpFetch,
      ...(apiKey === undefined ? {} : { apiKey }),
    }),
  };
}

function openAi(config: Extract<Entry, { readonly dialect: "openai" }>, environment: Environment, httpFetch: HttpFetch): EntryOutcome {
  const baseUrl = config.baseUrl ?? OPENAI_BASE_URL;
  const problem = addressProblem(baseUrl);
  if (problem !== null) return skipped(config.id, problem);
  const variable = config.keyEnv ?? OPENAI_KEY_VARIABLE;
  const apiKey = keyOf(environment, variable);
  if (apiKey === undefined && !isLoopback(baseUrl)) return skipped(config.id, `${variable} is not set`);
  return { ok: true, model: openAiModel(config, baseUrl, apiKey, httpFetch) };
}

function openAiModel(config: Extract<Entry, { readonly dialect: "openai" }>, baseUrl: string, apiKey: string | undefined, httpFetch: HttpFetch): DecisionModel {
  return openAiDecisionModel({
    id: config.id, model: config.model, baseUrl, fetch: httpFetch,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(config.threshold === undefined ? {} : { threshold: config.threshold }),
    ...(config.calibrated === undefined ? {} : { calibrated: config.calibrated }),
    ...(config.acceptsImages === undefined ? {} : { acceptsImages: config.acceptsImages }),
  });
}

function cloudflare(config: Extract<Entry, { readonly dialect: "cloudflare" }>, environment: Environment, httpFetch: HttpFetch): EntryOutcome {
  const variable = config.keyEnv ?? CLOUDFLARE_KEY_VARIABLE;
  const apiKey = keyOf(environment, variable);
  if (apiKey === undefined) return skipped(config.id, `${variable} is not set`);
  return {
    ok: true,
    model: cloudflareDecisionModel({
      id: config.id, accountId: config.accountId, model: config.model, apiKey, fetch: httpFetch,
      ...(config.gateway === undefined ? {} : { gateway: config.gateway }),
    }),
  };
}

function build(config: Entry, environment: Environment, httpFetch: HttpFetch): EntryOutcome {
  switch (config.dialect) {
    case "systemone":
      return systemOne(config, environment, httpFetch);
    case "openai":
      return openAi(config, environment, httpFetch);
    case "cloudflare":
      return cloudflare(config, environment, httpFetch);
  }
}

/** One decoded entry as a model, or the reason it was left out; a bad entry never costs the others. */
export function modelOfEntry(config: DecisionModelEntry, environment: Environment, httpFetch: HttpFetch): EntryOutcome {
  return build(config, environment, httpFetch);
}

/** The JSON text of a list of entries, written from their typed fields. */
export function encodeDecisionModelEntries(entries: ReadonlyArray<DecisionModelEntry>): string {
  return JSON.stringify(entries.map((config) => ({ ...config })));
}
