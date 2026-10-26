/**
 * The context chip above the composer: what extynt will act on, live from the plugin's selection events, and the faint
 * caption on a user bubble recording what the message was sent with. A turn binds to the selection at send time; if the
 * selection moves while it runs the chip shows a "changed" mark and the next message uses the new selection.
 */
import { byId, clearChildren, el } from "./panel-dom.js";
import { t, onLanguageChange } from "./panel-language.js";
import { subscribeUi, uiState } from "./ui-state.js";
import type { MessageContext } from "./transcript.js";
import type { UiFocus } from "./ui-contract.js";

const MAX_CONTEXT_LAYERS = 8;

let boundKey: string | null = null;
let popoverOpen = false;
let popover: { readonly host: HTMLElement; readonly list: HTMLElement } | null = null;

function contextLine(focus: UiFocus | null): string {
  if (!focus || !focus.compositionName) return t("chrome.context.none");
  const first = focus.layerNames[0];
  if (focus.selected === 1 && first) return t("chrome.context.lineLayer", { composition: focus.compositionName, layer: first });
  if (focus.selected > 1) return t("chrome.context.lineLayers", { composition: focus.compositionName, count: focus.selected });
  return t("chrome.context.lineWhole", { composition: focus.compositionName });
}

function focusKey(focus: UiFocus | null): string {
  return focus ? [focus.compositionId, focus.selected, focus.layerNames.join("|")].join("/") : "";
}

/** What a message is sent with, taken at send time; null when no composition is open. */
export function messageContext(focus: UiFocus | null): MessageContext | null {
  if (!focus || !focus.compositionName) return null;
  return { composition: focus.compositionName, layers: focus.layerNames.slice(0, MAX_CONTEXT_LAYERS), selected: focus.selected };
}

/** The caption under a user bubble: "in COMP · LAYER", "in COMP · 3 layers" or "in COMP". */
export function contextCaption(context: MessageContext): string {
  const first = context.layers[0];
  if (context.selected === 1 && first !== undefined) return t("chrome.context.captionLayer", { composition: context.composition, layer: first });
  if (context.selected > 1) return t("chrome.context.captionLayers", { composition: context.composition, count: context.selected });
  return t("chrome.context.captionComposition", { composition: context.composition });
}

function popoverIn(row: HTMLElement): HTMLElement {
  if (popover) return popover.list;
  const host = el("div", "card-menu");
  const list = el("div", "card-menu-pop");
  list.setAttribute("role", "group");
  host.appendChild(list);
  row.appendChild(host);
  popover = { host, list };
  return list;
}

function paintPopover(row: HTMLElement, focus: UiFocus | null): void {
  const list = popoverIn(row);
  const names = focus ? focus.layerNames : [];
  list.setAttribute("aria-label", t("chrome.context.selectedLayers"));
  clearChildren(list);
  if (!names.length) list.appendChild(el("span", "menu-row-name", focus && focus.compositionName ? t("chrome.context.noLayers") : t("chrome.context.none")));
  names.forEach((name) => list.appendChild(el("span", "menu-row-name", name)));
  if (focus && focus.selected > names.length) list.appendChild(el("span", "menu-row-detail", t("chrome.context.andMore", { count: focus.selected - names.length })));
  list.hidden = !popoverOpen;
}

function paintContext(): void {
  const state = uiState();
  const focus = state.focus;
  const row = byId("context-chip-row");
  const chip = byId("context-chip");
  if (!row || !chip) return;
  row.hidden = state.host === null && focus === null;
  const text = chip.querySelector(".ctx-chip-text");
  if (text) text.textContent = contextLine(focus);
  chip.setAttribute("data-changed", boundKey !== null && boundKey !== focusKey(focus) ? "true" : "false");
  paintPopover(row, focus);
}

/** Binds the turn that starts to the selection it was sent with. */
export function bindTurnContext(): void {
  boundKey = focusKey(uiState().focus);
  paintContext();
}

/** Lets the chip follow the selection again once the turn ends. */
export function releaseTurnContext(): void {
  boundKey = null;
  paintContext();
}

/** Makes the chip open its list of selected layers and follow the focus and the host. */
export function wireContext(): void {
  const chip = byId("context-chip");
  chip?.addEventListener("click", () => {
    popoverOpen = !popoverOpen;
    chip.setAttribute("aria-expanded", popoverOpen ? "true" : "false");
    paintContext();
  });
  subscribeUi((topic) => {
    if (topic === "focus" || topic === "host") paintContext();
  });
  onLanguageChange(paintContext);
  paintContext();
}
