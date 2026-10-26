/**
 * The status bar on screen: one strip above the composer that tells the truth about the sidecar and is where the user acts
 * on it. What it says comes from panel-bar.ts; this module gathers the facts, draws the strip, and hands a press to the one
 * handler the root wired. Stop, Apply, Discard and Continue exist only here; the rest of the panel can only point at them.
 */
import { barView, doneItems, nextChangeMs, type BarAction, type BarInputs, type BarView, type FinishedFacts, type WaitingItem } from "./panel-bar.js";
import { changeRowsNow, changesAnswer } from "./panel-changes-feed.js";
import { needsLook } from "./panel-changes.js";
import { byId, clearChildren, el } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { learningAnnouncement, learningLine } from "./panel-learning.js";
import { endedJob, liveProgress, runningJob, stopNote } from "./panel-progress.js";
import { iconElement } from "./panel-reasoning.js";
import { getCurrentSessionId } from "./panel-sessions.js";
import { onStatusTouched } from "./panel-status-signal.js";
import { stepWaiting, waitingAt, waitingItems } from "./panel-waiting.js";
import { every, later } from "./panel-transport.js";
import { subscribeUi, uiState, type UiTopic } from "./ui-state.js";
import type { BarActionId } from "./panel-bar.js";
import { onLanguageChange, t } from "./panel-language.js";

type BarHandler = (id: BarActionId, item: WaitingItem | null) => void;

const TICK_MS = 15000;
const ICONS: Record<string, string> = { blocked: "warning", offline: "clock", "needs-you": "question", locked: "warning", working: "loading", outside: "eye", learning: "sparkle", finished: "check", idle: "" };

let handler: BarHandler = () => undefined;
let toggle: () => void = () => undefined;
let isOpen: () => boolean = () => false;
let drawn = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let due = 0;
let announced = "";
let spoken = "";

export function onBarAction(next: BarHandler): void { handler = next; }

function finishedFacts(): FinishedFacts | null {
  const job = endedJob(getCurrentSessionId());
  if (!job) return null;
  const items = job.checklist ? job.checklist.items : [];
  const partly = changeRowsNow().filter((row) => row.jobId === job.jobId && needsLook(row) && row.mayHaveMutated).length;
  const verified = items.filter((item) => item.status === "verified").length;
  const total = Math.max(items.length, job.plansApplied + job.plansNotApplied);
  return { verified: doneItems({ verified, total, applied: job.plansApplied }), total: total, partly: partly, changes: job.plansApplied };
}

function inputsNow(now: number): BarInputs {
  const state = uiState(), waiting = waitingItems(), answer = changesAnswer();
  const progress = liveProgress();
  return {
    reachable: state.reachable, unreachableMs: state.unreachableSince === null ? 0 : now - state.unreachableSince, host: state.host, hostSinceMs: state.host ? now - state.host.since : 0,
    quarantine: state.quarantine, modelConfigured: state.modelConfigured, nowMs: now,
    job: runningJob(), turnOpen: hooks.isChatInFlight(), progress: progress ? { label: progress.label, step: progress.step } : null, stop: stopNote(),
    calls: state.mcpCalls, waiting: waiting, waitingAt: waitingAt(waiting), learning: learningLine(), finished: finishedFacts(),
    project: answer && answer.project ? answer.project : state.project, changeCount: answer && answer.project ? answer.changes.length : null,
    awaitingSnapshot: state.awaitingSnapshot,
  };
}

function button(action: BarAction): HTMLButtonElement {
  const node = el("button", action.style === "primary" ? "primary" : action.style === "danger" ? "danger" : "ghost", action.label);
  node.type = "button";
  node.disabled = action.disabled === true;
  node.setAttribute("data-action", action.id);
  node.className += " bar-act-" + action.id;
  node.addEventListener("click", (event) => {
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    if (node.disabled) return;
    const waiting = waitingItems();
    handler(action.id, waiting.length ? waiting[waitingAt(waiting)] ?? null : null);
  });
  return node;
}

function progressEdge(view: BarView): HTMLElement | null {
  if (!view.segments.length) return null;
  const edge = el("div", "bar-progress");
  edge.setAttribute("aria-hidden", "true");
  view.segments.forEach((segment) => {
    const cell = el("span", "bar-segment"), fill = el("span", "bar-segment-fill"), total = Math.max(1, segment.total);
    cell.setAttribute("data-name", segment.name);
    cell.style.flexGrow = String(total);
    fill.style.width = Math.min(100, Math.round((segment.verified / total) * 100)) + "%";
    cell.appendChild(fill);
    edge.appendChild(cell);
  });
  return edge;
}

function subLine(view: BarView, meta: string | undefined): HTMLElement {
  const sub = el("span", "bar-sub" + (view.slowing ? " slowing" : ""));
  if (meta) sub.appendChild(document.createTextNode(meta));
  if (view.eta) { sub.appendChild(el("span", "bar-eta", (meta ? " · " : "") + view.eta)); }
  if (view.tag) sub.appendChild(el("span", "bar-tag", view.tag));
  return sub;
}

