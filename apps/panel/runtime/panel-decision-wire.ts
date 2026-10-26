/** What the sidecar answers on the decision-model routes, as tolerant decoders: a field it leaves out reads as empty and a bad list entry is dropped. */
import type { Infer } from "@extynt/decode";
import { DECISION_FAILURE_CODES } from "@extynt/ui-text";
import { boolean, fallback, literal, number, object, optional, skippingInvalid, string } from "@extynt/decode";

const modelDecoder = object({
  provider: literal("jev", "openai", "cloudflare", "systemone"),
  id: fallback(string(), ""),
  model: fallback(string(), ""),
  baseUrl: fallback(string(), ""),
  keySet: fallback(literal(true), false),
  source: fallback(string(), ""),
  usable: fallback(literal(true), false),
  reason: fallback(string(), ""),
});

/** One decision model the sidecar has set up, never with its key. */
export type DecisionModelView = Infer<typeof modelDecoder>;

const stateDecoder = object({
  configured: fallback(literal(true), false),
  models: fallback(skippingInvalid(modelDecoder), []),
  skipped: fallback(skippingInvalid(string()), []),
  listProblem: fallback(string(), ""),
});

const shadowDecoder = object({ variable: string(), source: string() });

const testDecoder = object({ ok: boolean(), ms: fallback(number(), 0), reason: fallback(string(), ""), code: optional(literal(...DECISION_FAILURE_CODES)), provider: optional(literal("jev", "openai", "cloudflare", "systemone")) });

/** The outcome of a live test: whether the model answered, how fast, or why not. */
export type DecisionTestView = Infer<typeof testDecoder>;

/** The state of the decision-model settings. */
export type DecisionStateView = Infer<typeof stateDecoder>;

/** The answer to reading, saving, clearing or testing: the state, the settings a higher layer overrides and the test when one ran. */
export const decisionReplyDecoder = object({
  state: optional(stateDecoder),
  shadowed: fallback(skippingInvalid(shadowDecoder), []),
  test: optional(testDecoder),
  saved: optional(boolean()),
});

/** A decoded decision-model answer. */
export type DecisionReplyView = Infer<typeof decisionReplyDecoder>;
