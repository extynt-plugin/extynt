/**
 * What an empty chat shows. Ready: a heading, the live selection and prompt chips that fill the composer (they never send),
 * and only here: there are no chips above the composer. Not ready: the first-run card from panel-first-run.ts, state rather
 * than a fourth surface: the status bar only points at it.
 */
import { el } from "./panel-dom.js";
import { firstRunCard } from "./panel-first-run.js";
import { t } from "./panel-language.js";
import { chipRow } from "./panel-prompt-chips.js";
import { uiState } from "./ui-state.js";
import type { UiFocus } from "./ui-contract.js";

function selectionLine(focus: UiFocus | null): string {
  if (!focus || !focus.compositionName) return t("chrome.empty.openComposition");
  if (focus.selected > 0) return t("chrome.empty.selected", { count: focus.selected, composition: focus.compositionName });
  return t("chrome.empty.selectLayers");
}

function startCard(focus: UiFocus | null): HTMLElement {
  const empty = el("div", "empty");
  empty.appendChild(el("h2", "", t("chrome.empty.heading")));
  empty.appendChild(el("div", "", selectionLine(focus)));
  empty.appendChild(chipRow(focus, true));
  return empty;
}

/** The empty-chat content for the current facts. */
export function renderEmptyState(into: HTMLElement): void {
  const state = uiState();
  into.appendChild(state.modelConfigured === false ? firstRunCard() : startCard(state.focus));
}
