/** What Settings says about the model without opening a form: the Provider and keys pill, the diagnostics line and the status area under the buttons. */
import { byId, clearChildren, el, setText } from "./panel-dom.js";
import { t } from "./panel-language.js";
import { refreshPickerTrigger } from "./panel-model-pill.js";
import { getModelSettings } from "./panel-model-store.js";
import type { ModelSettings, ModelSlot } from "./panel-model-wire.js";
import { iconElement } from "./panel-reasoning.js";

/** One line of a test report: whether the model answered, and what to tell the user. */
export interface StatusLine {
  readonly ok: boolean;
  readonly text: string;
}

function isDetails(node: HTMLElement): node is HTMLDetailsElement {
  return node.tagName === "DETAILS";
}

function providerLabel(primary: ModelSlot, settings: ModelSettings): string {
  const service = settings.services.find((entry) => entry.id === primary.service);
  return service?.label || primary.service || primary.displayName;
}

function providerSummary(settings: ModelSettings): string {
  const { primary, fallback } = settings.active;
  if (!primary) return t("model.summary.notSet");
  const keyWords = primary.keyConfigured ? t("model.summary.keyConfigured") : t("model.summary.noKey");
  return [providerLabel(primary, settings), keyWords, fallback ? t("model.summary.fallbackSet") : ""].filter(Boolean).join(" · ");
}

function renderProviderPill(settings: ModelSettings): void {
  const pill = byId("model-state");
  if (!pill) return;
  pill.textContent = providerSummary(settings);
  pill.className = "pill " + (settings.active.primary ? "ok" : "wait");
}

function renderDiagnosticsLine(settings: ModelSettings): void {
  const { primary, fallback } = settings.active;
  if (!primary) return;
  setText("diag-model", primary.displayName + " · " + primary.model + (fallback ? " (fallback " + fallback.displayName + ")" : ""));
}

function renderStartupErrors(settings: ModelSettings): void {
  const status = byId("model-status");
  if (!status || settings.errors.length === 0) return;
  status.className = "plan-sub bad";
  status.textContent = settings.errors.join("\n");
}

function openFallbackWhenSet(settings: ModelSettings): void {
  const details = byId("model-fallback-details");
  if (details && isDetails(details) && settings.slots.fallback) details.open = true;
}

/** Repaints the picker pill, the Provider and keys summary, the diagnostics line and any startup errors from the settings last reported. */
export function renderModelState(): void {
  refreshPickerTrigger();
  const settings = getModelSettings();
  if (!settings) return;
  renderProviderPill(settings);
  renderDiagnosticsLine(settings);
  renderStartupErrors(settings);
  openFallbackWhenSet(settings);
}

/** Shows one line under the model buttons; `tone` is a class such as "bad" or "ok". */
export function modelStatus(text: string, tone = ""): void {
  const status = byId("model-status");
  if (!status) return;
  status.className = "plan-sub " + tone;
  status.textContent = text;
}

function statusRow(line: StatusLine): HTMLElement {
  const row = el("div", "status-row");
  row.setAttribute("data-ok", line.ok ? "true" : "false");
  const icon = iconElement(line.ok ? "check" : "close", 14);
  if (icon) row.appendChild(icon);
  row.appendChild(el("span", "", line.text));
  return row;
}

/** Replaces the status with one row per test line, marked bad if any line failed. */
export function modelStatusRows(lines: ReadonlyArray<StatusLine>): void {
  const status = byId("model-status");
  if (!status) return;
  status.className = "plan-sub " + (lines.some((line) => !line.ok) ? "bad" : "ok");
  clearChildren(status);
  for (const line of lines) status.appendChild(statusRow(line));
}
