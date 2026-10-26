/** Chat sessions held by the sidecar's UI store and mirrored here: the open chat, the chat a running turn writes into, and the earlier chats. */
import { LANGUAGES, plainTextOf, type UiKey } from "@extynt/ui-text";
import { archiveSession, type ArchivedSession } from "./panel-chat-archive.js";
import { storableRows } from "./panel-session-draft.js";
import { byId } from "./panel-dom.js";
import { hooks } from "./panel-hooks.js";
import { onLanguageChange, t } from "./panel-language.js";
import { newSessionId, type SessionId } from "./ids.js";
import type { Acknowledged } from "./ui-api.js";
import { clearSessions, deleteSession, getSession, listSessions, putSession, setCurrentSession } from "./ui-api.js";
import { isUnreachable, reloadingForToken } from "./panel-transport.js";
import type { Reply } from "./panel-transport.js";
import { uiState } from "./ui-state.js";
import type { UiSession, UiSessionSummary } from "./ui-contract.js";
import type { TranscriptRow } from "./transcript.js";

/** The most rows one chat keeps; the oldest go first. */
export const MAX_STORED_MESSAGES = 60;
const SAVE_FAILED_KEY: UiKey = "chrome.sessions.saveFailed";
const TITLE_CHARS = 50;

interface HeldSession extends ArchivedSession {
  project: string | null;
  updatedAt: number;
  stored: boolean;
  saving: boolean;
  dirty: boolean;
}

const held = new Map<SessionId, HeldSession>();
const changeListeners: Array<() => void> = [];
let summaries: ReadonlyArray<UiSessionSummary> = [];
let currentId: SessionId | null = null;
let turnId: SessionId | null = null;
let saveFailureTold = false;

/** Runs `listener` whenever the set of chats or the open chat changes. */
export function onSessionsChanged(listener: () => void): void {
  changeListeners.push(listener);
}

function changed(): void {
  changeListeners.forEach((listener) => listener());
}

/** What a chat with no title is called, in the interface language. */
export function newChatTitle(): string {
  return t("chrome.topbar.newChat");
}

function isSaveFailedText(text: string): boolean {
  return LANGUAGES.some((language) => plainTextOf(language, SAVE_FAILED_KEY) === text);
}

function isTransient(row: TranscriptRow): boolean {
  return row.transient === true || (row.kind === "notice" && isSaveFailedText(row.text));
}

function persistable(rows: ReadonlyArray<TranscriptRow>): TranscriptRow[] {
  return rows.filter((row) => !isTransient(row));
}

function hold(session: UiSession, stored: boolean): HeldSession {
  const messages = persistable(session.messages).slice(-MAX_STORED_MESSAGES);
  const healed = stored && messages.length !== session.messages.length;
  const existing = held.get(session.id);
  if (existing) {
    existing.messages.splice(0, existing.messages.length, ...messages);
    existing.title = session.title;
    if (healed) save(existing);
    return existing;
  }
  const made: HeldSession = {
    id: session.id, title: session.title, project: session.project, createdAt: session.createdAt, updatedAt: session.updatedAt, messages,
    stored, saving: false, dirty: false, logSequence: 0, headerRevision: 0, headerFingerprint: "", headerAckRevision: 0,
  };
  held.set(session.id, made);
  if (healed) save(made);
  return made;
}

function current(): HeldSession | null {
  return currentId ? held.get(currentId) ?? null : null;
}

/** The id of the open chat. */
export function getCurrentSessionId(): SessionId | null {
  return currentId;
}

/** Marks the chat a running turn belongs to, or none. */
export function setTurnSessionId(value: SessionId | null): void {
  turnId = value;
}

/** The id of the chat a running turn writes into. */
export function turnSessionId(): SessionId | null {
  return turnId;
}

/** The rows of the open chat, starting a chat when none is open. */
export function getChatTranscript(): TranscriptRow[] {
  return (current() ?? createNewSession()).messages;
}

/** Whether the running turn belongs to a chat other than the open one. */
export function turnIsElsewhere(): boolean {
  return turnId !== null && turnId !== currentId;
}

/** The title of the chat the running turn belongs to. */
export function turnSessionName(): string {
  const session = turnId ? held.get(turnId) : undefined;
  return session && session.title ? session.title : t("chrome.sessions.anotherChat");
}

/** The chat a running turn writes into when the reader has moved to another one; null while it is the open chat. */
export function writingSession(): HeldSession | null {
  if (!turnId || turnId === currentId) return null;
  return held.get(turnId) ?? null;
}

/** The rows a turn writes into: its own chat's when the reader has moved on, else the open chat's. */
export function writingTranscript(): TranscriptRow[] {
  const owner = writingSession();
  return owner ? owner.messages : getChatTranscript();
}

/** The chat that holds a message of this request, or null when none does. */
export function sessionOfRequest(requestId: string): SessionId | null {
  for (const session of held.values()) {
    if (session.messages.some((row) => "requestId" in row && row.requestId === requestId)) return session.id;
  }
  return null;
}

/** The chats the panel holds, for the list. */
export function heldSessions(): ReadonlyArray<HeldSession> {
  return Array.from(held.values());
}

/** The summaries the store last listed. */
export function sessionSummaries(): ReadonlyArray<UiSessionSummary> {
  return summaries;
}

function paintTitle(): void {
  const node = byId("chat-title");
  const text = node ? node.querySelector(".chat-title-text") : null;
  const session = current();
  const title = session && session.title ? session.title : newChatTitle();
  if (text) text.textContent = title;
  if (node) node.title = title;
}

