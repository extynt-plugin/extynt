/** Chat rendering: transcript messages, the notices a plan raises, and the history a turn is sent with. */
import { frameImageFor } from "./panel-attach.js";
import { appendRichText } from "./panel-chat-text.js";
import { contextCaption } from "./panel-context.js";
import { answerDetails } from "./panel-details.js";
import { chatOutput, clearChildren, el, inputById } from "./panel-dom.js";
import { renderEmptyState } from "./panel-empty-state.js";
import { hooks } from "./panel-hooks.js";
import { appendPlanRun, appendPlanToRun, resetPlanFolds } from "./panel-plan-fold.js";
import { planStatusOf } from "./panel-plan-state.js";
import { referenceImageFor } from "./panel-references.js";
import { MAX_STORED_MESSAGES, getChatTranscript, getCurrentSessionId, saveSessions, saveTranscript, updateSessionName, writingSession } from "./panel-sessions.js";
import { touchStatus } from "./panel-status-signal.js";
import { currentLanguage, t } from "./panel-language.js";
import { plainTextOf, type UiKey } from "@extynt/ui-text";
import type { NewRow, NoticeAction, PlanRow, TranscriptRow } from "./transcript.js";

type AnswerOrNotice = Exclude<TranscriptRow, { kind: "plan" }>;
type HistoryEntry = { readonly role: "user" | "assistant"; readonly content: string };
type HeldFocus = { readonly id: string; readonly start: number | null; readonly end: number | null };

const MAX_HISTORY_TURNS = 16;
const COMPACT_THRESHOLD = 10;
let compactExpanded = false;

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", "", label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

interface NoticeSpec { readonly label: UiKey; readonly run: () => void }

const NOTICE_BUTTONS: ReadonlyMap<string, NoticeSpec> = new Map<string, NoticeSpec>([
  ["open-diagnostics", { label: "chat.row.review", run: () => hooks.openSheet() }],
  ["open-debug", { label: "chat.row.details", run: () => hooks.openPage("debug") }],
  ["open-model", { label: "chat.row.setUpModel", run: () => hooks.openModelSettings() }],
  ["switch-model", { label: "chat.row.switchModel", run: () => hooks.openModelSettings() }],
]);

function noticeButton(action: NoticeAction): HTMLButtonElement | null {
  const spec = action === null ? undefined : NOTICE_BUTTONS.get(action);
  return spec ? button(plainTextOf(currentLanguage(), spec.label), spec.run) : null;
}

function tryAgain(text: string): void {
  if (hooks.isChatInFlight()) return;
  hooks.fillComposer(text);
  hooks.sendChat();
}

function appendActions(node: HTMLElement, row: AnswerOrNotice): void {
  if (row.kind === "notice") {
    const action = noticeButton(row.action);
    if (action) node.appendChild(action);
    return;
  }
  if (row.kind === "user") return;
  const { sendAnyway, retry } = row;
  if (sendAnyway !== undefined) node.appendChild(button(t("chat.row.sendAnyway"), () => hooks.sendLongPrompt(sendAnyway)));
  if (retry) node.appendChild(button(t("chat.row.tryAgain"), () => tryAgain(retry)));
}

function appendFrame(node: HTMLElement, captureId: string | undefined): void {
  const url = frameImageFor(captureId);
  if (!url) return;
  const image = el("img", "frame-image");
  image.src = url;
  image.alt = t("chat.row.frameAlt");
  node.appendChild(image);
}

function appendReferences(node: HTMLElement, refIds: ReadonlyArray<string>): void {
  const urls = refIds.map((id) => referenceImageFor(id)).filter((url): url is string => !!url);
  if (!urls.length) return;
  const strip = el("div", "ref-sent");
  urls.forEach((url) => {
    const image = el("img", "ref-image");
    image.src = url;
    image.alt = t("chat.row.referenceAlt");
    strip.appendChild(image);
  });
  node.appendChild(strip);
}

function appendUserExtras(node: HTMLElement, row: Extract<TranscriptRow, { kind: "user" }>): void {
  appendFrame(node, row.captureId);
  appendReferences(node, row.refIds ?? []);
  const caption = row.context ? contextCaption(row.context) : "";
  if (caption) node.appendChild(el("span", "msg-context", caption));
}

