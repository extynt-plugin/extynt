/** The sidecar's UI routes (/v1/ui/*) as calls: bootstrap, prefs, sessions and the chat-log export. */
import type { Decoder, Infer } from "@extynt/decode";
import { diagnosticId, pollContext, send, transportContext } from "./panel-transport.js";
import type { Call, OnReply, TransportContext } from "./panel-transport.js";
import type { PrefsReply } from "./ui-contract.js";
import { bootstrapDecoder, chatExportDecoder, prefsReplyDecoder, sessionListDecoder, sessionReplyDecoder } from "./ui-contract.js";
import type { Bootstrap, SessionList, UiPrefs, UiSession } from "./ui-contract.js";
import type { SessionId } from "./ids.js";
import type { TranscriptRow } from "./transcript.js";
import { type JsonObject } from "@extynt/decode";
import { acknowledged } from "./wire-decoders.js";

interface Route {
  readonly method: string;
  readonly path: string;
  readonly context: TransportContext;
}

function route(method: string, path: string, name: string, polling = false): Route {
  const id = diagnosticId(name);
  return { method, path, context: polling ? pollContext(method, path, id) : transportContext(method, path, id) };
}

function call<T>(where: Route, body: JsonObject | null, decoder: Decoder<T>): Call<T> {
  return { method: where.method, path: where.path, body, context: where.context, decoder };
}

/** The sidecar did what a delete or a current-chat change asked. */
export type Acknowledged = Infer<typeof acknowledged>;

function sessionPath(id: SessionId): string {
  return "/v1/ui/sessions/" + encodeURIComponent(id);
}

/** Everything the sidecar knows at start, and again every second while the stream is down. */
export function loadBootstrap(done: OnReply<Bootstrap>): void {
  send(call(route("GET", "/v1/ui/bootstrap", "bootstrap"), null, bootstrapDecoder), done);
}

/** Changes some of the reader's switches; the answer is the full set as the sidecar now holds it. */
export function patchPrefs(patch: Partial<UiPrefs>, done: OnReply<PrefsReply>): void {
  send(call(route("PATCH", "/v1/ui/prefs", "prefs"), patch, prefsReplyDecoder), done);
}

/** The saved chats, newest first. */
export function listSessions(done: OnReply<SessionList>): void {
  send(call(route("GET", "/v1/ui/sessions", "sessions", true), null, sessionListDecoder), done);
}

/** One saved chat with its rows. */
export function getSession(id: SessionId, done: OnReply<UiSession>): void {
  send(call(route("GET", sessionPath(id), "session"), null, sessionReplyDecoder), done);
}

interface SessionDraft {
  readonly id: SessionId;
  readonly title: string;
  readonly project: string | null;
  readonly createdAt: number;
  readonly messages: ReadonlyArray<TranscriptRow>;
}

/** Saves one chat; the answer is the chat as the sidecar now holds it. */
export function putSession(session: SessionDraft, done: OnReply<UiSession>): void {
  const body = { title: session.title, project: session.project, createdAt: session.createdAt, messages: session.messages };
  send(call(route("PUT", sessionPath(session.id), "session-save", true), body, sessionReplyDecoder), done);
}

/** Deletes one saved chat. */
export function deleteSession(id: SessionId, done: OnReply<Acknowledged>): void {
  send(call(route("DELETE", sessionPath(id), "session-delete"), null, acknowledged), done);
}

/** Deletes every saved chat. */
export function clearSessions(done: OnReply<Acknowledged>): void {
  send(call(route("DELETE", "/v1/ui/sessions", "sessions-clear"), null, acknowledged), done);
}

/** Tells the sidecar which chat is open, or none. */
export function setCurrentSession(id: SessionId | null, done: OnReply<Acknowledged>): void {
  send(call(route("PUT", "/v1/ui/current-session", "current-session", true), { id }, acknowledged), done);
}

/** Writes the chat archive to the fixed folder and reveals it; the sidecar answers with the file's path. */
export function exportChatLogs(done: OnReply<{ readonly path: string; readonly sessions: number }>): void {
  send(call(route("POST", "/v1/ui/chat-logs/export", "chat-export"), {}, chatExportDecoder), done);
}