function tellSaveFailed(): void {
  if (saveFailureTold) return;
  saveFailureTold = true;
  hooks.notice(t("chrome.sessions.saveFailed"), "warn", null, true);
}

function dropSaveWarnings(rows: TranscriptRow[]): boolean {
  let dropped = false;
  for (let at = rows.length - 1; at >= 0; at -= 1) {
    const row = rows[at];
    if (row && row.transient === true && row.kind === "notice" && isSaveFailedText(row.text)) {
      rows.splice(at, 1);
      dropped = true;
    }
  }
  return dropped;
}

function forgetSaveFailure(): void {
  saveFailureTold = false;
  let shown = false;
  held.forEach((session, id) => {
    if (dropSaveWarnings(session.messages) && id === currentId) shown = true;
  });
  if (shown) hooks.renderTranscript();
}

function noteStoreFailure(reply: Reply<Acknowledged>): void {
  if (!reply.ok && !reloadingForToken() && !isUnreachable(reply.error)) tellSaveFailed();
}

function saved(session: HeldSession): void {
  session.stored = true;
  forgetSaveFailure();
  if (currentId === session.id) setCurrentSession(session.id, noteStoreFailure);
}

function save(session: HeldSession): void {
  if (session.saving) {
    session.dirty = true;
    return;
  }
  if (!session.messages.length && !session.stored) return;
  session.saving = true;
  session.dirty = false;
  archiveSession(session, () => save(session));
  const draft = { id: session.id, title: session.title, project: session.project, createdAt: session.createdAt, messages: storableRows(persistable(session.messages)) };
  putSession(draft, (reply) => {
    session.saving = false;
    if (reply.ok) saved(session);
    else noteStoreFailure(reply);
    if (session.dirty) save(session);
  });
}

/** Saves the open chat. */
export function saveTranscript(): void {
  const session = current();
  if (!session) return;
  session.updatedAt = Date.now();
  save(session);
}

/** Saves every held chat. */
export function saveSessions(): void {
  held.forEach(save);
}

/** Starts an empty chat and opens it. */
export function createNewSession(): HeldSession {
  const now = Date.now();
  const project = uiState().focus?.project ?? uiState().project;
  const session = hold({ id: newSessionId(), title: "", project, createdAt: now, updatedAt: now, messages: [] }, false);
  currentId = session.id;
  paintTitle();
  return session;
}

/** First start: the chat the store says is open, or a new one. */
export function loadSessions(openId: SessionId | null, done: () => void): void {
  onLanguageChange(paintTitle);
  listSessions((listed) => {
    summaries = listed.ok ? listed.value.sessions : [];
    const wanted = openId ?? (listed.ok ? listed.value.currentSessionId : null);
    if (!wanted) {
      createNewSession();
      done();
      return;
    }
    getSession(wanted, (reply) => {
      if (reply.ok) {
        currentId = reply.value.id;
        hold(reply.value, true);
        paintTitle();
      } else createNewSession();
      done();
    });
  });
}

function titleOf(text: string): string {
  const preview = text.slice(0, TITLE_CHARS).replace(/\n/g, " ");
  return text.length <= TITLE_CHARS ? preview : preview.slice(0, TITLE_CHARS - 3) + "…";
}

/** A chat is named after its first message, unless the reader named it. */
export function updateSessionName(sessionId: SessionId | null): void {
  const session = sessionId ? held.get(sessionId) : undefined;
  const first = session && !session.title ? session.messages.find((row) => row.kind === "user") : undefined;
  if (session && first) session.title = titleOf(first.text);
  paintTitle();
  saveTranscript();
}

function adopt(session: UiSession): void {
  hold(session, true);
  currentId = session.id;
  paintTitle();
  setCurrentSession(session.id, noteStoreFailure);
  if (hooks.isChatInFlight()) hooks.setComposerBusy(true);
  hooks.renderTranscript();
  hooks.refreshChanges();
  changed();
}

/** Opens another chat, from memory when it is held and stored, else from the store. */
export function switchSession(id: SessionId): void {
  if (id === currentId) return;
  const open = current();
  if (open) save(open);
  const cached = held.get(id);
  if (cached && cached.stored) {
    adopt(cached);
    return;
  }
  getSession(id, (reply) => {
    if (reply.ok) adopt(reply.value);
    else hooks.notice(t("chrome.sessions.openFailed"), "warn", null, true);
  });
}

/** Deletes one chat, refused while a turn runs in it. */
export function deleteSessionById(id: SessionId): void {
  if (hooks.isChatInFlight() && id === turnId) {
    hooks.notice(t("chrome.sessions.turnRunningBlocked"), "warn", null, true);
    return;
  }
  deleteSession(id, () => {
    held.delete(id);
    summaries = summaries.filter((entry) => entry.id !== id);
    if (currentId === id) {
      createNewSession();
      if (hooks.isChatInFlight()) hooks.setComposerBusy(true);
      hooks.renderTranscript();
    }
    changed();
  });
}

/** Clears every saved chat and starts a new one; refused while a turn runs. */
export function clearChatHistory(done: (cleared: boolean) => void): void {
  if (hooks.isChatInFlight()) {
    done(false);
    return;
  }
  clearSessions((reply) => {
    if (!reply.ok) {
      done(false);
      return;
    }
    held.clear();
    summaries = [];
    turnId = null;
    createNewSession();
    hooks.renderTranscript();
    changed();
    done(true);
  });
}
