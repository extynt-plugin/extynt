/**
 * One change in the sheet's Changes list: its head, its meta line, Retry and Undo, and the detail that opens under it with
 * the receipt verdict, the checklist, the before and after frames and the files it wrote. The state of the list (which rows
 * are open, which folds are unfolded, which presses are out, the last note) lives here, so the section that lists the rows
 * only asks.
 */
import { changeRowsNow, refreshChanges } from "./panel-changes-feed.js";
import { ageText, needsLook, undoFailureLine, undoRequestedLine, type ChangeRow } from "./panel-changes.js";
import { clockTime, el } from "./panel-dom.js";
import { prettyClient } from "./panel-bar.js";
import { approvePlan, copyText, fetchReceiptText, undoPlan } from "./panel-plan-actions.js";
import { checklistOf } from "./panel-plan-checks.js";
import { planRowsOf, receiptLine, uncheckedCount, undoBlockedLine, type ReceiptLine } from "./panel-plan-labels.js";
import { checklistNode } from "./panel-plan-parts.js";
import { appliedAtOf, dropReasonOf, planFactsOf, receiptOf } from "./panel-plan-state.js";
import { planMessageFor, refreshPlans, undoChange } from "./panel-plans.js";
import { touchStatus } from "./panel-status-signal.js";
import { fetchThumbs, thumbPairNode, thumbsFor } from "./panel-thumbs.js";
import { later } from "./panel-transport.js";
import { undoStateOf, uiState } from "./ui-state.js";
import { t } from "./panel-language.js";

type Checklist = ReturnType<typeof checklistOf>;

const SKELETON_MS = 30000;
const FRAMES_RECHECK_MS = 50;
const SETTLED_PATTERN = /undone$/;

const undoing = new Set<string>();
const retrying = new Set<string>();
const opened = new Map<string, boolean>();
const unfolded = new Set<string>();
let note = "";
let notePlanId = "";
let noteIsUndoRequested = false;
let focusPlan = "";

function say(text: string, planId = "", undoRequested = false): void {
  note = text;
  notePlanId = planId;
  noteIsUndoRequested = undoRequested;
  touchStatus();
}

/** Scrolls the sheet to this change the next time it is drawn, opening it and the run that folds it. */
export function focusChange(planId: string): void {
  focusPlan = planId;
  opened.set(planId, true);
  const jobId = changeRowsNow().find((entry) => entry.planId === planId)?.jobId;
  if (jobId) unfolded.add(jobId);
}

/** The change the sheet was asked to show, once it is on screen. */
export function takeFocusedChange(sheet: HTMLElement): void {
  if (!focusPlan) return;
  const target = Array.from(sheet.querySelectorAll<HTMLElement>(".change-row")).find((node) => node.getAttribute("data-plan") === focusPlan);
  focusPlan = "";
  target?.scrollIntoView({ block: "center" });
}

/** Whether the run of verified changes with this job id is unfolded. */
export function foldIsOpen(jobId: string): boolean {
  return unfolded.has(jobId);
}

/** Unfolds or folds the run of verified changes with this job id. */
export function toggleFold(jobId: string): void {
  if (!unfolded.delete(jobId)) unfolded.add(jobId);
  touchStatus();
}

/** The line under the Changes title: the last press's words, dropped once the undo it announced is settled in the list. */
export function changeNote(changes: ReadonlyArray<{ readonly planId: string; readonly status: string }>): string {
  const settled = noteIsUndoRequested && changes.some((change) => change.planId === notePlanId && SETTLED_PATTERN.test(change.status));
  if (settled) {
    note = "";
    noteIsUndoRequested = false;
  }
  return note;
}

function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const node = el("button", className, label);
  node.type = "button";
  node.disabled = disabled;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

function clientOf(planId: string): string {
  const call = uiState().mcpCalls.find((entry) => entry.planIds.some((id) => id === planId));
  return call ? prettyClient(call.client) : t("plans.source.outsideAgent");
}

function sourceTag(row: ChangeRow): { readonly text: string; readonly outside: boolean } {
  if (row.origin === "mcp") return { text: clientOf(row.planId).toLowerCase(), outside: true };
  if (row.origin === "designer") return { text: t("plans.source.designer"), outside: false };
  return { text: row.origin === "chat" ? t("plans.source.agent") : row.source.toLowerCase(), outside: false };
}

function itemsOf(row: ChangeRow): Checklist {
  const message = planMessageFor(row.planId);
  if (!message) return [];
  return checklistOf({ rows: planRowsOf(message.rows, message.operations), status: row.status, notices: message.notices, receipt: receiptOf(row.planId) });
}

