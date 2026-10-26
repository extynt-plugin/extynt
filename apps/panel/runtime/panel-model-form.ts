/**
 * The provider forms in Settings, one for the primary model and one for the fallback: service, address, model, key and the
 * training notice. A form is rebuilt from the settings each time they change, so it always shows what the sidecar holds.
 */
import { type JsonObject } from "@extynt/decode";
import { byId, clearChildren, el } from "./panel-dom.js";
import { currentLanguage, t } from "./panel-language.js";
import { CUSTOM_VALUE, renderCatalogModels, renderCatalogResults, selectModel, selectOption, syncCustomModel } from "./panel-model-form-controls.js";
import type { FormField, ModelForm, SlotName } from "./panel-model-form-controls.js";
import { getModelSettings, serviceById } from "./panel-model-store.js";
import { formCatalogDecoder } from "./panel-model-wire.js";
import type { CatalogModel, ModelService, ModelSlot } from "./panel-model-wire.js";
import { openRowInSettings } from "./panel-page.js";
import { createTrainingNotice } from "./panel-training-notice.js";
import { diagnosticId, send, transportContext } from "./panel-transport.js";
import type { Reply } from "./panel-transport.js";

const CATALOG_PATH = "/v1/settings/model/catalog";
const forms = new Map<SlotName, ModelForm>();

function labelled<C extends HTMLElement>(container: HTMLElement, text: string, control: C): FormField<C> {
  const label = el("label", "", text);
  label.appendChild(control);
  container.appendChild(label);
  return { label, control };
}

function textInput(): HTMLInputElement {
  const input = el("input");
  input.spellcheck = false;
  return input;
}

function passwordInput(): HTMLInputElement {
  const input = textInput();
  input.type = "password";
  input.autocomplete = "off";
  return input;
}

function initialService(slot: SlotName, view: ModelSlot | null): string {
  if (view) return view.service;
  return slot === "primary" ? "anthropic" : "";
}

function serviceSelect(slot: SlotName, view: ModelSlot | null, services: ReadonlyArray<ModelService>): HTMLSelectElement {
  const select = el("select");
  if (slot === "fallback") select.appendChild(selectOption(t("model.field.none"), ""));
  for (const service of services) select.appendChild(selectOption(service.label, service.id));
  select.value = initialService(slot, view);
  return select;
}

function buildForm(slot: SlotName, container: HTMLElement, select: HTMLSelectElement): ModelForm {
  const service = labelled(container, t("model.field.service"), select);
  const baseUrl = labelled(container, t("model.field.address"), textInput());
  const modelSearch = labelled(container, t("model.field.findModel"), textInput());
  const model = labelled(container, t("model.field.model"), el("select"));
  model.label.hidden = true;
  const modelResults = el("div", "model-results");
  modelResults.hidden = true;
  container.appendChild(modelResults);
  const customModel = labelled(container, t("model.field.customId"), textInput());
  const key = labelled(container, t("model.field.apiKey"), passwordInput());
  const hint = el("div", "hint");
  container.appendChild(hint);
  const training = createTrainingNotice();
  container.appendChild(training.node);
  return { slot, service, baseUrl, modelSearch, model, modelResults, customModel, key, hint, training, catalogModels: [] };
}

function keyIsAsked(service: ModelService): boolean {
  return service.keyRequired || !service.baseUrl || service.addressEditable;
}

function syncModelVisibility(form: ModelForm, chosen: ModelService | null): void {
  const hidden = chosen === null || chosen.mock;
  const isPrimary = form.slot === "primary";
  form.baseUrl.label.hidden = hidden || !chosen.addressEditable;
  form.modelSearch.label.hidden = hidden || isPrimary;
  form.customModel.label.hidden = hidden || isPrimary;
  form.key.label.hidden = hidden || !keyIsAsked(chosen);
  form.modelResults.hidden = true;
}

function keyPlaceholder(chosen: ModelService, view: ModelSlot | null): string {
  if (view && view.keyConfigured && view.service === chosen.id) return t("model.form.keySaved", { hint: view.keyHint });
  return chosen.keyRequired ? t("model.form.pasteKey", { provider: chosen.label }) : t("model.form.optional");
}

function syncModelValues(form: ModelForm, chosen: ModelService, view: ModelSlot | null, resetDefaults: boolean): void {
  const saved = view !== null && view.service === chosen.id && !resetDefaults ? view : null;
  form.baseUrl.control.value = saved ? saved.baseUrl : chosen.baseUrl;
  selectModel(form, saved ? saved.model : chosen.model);
  form.baseUrl.control.placeholder = chosen.baseUrl || "https://…/v1";
  form.key.control.value = "";
  form.key.control.placeholder = keyPlaceholder(chosen, view);
}

function keySourceNotes(chosen: ModelService, view: ModelSlot | null): ReadonlyArray<string> {
  const shown = view !== null && view.service === chosen.id && view.keySource !== "" && view.keySource !== "llm.env";
  return shown ? [t("model.form.keySource", { source: view.keySource })] : [];
}

function listWords(items: ReadonlyArray<string>): string {
  return new Intl.ListFormat(currentLanguage(), { style: "long", type: "conjunction" }).format(items);
}

function overrideNotes(overriddenBy: ReadonlyArray<string>): ReadonlyArray<string> {
  return overriddenBy.length > 0 ? [t("model.form.overridden", { sources: listWords(overriddenBy) })] : [];
}

