// A decision-model request as the route, the key page and the tool all take it: one body shape, one way to apply it, and the panel told when the settings changed.
import { literal, object, optional, string, type Infer } from "@extynt/decode";
import { DECISION_PROVIDERS } from "./decision-providers.js";
import type { DecisionApplied, DecisionSettings, DecisionTest } from "./decision-settings-service.js";

/** The provider names as a decoder. */
export const providerDecoder = literal(...DECISION_PROVIDERS);

/** The body that sets or clears one provider. An empty text resets a setting to its default; `test` also runs the live test after a save. */
export const decisionChange = object({
  provider: providerDecoder,
  action: optional(literal("set", "clear")),
  apiKey: optional(string()),
  model: optional(string()),
  baseUrl: optional(string()),
  accountId: optional(string()),
  keyVariable: optional(string()),
  test: optional(literal(true, false)),
});

/** A decoded change request. */
export type DecisionChange = Infer<typeof decisionChange>;

interface DecisionSaved {
  readonly applied: Extract<DecisionApplied, { readonly ok: true }> | null;
  readonly test: DecisionTest | null;
}

type Refused = Extract<DecisionApplied, { readonly ok: false }>;

async function appliedTested(settings: DecisionSettings, change: DecisionChange): Promise<DecisionSaved | Refused> {
  const tried = await settings.saveTested(change);
  if (tried.ok) return { applied: tried.applied, test: { ok: true, ms: tried.ms, provider: change.provider } };
  if ("issue" in tried) return { ok: false, issue: tried.issue };
  return { applied: null, test: { ok: false, reason: tried.reason, code: tried.code, provider: change.provider } };
}

/** Applies the change. A refusal comes back as the applied result; a save with `test` set tests first and writes only if the test passes (`applied` is null when it did not). */
export async function applyChange(settings: DecisionSettings, change: DecisionChange): Promise<DecisionSaved | Refused> {
  if (change.action !== "clear" && change.test === true) return appliedTested(settings, change);
  const applied = change.action === "clear" ? settings.remove(change.provider) : settings.save(change);
  return applied.ok ? { applied, test: null } : applied;
}

/** The reply to a change: whether it was written, the state after, any shadowing variables, and the test when one ran. */
export function savedReply(settings: DecisionSettings, outcome: DecisionSaved) {
  const { applied, test } = outcome;
  return {
    ok: true,
    saved: applied !== null,
    state: applied ? applied.state : settings.state(),
    shadowed: applied ? applied.shadowed : [],
    ...(test === null ? {} : { test }),
  };
}