function copy(view: BarView, open: boolean): HTMLElement {
  const box = el("span", "bar-copy"), title = open && view.title ? view.title : view.text;
  box.appendChild(el("span", "bar-text", title));
  const meta = open && view.meta ? view.meta : view.sub;
  const line = [meta, view.eta].filter(Boolean).join(" · ");
  if (line || view.tag) box.appendChild(subLine(view, meta));
  return box;
}

function main(view: BarView, open: boolean): HTMLButtonElement {
  const node = el("button", "bar-main");
  node.type = "button";
  node.id = "bar-main";
  node.setAttribute("aria-expanded", open ? "true" : "false");
  node.setAttribute("aria-controls", "sheet");
  node.title = open ? t("status.bar.hideDetails") : t("status.bar.showDetails");
  const name = ICONS[view.state], icon = name ? iconElement(name, 16) : null;
  const mark = el("span", "bar-icon");
  if (icon) mark.appendChild(icon);
  node.appendChild(mark);
  node.appendChild(copy(view, open));
  if (view.chip) node.appendChild(el("span", "bar-chip", view.chip));
  if (view.count) node.appendChild(el("span", "bar-count", view.count));
  node.addEventListener("click", () => toggle());
  return node;
}

function stepper(view: BarView): HTMLElement | null {
  if (!view.stepper) return null;
  const node = el("button", "bar-step", t("status.step.position", { at: view.stepper.at, of: view.stepper.of }));
  node.type = "button";
  node.title = t("status.bar.nextInLine");
  node.addEventListener("click", (event) => { if (event && typeof event.stopPropagation === "function") event.stopPropagation(); stepWaiting(); });
  return node;
}

function focusedAction(node: HTMLElement): string | null {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  return active && node.contains(active) ? active.getAttribute("data-action") : null;
}

function actionsRow(view: BarView, rest: BarView["actions"]): HTMLElement {
  const actions = el("div", "bar-actions");
  rest.forEach((action) => actions.appendChild(button(action)));
  const step = stepper(view);
  if (step) actions.appendChild(step);
  return actions;
}

function build(node: HTMLElement, view: BarView, open: boolean): void {
  const focused = focusedAction(node);
  clearChildren(node);
  node.setAttribute("data-state", view.state);
  node.setAttribute("data-tone", view.tone);
  node.setAttribute("data-open", open ? "true" : "false");
  node.setAttribute("role", view.alert ? "alert" : "status");
  const edge = progressEdge(view);
  if (edge) node.appendChild(edge);
  const row = el("div", "bar-row");
  row.appendChild(main(view, open));
  const stop = view.actions.filter((action) => action.id === "stop");
  stop.forEach((action) => row.appendChild(button(action)));
  node.appendChild(row);
  const rest = view.actions.filter((action) => action.id !== "stop");
  if (rest.length || view.stepper) node.appendChild(actionsRow(view, rest));
  if (focused) { const again = node.querySelector<HTMLElement>(".bar-act-" + focused); if (again) again.focus(); }
}

function announce(view: BarView): void {
  const live = byId("bar-announce");
  if (!live) return;
  if (view.state === "blocked" && announced !== view.text) { announced = view.text; live.textContent = view.text; }
  if (view.state !== "blocked") announced = "";
  const heard = learningAnnouncement();
  if (heard && heard !== spoken) { spoken = heard; live.textContent = heard; }
}

function paintBar(): void {
  const node = byId("status-bar");
  if (!node) return;
  const now = Date.now(), inputs = inputsNow(now), view = barView(inputs), open = isOpen();
  announce(view);
  const key = JSON.stringify([view, open]);
  if (key !== drawn) { drawn = key; build(node, view, open); }
  armTimer(now, nextChangeMs(inputs, view));
}

function armTimer(now: number, wait: number | null): void {
  if (wait === null) { if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer); timer = null; due = 0; return; }
  if (timer !== null && due <= now + wait + 50) return;
  if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
  due = now + wait;
  timer = later(() => { timer = null; due = 0; paintBar(); }, wait);
}

const REPAINT_TOPICS: ReadonlySet<UiTopic> = new Set<UiTopic>(["host", "reach", "model", "activity", "mcp", "plans", "change", "undo"]);

/** `open` and `flip` are the sheet's: the bar is its header, so a press on the bar flips it. */
export function wireBar(sheet: { open: () => boolean; flip: () => void }): void {
  isOpen = sheet.open;
  toggle = sheet.flip;
  onStatusTouched(paintBar);
  subscribeUi((topic) => {
    if (REPAINT_TOPICS.has(topic)) paintBar();
  });
  onLanguageChange(paintBar);
  every(paintBar, TICK_MS);
  paintBar();
}
