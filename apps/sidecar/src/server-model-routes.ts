// The routes of the model settings: the saved slots, the catalogue of models a service offers, the effort levels of a model, and a connectivity check.
import { modelSettingsUpdates, type ModelSettingsUpdates } from "./llm-config.js";
import { catalogBody, modelCatalogReply, NO_CATALOG_BODY } from "./server-model-catalog.js";
import { modelEffortsReply } from "./server-model-efforts.js";
import { modelSettingsBody, saveModelSettings } from "./server-model-settings.js";
import { DEFAULT_MODEL_TEST, modelTestBody, modelTestReply } from "./server-model-test.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { jsonBody, type BodySpec, type Refusal } from "./server-route-body.js";
import { bodyRoute, ok, refuse, route, type MountedRoute, type RouteGuard } from "./server-route-table.js";
import { tolerantBody } from "./server-tolerant-body.js";
import { translatorOf } from "./ui-language.js";

const MAX_SETTINGS_BYTES = 16_000;
const MAX_CATALOG_BYTES = 16_000;
const MAX_TEST_BYTES = 4_000;

function refusalOf(refusal: Refusal): ReturnType<typeof refuse> {
  return refuse(refusal.status, refusal.code, refusal.message);
}

function noSettings(deps: HttpRoutesDeps): Refusal {
  return { status: 404, code: "SETTINGS_UNAVAILABLE", message: translatorOf(deps.state)("failure.settings.unavailable") };
}

const needsSettings: RouteGuard = (deps: HttpRoutesDeps) => (deps.state.options.modelSettings ? null : noSettings(deps));

function settingsBody(deps: HttpRoutesDeps): BodySpec<ModelSettingsUpdates> {
  const t = translatorOf(deps.state);
  const badJson = { status: 400, code: "INVALID_JSON", message: t("failure.settings.invalidJson") };
  return { ...jsonBody(modelSettingsUpdates, MAX_SETTINGS_BYTES, { status: 422, code: "INVALID_SETTINGS", message: t("failure.settings.notUnderstood") }, { tooLarge: badJson, notJson: badJson }), explainInvalid: true };
}

const readSettings = route({
  method: "GET",
  path: "/v1/settings/model",
  guard: needsSettings,
  handle: ({ deps }) => {
    const settings = deps.state.options.modelSettings;
    return settings ? ok(modelSettingsBody(deps.state, settings)) : refusalOf(noSettings(deps));
  },
});

const saveSettings = bodyRoute({
  method: "POST",
  path: "/v1/settings/model",
  guard: needsSettings,
  body: settingsBody,
  handle: ({ deps, body }) => {
    const settings = deps.state.options.modelSettings;
    return settings ? saveModelSettings(deps.state, settings, body) : refusalOf(noSettings(deps));
  },
});

const readCatalog = route({
  method: "GET",
  path: "/v1/settings/model/catalog",
  guard: needsSettings,
  handle: ({ deps, url }) => modelCatalogReply(deps.state, url.searchParams, NO_CATALOG_BODY),
});

const askCatalog = route({
  method: "POST",
  path: "/v1/settings/model/catalog",
  guard: needsSettings,
  readsRequest: true,
  handle: async ({ deps, request, url }) => modelCatalogReply(deps.state, url.searchParams, await tolerantBody(request, MAX_CATALOG_BYTES, catalogBody, NO_CATALOG_BODY)),
});

const readEfforts = route({
  method: "GET",
  path: "/v1/settings/model/efforts",
  handle: ({ deps, url }) => modelEffortsReply(deps.state, url.searchParams),
});

const testModel = route({
  method: "POST",
  path: "/v1/settings/model/test",
  readsRequest: true,
  handle: async ({ deps, request }) => modelTestReply(deps.state, await tolerantBody(request, MAX_TEST_BYTES, modelTestBody, DEFAULT_MODEL_TEST)),
});

/** The model settings, their catalogue, effort levels and connectivity check. */
export const modelRoutes: readonly MountedRoute[] = [readSettings, saveSettings, readCatalog, askCatalog, readEfforts, testModel];
