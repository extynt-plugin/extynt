/** The inside of the model popover: the provider's models, the reasoning levels, the image switch and the way to Settings. */
import { clearChildren, el } from "./panel-dom.js";
import { formatTokens } from "./panel-chat-text.js";
import type { ModelChoice } from "./panel-model-apply.js";
import { catalogMatches } from "./panel-model-catalog.js";
import type { MenuCatalog } from "./panel-model-catalog.js";
import { effortChoice, effortRows } from "./panel-model-effort.js";
import type { EffortRow } from "./panel-model-effort.js";
import { effortCatalog } from "./panel-model-effort-catalog.js";
import { t } from "./panel-language.js";
import { activePrimary, getModelSettings, pickerSlot } from "./panel-model-store.js";
import type { CatalogModel, ModelService, ModelSlot } from "./panel-model-wire.js";
import { iconElement } from "./panel-reasoning.js";

/** What a click in the popover can ask for; `keepOpen` says whether the popover stays after the change lands. */
export interface MenuActions {
  readonly choose: (choice: ModelChoice, keepOpen: boolean) => void;
  readonly retry: () => void;
  readonly openSettings: () => void;
}

/** The text typed into the model filter, which survives repaints while the popover is open. */
export interface MenuFilter {
  text: string;
}

interface MenuContent {
  readonly catalog: MenuCatalog;
  readonly filter: MenuFilter;
  readonly actions: MenuActions;
}

interface MenuRowOptions {
  readonly name: string;
  readonly detail?: string;
  readonly selected?: boolean;
  readonly onClick: () => void;
}

interface ModelRows {
  readonly models: ReadonlyArray<CatalogModel>;
  readonly current: string;
  readonly filter: MenuFilter;
  readonly actions: MenuActions;
}

const MODEL_ROWS_SHOWN = 40;

function menuRow(options: MenuRowOptions): HTMLButtonElement {
  const row = el("button", options.selected ? "menu-row menu-row-on" : "menu-row");
  row.type = "button";
  row.setAttribute("role", "menuitemradio");
  row.setAttribute("aria-checked", options.selected ? "true" : "false");
  const copy = el("span", "menu-row-copy");
  copy.appendChild(el("span", "menu-row-name", options.name));
  if (options.detail) copy.appendChild(el("span", "menu-row-detail", options.detail));
  row.appendChild(copy);
  const check = options.selected ? iconElement("check", 16) : null;
  if (check) row.appendChild(check);
  row.addEventListener("click", options.onClick);
  return row;
}

function menuGroup(title: string): HTMLElement {
  const group = el("div", "menu-group");
  if (title) group.appendChild(el("div", "menu-group-title", title));
  return group;
}

function modelDetail(model: CatalogModel): string {
  const context = model.contextWindow ? formatTokens(model.contextWindow) + " context" : "";
  return [model.name ? model.id : "", context].filter(Boolean).join(" · ");
}

function modelRow(model: CatalogModel, rows: ModelRows): HTMLButtonElement {
  return menuRow({
    name: model.name || model.id,
    detail: modelDetail(model),
    selected: model.id === rows.current,
    onClick: () => rows.actions.choose({ model: model.id }, true),
  });
}

function retiredNotice(current: string): string {
  return t("model.menu.retired", { model: current });
}

function paintModelRows(container: HTMLElement, rows: ModelRows): void {
  clearChildren(container);
  if (rows.models.length === 0) {
    container.appendChild(el("div", "menu-status", t("model.menu.noModels")));
    return;
  }
  const needle = rows.filter.text.trim().toLowerCase();
  const shown = rows.models.filter((model) => catalogMatches(model, needle));
  if (rows.current && !rows.models.some((model) => model.id === rows.current)) container.appendChild(el("div", "menu-status menu-status-bad", retiredNotice(rows.current)));
  if (shown.length === 0) container.appendChild(el("div", "menu-status", t("model.filter.noMatch", { query: rows.filter.text })));
  for (const model of shown.slice(0, MODEL_ROWS_SHOWN)) container.appendChild(modelRow(model, rows));
  if (shown.length > MODEL_ROWS_SHOWN) container.appendChild(el("div", "menu-status", t("model.filter.narrow", { count: shown.length })));
}

function filterInput(rows: ModelRows, container: HTMLElement): HTMLInputElement {
  const input = el("input", "menu-filter");
  input.type = "search";
  input.value = rows.filter.text;
  input.setAttribute("placeholder", t("model.filter.placeholder", { count: rows.models.length }));
  input.setAttribute("aria-label", t("model.filter.label"));
  input.addEventListener("input", () => {
    rows.filter.text = input.value;
    paintModelRows(container, rows);
  });
  return input;
}

