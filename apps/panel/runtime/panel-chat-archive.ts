/**
 * The automatic append-only chat log: every message revision of a stored chat is sent to the sidecar once, so the archive
 * the "Save chat log" button exports always holds what the panel showed. The bookkeeping fields (_log*) ride on the stored
 * messages themselves and are never part of what the archive records.
 */
import { diagnosticId, later, pollContext, send } from "./panel-transport.js";
import { decode, jsonObject, type JsonObject } from "@extynt/decode";
import { acknowledged } from "./wire-decoders.js";
import type { SessionId } from "./ids.js";
import type { TranscriptRow } from "./transcript.js";
import { dispatch } from "./ui-state.js";

/** A chat as the archive sees it: its rows, and what has been recorded of the chat and of each row. */
export interface ArchivedSession {
  readonly id: SessionId;
  title: string;
  createdAt: number;
  readonly messages: TranscriptRow[];
  logSequence: number;
  headerRevision: number;
  headerFingerprint: string;
  headerAckRevision: number;
}

type AutoLogEvent = { readonly type: "session" | "message"; readonly eventId: string; readonly revision: number; readonly data: JsonObject };

const inFlight = new Set<string>();
const retries = new Map<string, number>();
const MAX_RETRIES = 3;
const RETRY_STEP_MS = 1500;
const HASH_SEED = 5381;
const HASH_FACTOR = 33;

function fingerprint(text: string): string {
  let hash = HASH_SEED;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * HASH_FACTOR) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(16) + ":" + text.length;
}

function publicFields(message: TranscriptRow) {
  return Object.fromEntries(Object.entries(message).filter(([key]) => !key.startsWith("_log")));
}

function headerEvent(session: ArchivedSession): AutoLogEvent[] {
  const data: JsonObject = { id: session.id, name: session.title || "", createdAt: session.createdAt || null };
  const print = fingerprint(JSON.stringify(data));
  if (session.headerFingerprint !== print) {
    session.headerFingerprint = print;
    session.headerRevision += 1;
  }
  return session.headerAckRevision < session.headerRevision ? [{ type: "session", eventId: "session", revision: session.headerRevision, data }] : [];
}

function stamp(session: ArchivedSession, message: TranscriptRow, fields: JsonObject): number {
  if (!message._logId) {
    session.logSequence += 1;
    message._logId = "message-" + session.logSequence;
  }
  const print = fingerprint(JSON.stringify(fields));
  if (message._logFingerprint !== print) {
    message._logFingerprint = print;
    message._logRevision = (message._logRevision ?? 0) + 1;
  }
  return message._logRevision ?? 0;
}

function messageEvent(session: ArchivedSession, message: TranscriptRow): AutoLogEvent | null {
  if (message.transient === true) return null;
  const fields = publicFields(message);
  const revision = stamp(session, message, fields);
  if ((message._logAckRevision ?? 0) >= revision) return null;
  const data = decode(jsonObject, fields);
  if (data.ok) return { type: "message", eventId: message._logId ?? "", revision, data: data.value };
  dispatch({ type: "dropped", what: "chatLogEvents" });
  return null;
}

function prepare(session: ArchivedSession): AutoLogEvent[] {
  if (!session.messages.length) return [];
  const events = headerEvent(session);
  for (const message of session.messages) {
    const event = messageEvent(session, message);
    if (event) events.push(event);
  }
  return events;
}

function acknowledge(session: ArchivedSession, events: ReadonlyArray<AutoLogEvent>): void {
  for (const event of events) {
    if (event.type === "session") {
      session.headerAckRevision = Math.max(session.headerAckRevision, event.revision);
      continue;
    }
    const message = session.messages.find((entry) => entry._logId === event.eventId);
    if (message) message._logAckRevision = Math.max(message._logAckRevision ?? 0, event.revision);
  }
}

function retryLater(session: ArchivedSession, onAcknowledged: () => void): void {
  const attempts = retries.get(session.id) ?? 0;
  if (attempts >= MAX_RETRIES) return;
  retries.set(session.id, attempts + 1);
  later(() => archiveSession(session, onAcknowledged), RETRY_STEP_MS * (attempts + 1));
}

/** Sends what the archive has not yet recorded for this session; a failure is retried a few times, then left for the next save. */
export function archiveSession(session: ArchivedSession, onAcknowledged: () => void): void {
  const events = prepare(session);
  if (!events.length || inFlight.has(session.id)) return;
  inFlight.add(session.id);
  const body = { schemaVersion: "extynt.chat-log/0.1", sessionId: session.id, name: session.title || "", events };
  send({ method: "POST", path: "/v1/chat-logs", body, context: pollContext("POST", "/v1/chat-logs", diagnosticId("chat-log")), decoder: acknowledged }, (reply) => {
    inFlight.delete(session.id);
    if (reply.ok) {
      retries.set(session.id, 0);
      acknowledge(session, events);
      onAcknowledged();
      return;
    }
    retryLater(session, onAcknowledged);
  });
}