/** "verified 3/3", "partly applied 2 of 5", or the status label: how a change's checklist came out. */
export function resultWords(row: ChangeRow): string {
  const items = itemsOf(row);
  const good = items.filter((item) => item.mark === "ok").length;
  if (row.status === "verified" && items.length) return t("plans.result.verified", { good, total: items.length });
  if (row.status === "failed" && row.mayHaveMutated && items.length) return t("plans.result.partly", { good, total: items.length });
  return row.statusLabel.toLowerCase();
}

/** Whether Retry is offered: the change failed before touching the project and its postcondition never ran. */
export function retryable(row: ChangeRow): boolean {
  const facts = planFactsOf(row.planId);
  return row.status === "failed" && !facts.mayHaveMutated && facts.postcondition === "not_run";
}

function runRetry(row: ChangeRow): void {
  if (retrying.has(row.planId)) return;
  retrying.add(row.planId);
  touchStatus();
  approvePlan(row.planId, planMessageFor(row.planId)?.requiresAcknowledgement === true, (result) => {
    retrying.delete(row.planId);
    if (result.kind === "refused") say(t("plans.retry.failed", { reason: result.message }));
    refreshPlans();
    refreshChanges();
    touchStatus();
  });
}

function canUndo(row: ChangeRow): boolean {
  return undoStateOf(row.planId)?.available ?? row.canUndo;
}

function settledUndo(row: ChangeRow): boolean {
  const live = undoStateOf(row.planId);
  const code = live?.code ?? row.undoCode;
  return code === "ALREADY_UNDONE" || code === "NOTHING_CHANGED" || (!live && row.undoNote !== "");
}

function undoReason(row: ChangeRow): string {
  if (canUndo(row)) return "";
  if (row.undoNote && settledUndo(row)) return row.undoNote;
  return undoBlockedLine(undoStateOf(row.planId)?.code ?? row.undoCode);
}

function runUndo(row: ChangeRow): void {
  if (undoing.has(row.planId)) return;
  undoing.add(row.planId);
  say(t("plans.undo.undoing"));
  undoChange(row.planId, (problem) => {
    undoing.delete(row.planId);
    say(problem ? undoFailureLine(problem) : undoRequestedLine(), problem ? "" : row.planId, !problem);
    refreshChanges();
  });
}

function runUndoLast(row: ChangeRow): void {
  if (undoing.has(row.planId)) return;
  undoing.add(row.planId);
  say(t("plans.undo.undoingLast"));
  undoPlan(row.planId, "last", (problem, outcome) => {
    undoing.delete(row.planId);
    say(problem ? undoFailureLine(problem) : outcome ? outcome.text : undoRequestedLine(), "", !problem && !outcome);
    refreshPlans();
    refreshChanges();
  });
}

function undoButton(row: ChangeRow): HTMLButtonElement {
  const pressed = undoing.has(row.planId);
  const node = button(pressed ? t("plans.undo.undoing") : t("plans.undo.button"), "", () => runUndo(row), !canUndo(row) || pressed);
  node.title = canUndo(row) ? row.undoTitle : undoReason(row);
  node.setAttribute("aria-label", t("plans.undo.ariaLabel", { title: row.title }));
  return node;
}

function verdictNode(line: ReceiptLine): HTMLElement {
  const node = el("div", "receipt-line", line.text + (line.body ? " " + line.body : ""));
  node.setAttribute("data-tone", line.tone);
  return node;
}

function framesWanted(planId: string): boolean {
  return uiState().prefs.showThumbnails && planFactsOf(planId).visual;
}

function frameSlot(fresh: ReturnType<typeof thumbsFor>): HTMLElement {
  const slot = el("div", "thumb-slot");
  slot.appendChild(thumbPairNode(fresh));
  return slot;
}

function frames(row: ChangeRow): HTMLElement | null {
  if (!framesWanted(row.planId)) return null;
  if (!thumbsFor(row.planId)?.before) fetchThumbs(row.planId, (found) => found && touchStatus());
  const fresh = thumbsFor(row.planId);
  if (fresh) return frameSlot(fresh);
  const at = appliedAtOf(row.planId);
  const sinceMs = at === null ? SKELETON_MS + 1 : Date.now() - at;
  if (sinceMs > SKELETON_MS) return null;
  later(touchStatus, SKELETON_MS - sinceMs + FRAMES_RECHECK_MS);
  return frameSlot(fresh);
}