function paintReadyModels(group: HTMLElement, models: ReadonlyArray<CatalogModel>, content: MenuContent): void {
  const rows: ModelRows = { models, current: pickerSlot()?.model ?? "", filter: content.filter, actions: content.actions };
  const container = el("div", "menu-rows");
  if (models.length > MODEL_ROWS_SHOWN) group.appendChild(filterInput(rows, container));
  group.appendChild(container);
  paintModelRows(container, rows);
}

function modelsTitle(service: ModelService | null): string {
  return service ? t("model.menu.providerModels", { provider: service.label }) : t("model.menu.models");
}

function askingLine(service: ModelService | null): string {
  return service ? t("model.menu.asking", { provider: service.label }) : t("model.menu.askingGeneric");
}

function paintModelsGroup(body: HTMLElement, content: MenuContent): void {
  const service = serviceOf(pickerSlot());
  const group = menuGroup(modelsTitle(service));
  const { catalog } = content;
  if (catalog.kind === "loading") {
    group.appendChild(el("div", "menu-status", askingLine(service)));
  } else if (catalog.kind === "failed") {
    group.appendChild(el("div", "menu-status menu-status-bad", catalog.message));
    group.appendChild(menuRow({ name: t("model.menu.retry"), onClick: content.actions.retry }));
  } else {
    paintReadyModels(group, catalog.models, content);
  }
  body.appendChild(group);
}

function serviceOf(slot: ModelSlot | null): ModelService | null {
  if (slot === null) return null;
  return getModelSettings()?.services.find((entry) => entry.id === slot.service) ?? null;
}

function effortButton(row: EffortRow, actions: MenuActions): HTMLButtonElement {
  const button = el("button", row.selected ? "on" : "", row.label);
  button.type = "button";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", row.selected ? "true" : "false");
  if (row.detail) button.title = row.detail;
  button.addEventListener("click", () => actions.choose({ reasoningEffort: row.value }, false));
  return button;
}

function paintEffortGroup(body: HTMLElement, actions: MenuActions): void {
  const group = menuGroup(t("model.menu.effortGroup"));
  const known = effortCatalog();
  if (known?.kind === "loading") {
    group.appendChild(el("div", "menu-status", t("model.menu.checkingEfforts")));
  } else if (known?.kind === "failed") {
    group.appendChild(el("div", "menu-status menu-status-bad", known.message));
  } else {
    const segmented = el("div", "segmented");
    segmented.setAttribute("role", "radiogroup");
    segmented.setAttribute("aria-label", t("model.menu.effortGroup"));
    const offered = known?.kind === "ready" ? known.efforts : [];
    for (const row of effortRows(effortChoice(pickerSlot(), activePrimary()), offered, t)) segmented.appendChild(effortButton(row, actions));
    group.appendChild(segmented);
  }
  body.appendChild(group);
}

function imageInputDetail(active: ModelSlot | null, enabled: boolean): string {
  const reportedBy = active ? active.imagesReportedBy : "";
  if (reportedBy === "setting") return t(enabled ? "model.image.settingOn" : "model.image.settingOff");
  if (reportedBy === "model") return t(enabled ? "model.image.modelTakes" : "model.image.modelNoTake");
  return t("model.image.default");
}

function paintImagesRow(body: HTMLElement, actions: MenuActions): void {
  const active = activePrimary();
  const enabled = active !== null && active.acceptsImages;
  const answeredByUser = active !== null && active.imagesReportedBy === "setting";
  const group = menuGroup("");
  const onClick = (): void => actions.choose({ acceptsImages: answeredByUser ? null : !enabled }, true);
  group.appendChild(menuRow({ name: t("model.menu.imageInput"), detail: imageInputDetail(active, enabled), selected: enabled, onClick }));
  body.appendChild(group);
}

function paintFoot(body: HTMLElement, actions: MenuActions): void {
  const foot = el("div", "menu-foot");
  foot.appendChild(document.createTextNode(t("model.menu.applyNote") + " "));
  const settings = el("button", "menu-link", t("model.menu.settings"));
  settings.type = "button";
  settings.addEventListener("click", actions.openSettings);
  foot.appendChild(settings);
  body.appendChild(foot);
}

/** Rebuilds the popover body from the current settings and `content`: the provider list, the filter over it, and what clicks do. */
export function paintMenuBody(body: HTMLElement, content: MenuContent): void {
  clearChildren(body);
  paintModelsGroup(body, content);
  paintEffortGroup(body, content.actions);
  paintImagesRow(body, content.actions);
  paintFoot(body, content.actions);
}
