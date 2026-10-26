// Classifies what a graph database operation threw: a lock another sidecar holds, an unusable file, or a coded refusal.
import { fallback, map, number, object, string, type Decoder } from "@extynt/decode";

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const RESULT_CODE_MASK = 0xff;
const failureFacts = object({ errcode: fallback(number(), undefined), message: fallback(string(), "") });
const NO_FAILURE: GraphFailure = { sqliteCode: undefined, message: "" };

/** What a thrown value says: its SQLite result code, extended codes reduced to the primary one, and its message. */
export interface GraphFailure { sqliteCode: number | undefined; message: string }

/** Reads a thrown value into the facts the store classifies it by; anything unreadable says nothing. */
export const graphFailure: Decoder<GraphFailure> = fallback(
  map(failureFacts, (facts) => ({ sqliteCode: facts.errcode === undefined ? undefined : facts.errcode & RESULT_CODE_MASK, message: facts.message })),
  NO_FAILURE,
);

/** SQLITE_BUSY and SQLITE_LOCKED, including extended codes: a lock another sidecar holds. */
export function isLockContention(failure: GraphFailure): boolean {
  return failure.sqliteCode === SQLITE_BUSY || failure.sqliteCode === SQLITE_LOCKED;
}

/** The code that disables the store for the process, or null when the failure only fails the write it came from. */
export function persistentGraphError(failure: GraphFailure): string | null {
  if (/^GRAPH_(FILE|SCHEMA)_[A-Z_]+$/.test(failure.message)) return failure.message;
  return failure.sqliteCode === SQLITE_CORRUPT || failure.sqliteCode === SQLITE_NOTADB ? "GRAPH_FILE_INVALID" : null;
}

/** The store's own error code when the failure carries one, otherwise GRAPH_STORAGE_UNAVAILABLE. */
export function graphErrorCode(failure: GraphFailure): string {
  return /^GRAPH_[A-Z_]+$/.test(failure.message) ? failure.message : "GRAPH_STORAGE_UNAVAILABLE";
}