function copyReceipt(row: ChangeRow): void {
  fetchReceiptText(row.planId, (text) => say(text && copyText(text) ? t("plans.receipt.copied") : t("plans.receipt.copyFailed")));
}

function countsOf(row: ChangeRow, items: Checklist): { readonly operations: number; readonly unchecked: number } {
  if (items.length) return { operations: items.length, unchecked: items.filter((item) => item.mark === "unknown").length };
  const message = planMessageFor(row.planId);
  return { operations: row.operations, unchecked: message ? uncheckedCount(message.notices) : 0 };
}

function detailActions(row: ChangeRow, hasVerdict: boolean): HTMLElement | null {
  const more = el("div", "actions");
  if (hasVerdict) more.appendChild(button(t("plans.receipt.copy"), "ghost", () => copyReceipt(row)));
  if (canUndo(row) && row.steps > 1) more.appendChild(button(t("plans.undo.last"), "ghost", () => runUndoLast(row), undoing.has(row.planId)));
  return more.firstChild ? more : null;
}

function verdictOf(row: ChangeRow, items: Checklist): ReceiptLine | null {
  const counts = countsOf(row, items);
  return receiptLine({
    status: row.status,
    mayHaveMutated: row.mayHaveMutated || planFactsOf(row.planId).mayHaveMutated,
    operations: counts.operations,
    unchecked: counts.unchecked,
    receipt: receiptOf(row.planId),
  });
}

function textLines(row: ChangeRow): HTMLElement[] {
  const lines: Array<readonly [string, string]> = [
    [dropReasonOf(row.planId) ?? "", "plan-sub"],
    [undoReason(row), "plan-sub undo-reason"],
    [row.filesLine, "plan-sub"],
  ];
  return lines.filter(([text]) => text !== "").map(([text, className]) => el("div", className, text));
}

function detail(row: ChangeRow): HTMLElement {
  const box = el("div", "change-detail");
  const items = itemsOf(row);
  const verdict = verdictOf(row, items);
  const list = checklistNode(items);
  list?.setAttribute("open", "");
  const [dropped, ...rest] = textLines(row);
  const parts = [verdict ? verdictNode(verdict) : null, dropped ?? null, frames(row), list, ...rest, detailActions(row, verdict !== null)];
  parts.forEach((node) => node && box.appendChild(node));
  return box;
}

function isOpen(row: ChangeRow): boolean {
  return opened.get(row.planId) ?? needsLook(row);
}

function headNode(row: ChangeRow, open: boolean): HTMLElement {
  const tag = sourceTag(row);
  const head = el("button", "change-head");
  head.type = "button";
  head.setAttribute("aria-expanded", open ? "true" : "false");
  head.appendChild(el("span", "change-time", clockTime(new Date(row.applied)).slice(0, 5)));
  head.appendChild(el("span", tag.outside ? "source-tag" : "role-tag", tag.text));
  const title = el("span", "change-title", row.title);
  title.title = row.title;
  head.appendChild(title);
  head.addEventListener("click", () => {
    opened.set(row.planId, !open);
    touchStatus();
  });
  return head;
}

function metaNode(row: ChangeRow): HTMLElement {
  const line = el("div", "change-meta");
  const result = resultWords(row);
  line.appendChild(el("span", "pill" + (row.tone ? " " + row.tone : ""), row.statusLabel));
  const words = [t("plans.unit.op", { count: row.operations }), result !== row.statusLabel.toLowerCase() ? result : "", ageText(row.applied, Date.now())];
  line.appendChild(document.createTextNode(" " + words.filter(Boolean).join(" · ")));
  return line;
}

function actionsNode(row: ChangeRow): HTMLElement {
  const actions = el("div", "actions");
  if (retryable(row)) actions.appendChild(button(retrying.has(row.planId) ? t("plans.retry.busy") : t("plans.retry.button"), "", () => runRetry(row), retrying.has(row.planId)));
  actions.appendChild(undoButton(row));
  return actions;
}

/** The row for one change: head, meta, actions, and the detail when it is open. */
export function rowNode(row: ChangeRow): HTMLElement {
  const open = isOpen(row);
  const node = el("div", "change-row");
  node.setAttribute("data-plan", row.planId);
  node.setAttribute("data-tone", row.tone || "none");
  node.appendChild(headNode(row, open));
  node.appendChild(metaNode(row));
  node.appendChild(actionsNode(row));
  if (open) node.appendChild(detail(row));
  return node;
}
