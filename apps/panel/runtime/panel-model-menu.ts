/** The model popover opened from the composer's pill: where it sits, when it closes, and how it is refilled as answers land. */
import { byId, el } from "./panel-dom.js";
import { chooseModel } from "./panel-model-apply.js";
import { fetchMenuCatalog, LOADING_CATALOG } from "./panel-model-catalog.js";
import type { MenuCatalog } from "./panel-model-catalog.js";
import { loadEffortCatalog } from "./panel-model-effort-catalog.js";
import { t } from "./panel-language.js";
import { openModelSettings } from "./panel-model-form.js";
import { paintMenuBody } from "./panel-model-menu-view.js";
import type { MenuActions, MenuFilter } from "./panel-model-menu-view.js";
import { frameBox, modelMenuPlacement, triggerBox } from "./panel-model-menu-placement.js";
import { pickerSlot } from "./panel-model-store.js";

interface OpenMenu {
  readonly node: HTMLElement;
  readonly body: HTMLElement;
}

const CONTENT_PADDING_PX = 18;
let menu: OpenMenu | null = null;
let catalog: MenuCatalog = LOADING_CATALOG;
const filter: MenuFilter = { text: "" };

function isNode(target: EventTarget | null): target is Node {
  return target !== null && "nodeType" in target;
}

function containsTarget(node: HTMLElement | null, target: EventTarget | null): boolean {
  if (node === null) return false;
  return node === target || (isNode(target) && node.contains(target));
}

function menuHasFocus(): boolean {
  const active = document.activeElement;
  return menu !== null && active !== null && (active === menu.node || menu.node.contains(active));
}

function focusMenuPane(): void {
  if (menu === null) return;
  const target = menu.body.getElementsByTagName("input")[0] ?? menu.body.getElementsByTagName("button")[0];
  if (target) target.focus();
}

function positionMenu(): void {
  const trigger = byId("model-picker");
  if (menu === null || trigger === null) return;
  const placement = modelMenuPlacement(triggerBox(trigger), frameBox(), menu.body.scrollHeight + CONTENT_PADDING_PX);
  menu.node.style.left = placement.left + "px";
  menu.node.style.top = placement.top + "px";
  menu.node.style.width = placement.width + "px";
  menu.node.style.maxHeight = placement.height + "px";
}

function onOutsideClick(event: MouseEvent): void {
  if (menu === null) return;
  if (containsTarget(menu.node, event.target) || containsTarget(byId("model-picker"), event.target)) return;
  closeMenu();
}

function onEscape(event: KeyboardEvent): void {
  if (menu === null || event.key !== "Escape") return;
  event.preventDefault();
  closeMenu();
}

function stopListening(): void {
  if (typeof document.removeEventListener === "function") {
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("keydown", onEscape, true);
  }
  if (typeof window.removeEventListener === "function") window.removeEventListener("resize", positionMenu);
}

function startListening(): void {
  document.addEventListener("mousedown", onOutsideClick, true);
  document.addEventListener("keydown", onEscape, true);
  if (typeof window.addEventListener === "function") window.addEventListener("resize", positionMenu);
}

function closeMenu(): void {
  if (menu === null) return;
  const hadFocus = menuHasFocus();
  menu.node.parentNode?.removeChild(menu.node);
  const trigger = byId("model-picker");
  trigger?.setAttribute("aria-expanded", "false");
  menu = null;
  catalog = LOADING_CATALOG;
  stopListening();
  if (hadFocus) trigger?.focus();
}

function renderMenu(): void {
  if (menu === null) return;
  menu.node.setAttribute("aria-label", t("model.menu.label"));
  paintMenuBody(menu.body, { catalog, filter, actions: ACTIONS });
  positionMenu();
  if (menuHasFocus()) focusMenuPane();
}

/** Repaints the open popover in the current language, keeping what was typed into its filter; does nothing when it is closed. */
export function repaintOpenMenu(): void {
  renderMenu();
}

function loadMenuCatalog(): void {
  if (menu === null) return;
  catalog = LOADING_CATALOG;
  filter.text = "";
  renderMenu();
  fetchMenuCatalog((answer) => {
    if (menu === null) return;
    catalog = answer;
    renderMenu();
  });
}

function loadEfforts(): void {
  loadEffortCatalog(pickerSlot(), renderMenu);
}

function afterChoice(keepOpen: boolean): void {
  if (!keepOpen) {
    closeMenu();
    return;
  }
  loadEfforts();
  renderMenu();
}

const ACTIONS: MenuActions = {
  choose: (choice, keepOpen) => chooseModel(choice, () => afterChoice(keepOpen)),
  retry: loadMenuCatalog,
  openSettings: () => {
    closeMenu();
    openModelSettings();
  },
};

function buildMenu(): OpenMenu {
  const node = el("div", "menu");
  node.setAttribute("role", "menu");
  const body = el("div", "menu-body");
  node.appendChild(body);
  document.body.appendChild(node);
  return { node, body };
}

/** Opens the popover under the pill, or closes it if it is open; a keyboard click puts the focus inside. */
export function openModelMenu(event: MouseEvent): void {
  const trigger = byId("model-picker");
  if (trigger === null) return;
  if (menu !== null) {
    closeMenu();
    return;
  }
  menu = buildMenu();
  trigger.setAttribute("aria-expanded", "true");
  loadEfforts();
  loadMenuCatalog();
  if (event.detail === 0) focusMenuPane();
  startListening();
}
