// The panel's persisted preferences and chat sessions: bounded, atomically written, one store per sidecar.
import { join } from "node:path";
import { decode } from "@extynt/decode";
import { profileDirectory } from "./profile-store.js";
import type { SidecarState } from "./server-state.js";
import { loadJsonFile, setAside, writeJsonAtomic } from "./ui-files.js";
import { DEFAULT_UI_PREFS, MAX_SESSIONS, MAX_SESSION_BYTES, MAX_SESSION_MESSAGES, failure, isSessionId, summaryOf, type UiPrefs, type UiPrefsPatch, type UiResult, type UiSession, type UiSessionInput, type UiSessionSummary } from "./ui-contract.js";
import { prefsPatch, sessionsEnvelope, storedSession } from "./ui-decoders.js";

const PREFS_FILE = "ui-prefs.json";
const SESSIONS_FILE = "ui-sessions.json";

interface SessionsState { sessions: Map<string, UiSession>; current: string | null }

export { autoApplyPolicyOf } from "./ui-contract.js";

function fitSession(session: UiSession): UiSession | null {
  const messages = session.messages.slice(-MAX_SESSION_MESSAGES);
  const sizes = messages.map((message) => Buffer.byteLength(JSON.stringify(message)));
  let total = Buffer.byteLength(JSON.stringify({ ...session, messages: [] })) + sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, sizes.length - 1);
  let first = 0;
  while (total > MAX_SESSION_BYTES && messages.length - first > 1) {
    total -= (sizes[first] ?? 0) + 1;
    first += 1;
  }
  return total > MAX_SESSION_BYTES ? null : { ...session, messages: messages.slice(first) };
}

function evictOldest(sessions: Map<string, UiSession>, keep: ReadonlySet<string | null>): void {
  while (sessions.size > MAX_SESSIONS) {
    let oldest: UiSession | undefined;
    for (const session of sessions.values()) if (!keep.has(session.id) && (!oldest || session.updatedAt < oldest.updatedAt)) oldest = session;
    if (!oldest) return;
    sessions.delete(oldest.id);
  }
}

function loadPrefs(directory: string, at: Date): UiPrefs {
  const file = join(directory, PREFS_FILE), raw = loadJsonFile(file, at);
  if (raw === undefined) return { ...DEFAULT_UI_PREFS };
  const patch = decode(prefsPatch, raw);
  if (patch.ok) return { ...DEFAULT_UI_PREFS, ...patch.value };
  setAside(file, at);
  return { ...DEFAULT_UI_PREFS };
}

function loadSessions(directory: string, at: Date): SessionsState {
  const file = join(directory, SESSIONS_FILE), raw = loadJsonFile(file, at), sessions = new Map<string, UiSession>();
  if (raw === undefined) return { sessions, current: null };
  const envelope = decode(sessionsEnvelope, raw);
  if (!envelope.ok) {
    setAside(file, at);
    return { sessions, current: null };
  }
  for (const entry of envelope.value.sessions) {
    const session = decode(storedSession, entry);
    if (session.ok) sessions.set(session.value.id, session.value);
  }
  const named = envelope.value.currentSessionId;
  return { sessions, current: isSessionId(named) && sessions.has(named) ? named : null };
}

export class UiStore {
  private readonly directory: string;
  private readonly now: () => number;
  private prefsValue: UiPrefs;
  private sessionState: SessionsState;

  constructor(directory: string, now: () => number) {
    this.directory = directory;
    this.now = now;
    this.prefsValue = loadPrefs(directory, new Date(now()));
    this.sessionState = loadSessions(directory, new Date(now()));
  }

  prefs(): UiPrefs { return { ...this.prefsValue }; }

  patchPrefs(patch: UiPrefsPatch): UiPrefs {
    const next: UiPrefs = { ...this.prefsValue, ...patch };
    writeJsonAtomic(this.directory, PREFS_FILE, next);
    this.prefsValue = next;
    return { ...next };
  }

  listSessions(): UiSessionSummary[] {
    return [...this.sessionState.sessions.values()].map(summaryOf).reverse().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(id: string): UiSession | null { return this.sessionState.sessions.get(id) ?? null; }

  currentSessionId(): string | null { return this.sessionState.current; }

  putSession(id: string, input: UiSessionInput): UiResult<UiSession> {
    if (!isSessionId(id)) return failure(422, "UI_SESSION_INVALID", "A session id is 1-64 characters of letters, digits, _ and -.");
    const at = this.now(), existing = this.sessionState.sessions.get(id);
    const fitted = fitSession({ id, title: input.title, project: input.project ?? null, createdAt: existing?.createdAt ?? input.createdAt ?? at, updatedAt: at, messages: input.messages });
    if (!fitted) return failure(413, "UI_SESSION_TOO_LARGE", "The newest message alone is larger than a stored session may be.");
    const sessions = new Map(this.sessionState.sessions);
    sessions.delete(id);
    sessions.set(id, fitted);
    evictOldest(sessions, new Set([id, this.sessionState.current]));
    this.commit({ sessions, current: this.sessionState.current });
    return { ok: true, value: fitted };
  }

  deleteSession(id: string): boolean {
    if (!this.sessionState.sessions.has(id)) return false;
    const sessions = new Map(this.sessionState.sessions);
    sessions.delete(id);
    this.commit({ sessions, current: this.sessionState.current === id ? null : this.sessionState.current });
    return true;
  }

  clearSessions(): void { this.commit({ sessions: new Map(), current: null }); }

  setCurrentSessionId(id: string | null): UiResult<string | null> {
    if (id !== null && !this.sessionState.sessions.has(id)) return failure(404, "UI_SESSION_NOT_FOUND", "There is no stored session with that id.");
    this.commit({ sessions: this.sessionState.sessions, current: id });
    return { ok: true, value: id };
  }

  private commit(next: SessionsState): void {
    writeJsonAtomic(this.directory, SESSIONS_FILE, { version: 1, currentSessionId: next.current, sessions: [...next.sessions.values()] });
    this.sessionState = next;
  }
}

const stores = new WeakMap<WeakKey, UiStore>();

/** Exactly one store per sidecar, rooted in its state directory. */
export function uiStoreFor(state: Pick<SidecarState, "options" | "now">): UiStore {
  let store = stores.get(state);
  if (!store) {
    store = new UiStore(state.options.stateDirectory ?? profileDirectory(), () => state.now().getTime());
    stores.set(state, store);
  }
  return store;
}
