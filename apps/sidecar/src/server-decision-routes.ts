// The decision-model routes behind the session token: the secret-free state, set or clear, a live test, and a one-time link that opens the key-entry page.
import { object, optional } from "@extynt/decode";
import { applyChange, decisionChange, savedReply, providerDecoder, type DecisionChange } from "./decision-settings-apply.js";
import { keyLinksFor } from "./decision-link.js";
import { issueMessage } from "./decision-messages.js";
import type { DecisionProvider } from "./decision-providers.js";
import type { DecisionSettings } from "./decision-settings-service.js";
import type { SidecarState } from "./server-state.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { jsonBody, type BodySpec, type Refusal } from "./server-route-body.js";
import { bodyRoute, ok, refuse, route, type MountedRoute, type RouteGuard } from "./server-route-table.js";
import { tolerantBody } from "./server-tolerant-body.js";
import { uiEventsFor } from "./ui-events.js";
import { translatorOf } from "./ui-language.js";

const MAX_CHANGE_BYTES = 16_000;
const providerOnly = object({ provider: optional(providerDecoder) });

function unavailable(deps: HttpRoutesDeps): Refusal {
  return { status: 404, code: "SETTINGS_UNAVAILABLE", message: translatorOf(deps.state)("failure.settings.unavailable") };
}

const needsDecisionSettings: RouteGuard = (deps) => (deps.state.options.decisionSettings ? null : unavailable(deps));

function changeBody(deps: HttpRoutesDeps): BodySpec<DecisionChange> {
  const t = translatorOf(deps.state);
  const badJson = { status: 400, code: "INVALID_JSON", message: t("failure.settings.invalidJson") };
  return { ...jsonBody(decisionChange, MAX_CHANGE_BYTES, { status: 422, code: "INVALID_DECISION_SETTINGS", message: t("failure.settings.notUnderstood") }, { tooLarge: badJson, notJson: badJson }), explainInvalid: true };
}

function withSettings<Reply>(deps: HttpRoutesDeps, use: (settings: DecisionSettings) => Reply): Reply | ReturnType<typeof refuse> {
  const settings = deps.state.options.decisionSettings;
  return settings ? use(settings) : refuse(404, "SETTINGS_UNAVAILABLE", translatorOf(deps.state)("failure.settings.unavailable"));
}

const readDecision = route({
  method: "GET",
  path: "/v1/settings/decision",
  guard: needsDecisionSettings,
  handle: ({ deps }) => withSettings(deps, (settings) => ok({ ok: true, state: settings.state(), shadowed: [] })),
});

const changeDecision = bodyRoute({
  method: "POST",
  path: "/v1/settings/decision",
  guard: needsDecisionSettings,
  body: changeBody,
  handle: async ({ deps, body }) => {
    const settings = deps.state.options.decisionSettings;
    if (!settings) return refuse(404, "SETTINGS_UNAVAILABLE", translatorOf(deps.state)("failure.settings.unavailable"));
    const outcome = await applyChange(settings, body);
    if ("issue" in outcome) return refuse(422, "INVALID_DECISION_SETTINGS", issueMessage(translatorOf(deps.state), outcome.issue, body.provider));
    if (outcome.applied !== null) uiEventsFor(deps.state).publish({ type: "decision", reason: "changed" });
    return ok(savedReply(settings, outcome));
  },
});

const testDecision = route({
  method: "POST",
  path: "/v1/settings/decision/test",
  guard: needsDecisionSettings,
  readsRequest: true,
  handle: async ({ deps, request }) => {
    const settings = deps.state.options.decisionSettings;
    const wanted = await tolerantBody(request, MAX_CHANGE_BYTES, providerOnly, {});
    if (!settings) return refuse(404, "SETTINGS_UNAVAILABLE", translatorOf(deps.state)("failure.settings.unavailable"));
    return ok({ ok: true, test: await settings.test(wanted.provider ?? null) });
  },
});

function linkUrl(state: SidecarState, token: string): string {
  return `http://127.0.0.1:${state.port ?? 0}/decision-key/${token}`;
}

/** Issues a one-time key-entry link and tells a connected panel to open its Decision model section. */
export function openKeyLink(state: SidecarState, provider: DecisionProvider | null): { readonly url: string; readonly expiresAt: string; readonly panelNotified: boolean } {
  const issued = keyLinksFor(state, () => state.now().getTime()).issue(provider);
  const hub = uiEventsFor(state);
  const panelNotified = hub.subscriberCount() > 0;
  hub.publish({ type: "decision", reason: "open" });
  return { url: linkUrl(state, issued.token), expiresAt: issued.expiresAt, panelNotified };
}

const linkDecision = route({
  method: "POST",
  path: "/v1/settings/decision/link",
  guard: needsDecisionSettings,
  readsRequest: true,
  handle: async ({ deps, request }) => {
    const wanted = await tolerantBody(request, MAX_CHANGE_BYTES, providerOnly, {});
    return ok({ ok: true, ...openKeyLink(deps.state, wanted.provider ?? null) });
  },
});

/** The token-protected decision-model routes. */
export const decisionRoutes: readonly MountedRoute[] = [readDecision, changeDecision, testDecision, linkDecision];
