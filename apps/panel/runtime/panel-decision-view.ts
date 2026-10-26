/** What the Decision model section says: the one status line and the provider names, decided from the state alone so a test can check them without a page. */
import { decisionFailureText, providerAsksFor, type DecisionField, type Translate, type UiKey } from "@extynt/ui-text";
import type { DecisionModelView, DecisionStateView, DecisionTestView } from "./panel-decision-wire.js";

/** The providers the panel offers, in order. */
export const PANEL_PROVIDERS = ["jev", "openai", "cloudflare"] as const;

/** The name of a provider, as a catalogue key. */
export const PROVIDER_KEYS = {
  jev: "settings.decision.provider.jev",
  openai: "settings.decision.provider.openai",
  cloudflare: "settings.decision.provider.cloudflare",
  systemone: "settings.decision.provider.systemone",
} as const satisfies Record<DecisionModelView["provider"], UiKey>;

/** The advanced inputs, each with the field it carries and the provider-independent name the sidecar knows it by. */
export const ADVANCED_FIELDS = [
  { input: "decision-model", row: "decision-model-field", field: "model" },
  { input: "decision-base-url", row: "decision-base-url-field", field: "baseUrl" },
  { input: "decision-account-id", row: "decision-account-id-field", field: "accountId" },
] as const satisfies ReadonlyArray<{ readonly input: string; readonly row: string; readonly field: DecisionField }>;

/** The advanced fields a provider shows, in order. */
export function shownFields(provider: DecisionModelView["provider"]): ReadonlyArray<DecisionField> {
  return ADVANCED_FIELDS.map((row) => row.field).filter((field) => providerAsksFor(provider, field));
}

/** Whether Advanced should be open: a shown field holds a value, or the last attempt failed. */
export function advancedOpens(provider: DecisionModelView["provider"], typed: Readonly<Record<DecisionField, string>>, failed: boolean): boolean {
  return failed || shownFields(provider).some((field) => typed[field] !== "");
}

/** The model the status line is about: the first one that works, else the first one set up. */
export function headlineModel(state: DecisionStateView): DecisionModelView | undefined {
  return state.models.find((model) => model.usable) ?? state.models[0];
}

function statusModel(state: DecisionStateView, chosen: DecisionModelView["provider"] | undefined): DecisionModelView | undefined {
  return chosen === undefined ? headlineModel(state) : state.models.find((model) => model.provider === chosen);
}

/** The status line, with whether it is good news; it belongs to the chosen provider when one is given. */
export function statusLine(state: DecisionStateView, say: Translate, chosen?: DecisionModelView["provider"]): { readonly ok: boolean; readonly text: string } {
  const model = statusModel(state, chosen);
  if (model === undefined) {
    if (chosen !== undefined && state.models.length > 0) return { ok: false, text: say("settings.decision.error.notSetUp", { provider: say(PROVIDER_KEYS[chosen]) }) };
    return { ok: false, text: say("settings.decision.status.none") };
  }
  const provider = say(PROVIDER_KEYS[model.provider]);
  if (model.usable) return { ok: true, text: say("settings.decision.status.connected", { provider }) };
  return { ok: false, text: say("settings.decision.status.unusable", { provider, reason: model.reason }) };
}

/** The line a live test adds: how fast it answered, or the amber receipt "provider · test failed · reason". */
export function testLine(test: DecisionTestView, provider: DecisionModelView["provider"], say: Translate): { readonly ok: boolean; readonly text: string } {
  if (test.ok) return { ok: true, text: say("settings.decision.test.ok", { ms: test.ms }) };
  const reason = test.reason === "not-set-up" ? say("settings.decision.error.notSetUp", { provider: say(PROVIDER_KEYS[provider]) }) : decisionFailureText(say, test.code, test.reason);
  return { ok: false, text: [say(PROVIDER_KEYS[provider]), say("settings.decision.page.testFailed"), reason].join(" · ") };
}

/** The one receipt line the section shows: the status with a passed test folded in, a failed test replacing it, and how to tone it. */
export function receiptLine(state: DecisionStateView, extra: ReadonlyArray<{ readonly ok: boolean; readonly text: string }>, say: Translate, chosen?: DecisionModelView["provider"]): { readonly tone: "good" | "warn" | "muted"; readonly text: string } {
  const failed = extra.find((line) => !line.ok);
  if (failed) return { tone: "warn", text: failed.text };
  const head = statusLine(state, say, chosen);
  const tone = head.ok ? "good" : statusModel(state, chosen) === undefined ? "muted" : "warn";
  return { tone, text: [head.text, ...extra.map((line) => line.text)].join(" · ") };
}