function messageNode(row: AnswerOrNotice): HTMLElement {
  const rich = row.kind !== "notice";
  const tone = row.kind === "notice" && row.tone ? " " + row.tone : "";
  const node = el("div", "msg " + row.kind + tone, rich ? undefined : row.text);
  if (rich) appendRichText(node, row.text);
  if (row.kind === "user") appendUserExtras(node, row);
  const details = row.kind === "assistant" ? answerDetails(row) : null;
  if (details) node.appendChild(details);
  appendActions(node, row);
  return node;
}

function renderMessage(row: TranscriptRow): HTMLElement | null {
  if (row.kind === "plan") return appendPlanToRun(row);
  const node = messageNode(row);
  chatOutput.appendChild(node);
  chatOutput.scrollTop = chatOutput.scrollHeight;
  return node;
}

function compactNotice(hidden: number): HTMLElement {
  const row = el("div", "msg notice");
  row.appendChild(document.createTextNode(t("chat.row.earlier", { count: hidden })));
  row.appendChild(
    button(t("chat.row.show"), () => {
      const before = chatOutput.scrollHeight;
      compactExpanded = true;
      renderTranscript();
      chatOutput.scrollTop += chatOutput.scrollHeight - before;
    }),
  );
  return row;
}

function heldFocus(): HeldFocus | null {
  const id = document.activeElement?.id;
  const active = id ? inputById(id) : null;
  if (!active || !chatOutput.contains(active)) return null;
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(held: HeldFocus | null): void {
  const next = held ? inputById(held.id) : null;
  if (!held || !next || !chatOutput.contains(next)) return;
  next.focus();
  if (held.start !== null && held.end !== null && typeof next.setSelectionRange === "function") next.setSelectionRange(held.start, held.end);
}

function renderRows(rows: ReadonlyArray<TranscriptRow>): void {
  let run: PlanRow[] = [];
  const flush = (): void => {
    if (run.length) appendPlanRun(run);
    run = [];
  };
  rows.forEach((row) => {
    if (row.kind === "plan") {
      run.push(row);
      return;
    }
    flush();
    renderMessage(row);
  });
  flush();
}

/** Draws the open chat from scratch, giving a focused field inside it back its focus. */
export function renderTranscript(): void {
  const held = heldFocus();
  clearChildren(chatOutput);
  resetPlanFolds();
  const rows = getChatTranscript();
  if (!rows.length) renderEmptyState(chatOutput);
  else {
    const hidden = compactExpanded ? 0 : Math.max(0, rows.length - COMPACT_THRESHOLD);
    if (hidden > 0) chatOutput.appendChild(compactNotice(hidden));
    renderRows(rows.slice(hidden));
  }
  restoreFocus(held);
  touchStatus();
}

function persistRow(row: TranscriptRow, background: boolean, count: number): void {
  if (background) {
    if (!row.transient) saveSessions();
    return;
  }
  if (!row.transient) saveTranscript();
  if (count === 1 && row.kind === "user") updateSessionName(getCurrentSessionId());
}

/** Keeps a row in the chat a turn writes into and, when that chat is open, draws it. */
export function addRow(input: NewRow): HTMLElement | null {
  const row: TranscriptRow = { ...input, at: Date.now() };
  const owner = writingSession();
  const target = owner ? owner.messages : getChatTranscript();
  if (!target.length && !owner) clearChildren(chatOutput);
  target.push(row);
  if (target.length > MAX_STORED_MESSAGES) target.shift();
  persistRow(row, owner !== null, target.length);
  if (owner) return null;
  const drawn = renderMessage(row);
  touchStatus();
  return drawn;
}

/** A line of the panel's own, between the messages; `transient` ones are shown but never stored. */
export function notice(text: string, tone?: string, action?: NoticeAction, transient?: boolean): HTMLElement | null {
  return addRow({ kind: "notice", text, tone: tone ?? "", action: action ?? null, ...(transient ? { transient: true } : {}) });
}

function historyEntry(row: TranscriptRow): HistoryEntry | null {
  if (row.kind === "plan") return { role: "assistant", content: "[Proposed plan " + row.planId + ": " + row.text + " — status " + planStatusOf(row.planId) + "]" };
  if ((row.kind === "user" || row.kind === "assistant") && !row.failed) return { role: row.kind, content: row.text };
  return null;
}

/** The last turns of the open chat in the form a request carries them. */
export function chatHistoryForRequest(): HistoryEntry[] {
  const entries = getChatTranscript().map(historyEntry).filter((entry): entry is HistoryEntry => entry !== null);
  return entries.slice(-MAX_HISTORY_TURNS);
}
