/** Reading and changing the model settings on the sidecar, and painting every surface that shows them once an answer lands. */
import { hooks } from "./panel-hooks.js";
import { renderModelSlot } from "./panel-model-form.js";
import { getModelSettings, setModelSettings } from "./panel-model-store.js";
import { renderModelState } from "./panel-model-summary.js";
import { modelChangeDecoder, modelSettingsDecoder } from "./panel-model-wire.js";
import type { ModelSettings } from "./panel-model-wire.js";
import { renderAttachment } from "./panel-attach.js";
import { t } from "./panel-language.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import { dispatch } from "./ui-state.js";

const SETTINGS_PATH = "/v1/settings/model";

/** The one thing a click in the picker changes: the model, the reasoning level, or the image setting (null hands the answer back to the model). */
export type ModelChoice =
  | { readonly model: string }
  | { readonly reasoningEffort: string }
  | { readonly acceptsImages: boolean | null };

/** Paints both provider forms and the summary from the settings last reported. */
export function showModelSettings(settings: ModelSettings): void {
  renderModelSlot("primary", settings.slots.primary);
  renderModelSlot("fallback", settings.slots.fallback);
  renderModelState();
}

/** Paints the Settings forms again in the current language, from the settings last reported; nothing is painted before any settings arrive. */
export function repaintModelSettings(): void {
  const settings = getModelSettings();
  if (settings) showModelSettings(settings);
}

function adoptModelSettings(settings: ModelSettings): void {
  setModelSettings(settings);
  dispatch({ type: "model-images", accepts: settings.active.primary?.acceptsImages === true });
  renderAttachment();
}

/** Asks the sidecar for the model settings and shows them; an unanswered or refused read leaves everything as it was. */
export function loadModelSettings(): void {
  const context = transportContext("GET", SETTINGS_PATH, diagnosticId("model-settings"));
  send({ method: "GET", path: SETTINGS_PATH, body: null, context, decoder: modelSettingsDecoder }, (reply) => {
    if (!reply.ok || !reply.value.ok) return;
    adoptModelSettings(reply.value);
    dispatch({ type: "model-configured", configured: reply.value.active.primary !== null });
    showModelSettings(reply.value);
  });
}

/** Sends one change from the picker; `done` runs after the new settings are shown, and a refusal is told to the user instead. */
export function chooseModel(choice: ModelChoice, done: () => void): void {
  const context = transportContext("POST", SETTINGS_PATH, diagnosticId("model-pick"));
  send({ method: "POST", path: SETTINGS_PATH, body: { primary: choice }, context, decoder: modelChangeDecoder }, (reply) => {
    if (!reply.ok || !reply.value.ok) {
      hooks.notice((reply.ok && reply.value.error?.message) || t("model.status.refused"), "warn");
      return;
    }
    adoptModelSettings(reply.value);
    showModelSettings(reply.value);
    done();
  });
}