function syncModelHint(form: ModelForm, chosen: ModelService, view: ModelSlot | null): void {
  const overriddenBy = view?.overriddenBy ?? [];
  form.hint.textContent = [...keySourceNotes(chosen, view), ...overrideNotes(overriddenBy)].join(" ");
  form.hint.className = overriddenBy.length > 0 ? "hint warn" : "hint";
}

function refreshTraining(form: ModelForm, chosen: ModelService | null, accepted: boolean): void {
  form.training.node.hidden = chosen === null || chosen.mock;
  if (chosen) form.training.update(chosen, form.baseUrl.control.value, accepted);
}

function syncModelFields(form: ModelForm, view: ModelSlot | null, resetDefaults: boolean): void {
  const chosen = serviceById(form.service.control.value);
  syncModelVisibility(form, chosen);
  if (!chosen) {
    form.hint.textContent = "";
    return;
  }
  syncModelValues(form, chosen, view, resetDefaults);
  syncModelHint(form, chosen, view);
  refreshTraining(form, chosen, view !== null && view.service === chosen.id && view.trainingRiskAcknowledged);
}

function catalogUnavailable(form: ModelForm, service: ModelService): void {
  form.modelSearch.control.placeholder = service.keyRequired ? t("model.form.addKey", { provider: service.label }) : t("model.form.catalogUnavailable");
  form.hint.textContent = service.keyRequired ? t("model.form.addKeyHint") : t("model.form.catalogUnavailableHint");
  if (!form.modelResults.hidden) renderCatalogResults(form);
}

function settleFormCatalog(form: ModelForm, service: ModelService, reply: Reply<ReadonlyArray<CatalogModel>>): void {
  if (form.service.control.value !== service.id) return;
  if (!reply.ok) {
    catalogUnavailable(form, service);
    return;
  }
  form.catalogModels = reply.value;
  form.modelSearch.control.placeholder = t("model.filter.placeholder", { count: reply.value.length });
  renderCatalogModels(form);
}

function loadFormModelCatalog(form: ModelForm, service: ModelService): void {
  form.modelSearch.control.placeholder = t("model.form.loadingModels", { provider: service.label });
  const body = { slot: form.slot, service: service.id, apiKey: form.key.control.value };
  const context = transportContext("POST", CATALOG_PATH, diagnosticId("model-catalog"));
  send({ method: "POST", path: CATALOG_PATH, body, context, decoder: formCatalogDecoder }, (reply) => {
    settleFormCatalog(form, service, reply);
  });
}

function loadFallbackCatalog(form: ModelForm): void {
  const chosen = serviceById(form.service.control.value);
  if (chosen && form.slot !== "primary") loadFormModelCatalog(form, chosen);
}

function wireModelSlot(form: ModelForm, view: ModelSlot | null): void {
  form.service.control.addEventListener("change", () => {
    form.catalogModels = [];
    form.modelSearch.control.value = "";
    syncModelFields(form, view, true);
    loadFallbackCatalog(form);
  });
  form.model.control.addEventListener("change", () => syncCustomModel(form));
  form.modelSearch.control.addEventListener("focus", () => {
    if (form.modelSearch.control.value === form.model.control.value) form.modelSearch.control.value = "";
    renderCatalogResults(form);
  });
  form.modelSearch.control.addEventListener("input", () => renderCatalogResults(form));
  form.baseUrl.control.addEventListener("input", () => {
    refreshTraining(form, serviceById(form.service.control.value), form.training.acknowledgement() === true);
  });
  form.key.control.addEventListener("change", () => loadFallbackCatalog(form));
}

/** Rebuilds the form for one slot from the settings last reported; `view` is what the sidecar holds for that slot. */
export function renderModelSlot(slot: SlotName, view: ModelSlot | null): void {
  const container = byId(slot === "primary" ? "model-primary" : "model-fallback");
  const settings = getModelSettings();
  if (!container || !settings) return;
  clearChildren(container);
  const form = buildForm(slot, container, serviceSelect(slot, view, settings.services));
  wireModelSlot(form, view);
  syncModelFields(form, view, false);
  loadFallbackCatalog(form);
  forms.set(slot, form);
}

/** True while a form's chosen service may train on the user's prompts and its box is not ticked, so Save must wait. */
export function trainingBlocked(): boolean {
  return [...forms.values()].some((form) => form.service.control.value !== "" && form.training.blocking());
}

/** What to save for one slot, or null when that slot has no service chosen; the address goes only for services that let the user type one. */
export function slotUpdate(slot: SlotName): JsonObject | null {
  const form = forms.get(slot);
  if (!form || !form.service.control.value) return null;
  const typedModel = form.model.control.value === CUSTOM_VALUE ? form.customModel.control.value : form.model.control.value;
  const acknowledgement = form.training.acknowledgement();
  return {
    service: form.service.control.value,
    model: typedModel,
    ...(serviceById(form.service.control.value)?.addressEditable === true ? { baseUrl: form.baseUrl.control.value } : {}),
    ...(form.key.control.value ? { apiKey: form.key.control.value } : {}),
    ...(acknowledgement === null ? {} : { acknowledgeTrainingRisk: acknowledgement }),
  };
}

/** Opens Settings on the Provider and keys row and puts the cursor in the primary key field. */
export function openModelSettings(): void {
  openRowInSettings("model");
  forms.get("primary")?.key.control.focus();
}
