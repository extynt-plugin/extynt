/** The History page's list of chats: grouped by project, searchable, with a menu to delete one. */
import { countOf } from "./panel-bar.js";
import { byId, clearChildren, el, inputById } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { t, onLanguageChange } from "./panel-language.js";
import { closePage } from "./panel-page.js";
import { runningJob } from "./panel-progress.js";
import { deleteSessionById, getCurrentSessionId, heldSessions, newChatTitle, sessionSummaries, switchSession, turnSessionId } from "./panel-sessions.js";
import { uiState } from "./ui-state.js";
import type { SessionId } from "./ids.js";

interface ListedChat {
  readonly id: SessionId;
  readonly title: string;
  readonly project: string | null;
  readonly updatedAt: number;
  readonly messages: number;
}

let searchText = "";

function ageWords(updatedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 45) return t("chrome.sessions.justNow");
  if (seconds < 3600) return t("chrome.sessions.minutesAgo", { count: Math.max(1, Math.round(seconds / 60)) });
  if (seconds < 86400) return t("chrome.sessions.hoursAgo", { count: Math.round(seconds / 3600) });
  return t("chrome.sessions.daysAgo", { count: Math.round(seconds / 86400) });
}

function listed(): ListedChat[] {
  const heldIds = new Set(heldSessions().map((session) => session.id));
  const stored = sessionSummaries()
    .filter((entry) => !heldIds.has(entry.id))
    .map((entry) => ({ id: entry.id, title: entry.title, project: entry.project, updatedAt: entry.updatedAt, messages: entry.messageCount }));
  const open = heldSessions()
    .filter((session) => session.stored || session.messages.length)
    .map((session) => ({ id: session.id, title: session.title, project: session.project, updatedAt: session.updatedAt, messages: session.messages.length }));
  return [...stored, ...open].sort((a, b) => b.updatedAt - a.updatedAt);
}

function menuButton(title: string, pop: HTMLElement): HTMLButtonElement {
  const button = el("button", "card-menu-btn icon-btn", "⋯");
  button.type = "button";
  button.setAttribute("aria-label", t("chrome.sessions.moreFor", { title }));
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = pop.hidden;
    pop.hidden = !opening;
    button.setAttribute("aria-expanded", opening ? "true" : "false");
  });
  return button;
}

function sessionMenu(id: SessionId, title: string): HTMLElement {
  const menu = el("div", "card-menu");
  const pop = el("div", "card-menu-pop");
  const remove = el("button", "menu-row");
  pop.setAttribute("role", "menu");
  pop.hidden = true;
  remove.type = "button";
  remove.setAttribute("role", "menuitem");
  remove.appendChild(el("span", "menu-row-name", t("chrome.sessions.delete")));
  remove.addEventListener("click", () => deleteSessionById(id));
  pop.appendChild(remove);
  menu.appendChild(menuButton(title, pop));
  menu.appendChild(pop);
  return menu;
}

function runningWords(id: SessionId): string {
  if (id !== turnSessionId() || !hooks.isChatInFlight()) return "";
  const job = runningJob();
  return job && countOf(job) ? t("chrome.sessions.jobRunningCount", { progress: countOf(job) }) : t("chrome.sessions.jobRunning");
}

function chatRow(row: ListedChat): HTMLElement {
  const title = row.title || newChatTitle();
  const item = el("div", "session-row");
  const open = el("button", "session-item" + (row.id === getCurrentSessionId() ? " active" : ""));
  const running = runningWords(row.id);
  const messages = row.messages ? t("chrome.sessions.messages", { count: row.messages }) : "";
  open.type = "button";
  open.appendChild(el("span", "", title));
  open.appendChild(el("span", "plan-sub", [row.project, messages, running, ageWords(row.updatedAt)].filter(Boolean).join(" · ")));
  if (running) {
    open.title = t("chrome.sessions.turnRunning");
    open.appendChild(el("span", "dot wait"));
  }
  open.addEventListener("click", () => {
    switchSession(row.id);
    closePage();
    refreshSessionList();
  });
  item.appendChild(open);
  item.appendChild(sessionMenu(row.id, title));
  return item;
}

function group(list: HTMLElement, heading: string, rows: ReadonlyArray<ListedChat>): void {
  if (!rows.length) return;
  list.appendChild(el("h3", "session-group", heading));
  rows.forEach((row) => list.appendChild(chatRow(row)));
}

function matches(row: ListedChat, needle: string): boolean {
  return !needle || (row.title || newChatTitle()).toLowerCase().includes(needle) || (row.project ?? "").toLowerCase().includes(needle);
}

/** Draws the list of chats, narrowed by the search text. */
export function refreshSessionList(): void {
  const list = byId("sessions-list");
  if (!list) return;
  clearChildren(list);
  const needle = searchText.trim().toLowerCase();
  const rows = listed().filter((row) => matches(row, needle));
  if (!rows.length) {
    list.appendChild(el("div", "muted", needle ? t("chrome.sessions.noMatch", { query: searchText.trim() }) : t("chrome.chats.empty")));
    return;
  }
  const project = uiState().focus?.project ?? uiState().project;
  group(list, t("chrome.sessions.thisProject"), rows.filter((row) => !project || row.project === project));
  group(list, t("chrome.sessions.otherProjects"), rows.filter((row) => project && row.project !== project));
}

/** Makes the History page's search box narrow the list as it is typed in. */
export function wireSessionSearch(): void {
  const box = inputById("sessions-search");
  if (!box) return;
  onLanguageChange(refreshSessionList);
  box.addEventListener("input", () => {
    searchText = box.value;
    refreshSessionList();
  });
}
