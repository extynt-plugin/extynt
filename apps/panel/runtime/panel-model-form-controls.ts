/** The model fields of a provider form: the model drop-down, the search box over the provider's catalog, and the custom model id. */
import { clearChildren, el } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { catalogMatches } from "./panel-model-catalog.js";
import type { CatalogModel } from "./panel-model-wire.js";
import type { TrainingNotice } from "./panel-training-notice.js";

/** The two model slots the settings page edits. */
export type SlotName = "primary" | "fallback";

/** A control and the label that wraps it. */
export interface FormField<C extends HTMLElement> {
  readonly label: HTMLLabelElement;
  readonly control: C;
}

/** One provider form: its fields, the notice about training, and the models the provider listed. */
export interface ModelForm {
  readonly slot: SlotName;
  readonly service: FormField<HTMLSelectElement>;
  readonly baseUrl: FormField<HTMLInputElement>;
  readonly modelSearch: FormField<HTMLInputElement>;
  readonly model: FormField<HTMLSelectElement>;
  readonly modelResults: HTMLElement;
  readonly customModel: FormField<HTMLInputElement>;
  readonly key: FormField<HTMLInputElement>;
  readonly hint: HTMLElement;
  readonly training: TrainingNotice;
  catalogModels: ReadonlyArray<CatalogModel>;
}

/** The drop-down value that means "the model id is typed in the custom field". */
export const CUSTOM_VALUE = "__custom__";

const MAX_LISTED = 40;
const MAX_LABEL_LENGTH = 90;

/** A drop-down option. */
export function selectOption(text: string, value: string): HTMLOptionElement {
  const option = el("option", "", text);
  option.value = value;
  return option;
}

function customOption(): HTMLOptionElement {
  return selectOption(t("model.form.customOption"), CUSTOM_VALUE);
}

function searchNeedle(form: ModelForm): string {
  return form.modelSearch.control.value.trim().toLowerCase();
}

function choiceLabel(model: CatalogModel): string {
  return model.name && model.name !== model.id ? model.name + " · " + model.id : model.id;
}

/** Shows the custom id field only while "Custom model ID…" is the chosen model. */
export function syncCustomModel(form: ModelForm): void {
  form.customModel.label.hidden = form.model.control.value !== CUSTOM_VALUE;
}

/** Makes `model` the one choice in the drop-down (besides "Choose a model" and the custom entry) and in both text fields. */
export function selectModel(form: ModelForm, model: string): void {
  const select = form.model.control;
  clearChildren(select);
  select.appendChild(selectOption(t("model.form.chooseModel"), ""));
  if (model) select.appendChild(selectOption(model, model));
  select.appendChild(customOption());
  select.value = model;
  form.modelSearch.control.value = model;
  form.customModel.control.value = model;
  syncCustomModel(form);
}

function matchingModels(form: ModelForm): ReadonlyArray<CatalogModel> {
  const needle = searchNeedle(form);
  return form.catalogModels.filter((model) => catalogMatches(model, needle));
}

function narrowPrompt(matches: number): string {
  return matches > MAX_LISTED ? t("model.form.chooseNarrow", { count: matches }) : t("model.form.chooseModel");
}

/** Fills the drop-down with the catalog models that match the search, keeping the current choice listed. */
export function renderCatalogModels(form: ModelForm): void {
  const select = form.model.control;
  const selected = select.value === CUSTOM_VALUE ? form.customModel.control.value : select.value;
  const matches = matchingModels(form);
  const listed = matches.slice(0, MAX_LISTED);
  clearChildren(select);
  select.appendChild(selectOption(narrowPrompt(matches.length), ""));
  for (const model of listed) select.appendChild(selectOption(choiceLabel(model).slice(0, MAX_LABEL_LENGTH), model.id));
  if (selected && !listed.some((model) => model.id === selected)) select.appendChild(selectOption(selected.slice(0, MAX_LABEL_LENGTH), selected));
  select.appendChild(customOption());
  select.value = selected;
  syncCustomModel(form);
  if (!form.modelResults.hidden) renderCatalogResults(form);
}

function resultRow(form: ModelForm, model: CatalogModel): HTMLButtonElement {
  const row = el("button", "model-result", choiceLabel(model));
  row.type = "button";
  row.title = model.id;
  row.addEventListener("click", () => {
    selectModel(form, model.id);
    form.modelResults.hidden = true;
  });
  return row;
}

function customResultRow(form: ModelForm): HTMLButtonElement {
  const row = el("button", "model-result model-result-custom", t("model.form.useCustom"));
  row.type = "button";
  row.addEventListener("click", () => {
    form.customModel.control.value = form.modelSearch.control.value.trim();
    form.model.control.value = CUSTOM_VALUE;
    syncCustomModel(form);
    form.modelResults.hidden = true;
  });
  return row;
}

/** Lists the catalog models that match the search under the search box, with a last row for a custom id. */
export function renderCatalogResults(form: ModelForm): void {
  const results = form.modelResults;
  clearChildren(results);
  const matches = matchingModels(form);
  for (const model of matches.slice(0, MAX_LISTED)) results.appendChild(resultRow(form, model));
  if (matches.length === 0) results.appendChild(el("div", "model-result-empty", t(form.catalogModels.length > 0 ? "model.form.noMatches" : "model.form.noCatalog")));
  results.appendChild(customResultRow(form));
  results.hidden = false;
}
