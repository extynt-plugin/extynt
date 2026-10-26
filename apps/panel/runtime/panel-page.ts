/**
 * The page: one full-panel component with a back arrow, used three times. Chats (the title), Settings (the gear, as an
 * accordion with one row open at a time) and Developer (a row inside Settings, shown when the diagnostics preference is on).
 * Opening a page never starts a second copy of anything: History is only here, Settings is only here.
 */
import type { UiKey } from "@extynt/ui-text";
import { byId, setText } from "./panel-dom.js";
import { onLanguageChange, t } from "./panel-language.js";

type PageView = "chats" | "settings" | "debug";

const ACCORDION_ROWS = ["about", "model", "decision", "approvals", "frames", "memory", "agents"] as const;
type AccordionRow = (typeof ACCORDION_ROWS)[number];

const TITLES = { chats: "chrome.page.chats", settings: "chrome.page.settings", debug: "chrome.page.developer" } as const satisfies Record<PageView, UiKey>;
const HEAD_IDS = {
  about: "acc-about",
  model: "acc-model",
  decision: "acc-decision",
  approvals: "acc-approvals",
  frames: "acc-frames",
  memory: "acc-memory",
  agents: "acc-agents",
} as const satisfies Record<AccordionRow, string>;
const BODY_IDS = {
  about: "acc-about-body",
  model: "acc-model-body",
  decision: "acc-decision-body",
  approvals: "acc-approvals-body",
  frames: "acc-frames-body",
  memory: "acc-memory-body",
  agents: "acc-agents-body",
} as const satisfies Record<AccordionRow, string>;
const shown = new Map<PageView, Array<() => void>>();
let view: PageView = "settings";
let open = false;
let developer = false;
let openRow: AccordionRow | null = null;

/** The page that is current, open or not. */
export function pageView(): PageView {
  return view;
}

/** Whether the page is on screen. */
export function pageOpen(): boolean {
  return open;
}

/** Runs `run` each time this view comes on screen. */
export function onViewShown(name: PageView, run: () => void): void {
  shown.set(name, [...(shown.get(name) ?? []), run]);
}

function announceShown(): void {
  if (open) (shown.get(view) ?? []).forEach((run) => run());
}

function viewOf(value: string): PageView | null {
  return value === "chats" || value === "settings" || value === "debug" ? value : null;
}

/** The Developer row exists only while the diagnostics preference is on; otherwise nobody sees it or can land on it. */
export function setDeveloper(value: boolean): void {
  developer = value;
  const row = byId("developer-section");
  if (row) row.hidden = !value;
  if (!value && view === "debug") showPageView("settings");
}

function markPanels(): void {
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-panel") !== view;
  });
}

function paintTitle(): void {
  const title = t(TITLES[view]);
  setText("page-title", title);
  byId("page")?.setAttribute("aria-label", title);
}

/** Keeps the page title and its label in the interface language, now and after each language change. */
export function wirePageTitle(): void {
  paintTitle();
  onLanguageChange(paintTitle);
}

/** Shows one of the pages; the Developer page falls back to Settings while the diagnostics preference is off. */
export function showPageView(next: string): void {
  const wanted = viewOf(next);
  view = wanted !== null && (wanted !== "debug" || developer) ? wanted : "settings";
  paintTitle();
  markPanels();
  announceShown();
}

/** Opens the page on this view. */
export function openPage(next: string): void {
  const page = byId("page");
  if (!page) return;
  showPageView(next);
  open = true;
  page.classList.add("open");
  page.setAttribute("aria-hidden", "false");
  announceShown();
}

/** Closes the page. */
export function closePage(): void {
  open = false;
  const page = byId("page");
  if (!page) return;
  page.classList.remove("open");
  page.setAttribute("aria-hidden", "true");
}

/** The back arrow: Developer goes back to Settings, every other page back to the chat. */
export function backFromPage(): void {
  if (view === "debug") showPageView("settings");
  else closePage();
}

/** The gear and the title: pressing the one for the page that is already open closes it. */
export function togglePage(next: PageView): void {
  if (open && view === next) closePage();
  else openPage(next);
}

function paintRows(): void {
  ACCORDION_ROWS.forEach((name) => {
    const on = openRow === name;
    byId(HEAD_IDS[name])?.setAttribute("aria-expanded", on ? "true" : "false");
    const body = byId(BODY_IDS[name]);
    if (body) body.hidden = !on;
  });
}

function toggleRow(name: AccordionRow): void {
  openRow = openRow === name ? null : name;
  paintRows();
}

/** Settings with this row open, scrolled to it: the way in from "Set up". */
export function openRowInSettings(name: AccordionRow): void {
  openPage("settings");
  openRow = name;
  paintRows();
  byId(HEAD_IDS[name])?.scrollIntoView();
}

/** Wires the accordion heads to open and close their rows. */
export function wireAccordion(): void {
  ACCORDION_ROWS.forEach((name) => byId(HEAD_IDS[name])?.addEventListener("click", () => toggleRow(name)));
  paintRows();
}
