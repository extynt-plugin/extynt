// The user's side of notes: hidden history, restoring a replaced note, and forgetting notes for good.
import type { DatabaseSync } from "node:sqlite";
import { execute, selectAll, selectOne } from "./graph-sql.js";
import { admitNote, retireNote } from "./effect-notes-admit.js";
import { resolveEffect } from "./effect-notes-effect.js";
import type { AuditRequest, ForgetRequest, RestoreRequest } from "./effect-notes-input.js";
import { historyView, noteRow, readNotesFor, refusal } from "./effect-notes-read.js";
import { EffectNotesError, type EffectRef, type HistoryNoteView, type NoteView, type NotesReadResponse, type NotesResult } from "./effect-notes-types.js";

const FORGET_SQL = {
  note: "DELETE FROM effect_value_notes WHERE id=?",
  effect: "DELETE FROM effect_value_notes WHERE match_name=?",
  plugin: "DELETE FROM effect_value_notes WHERE plugin_key=?",
} as const;

function effectFor(database: DatabaseSync, matchName: string): EffectRef | undefined {
  try {
    return resolveEffect(database, matchName);
  } catch (error) {
    if (error instanceof EffectNotesError) return undefined;
    throw error;
  }
}

/** Hidden history for the user: replaced notes, newest first and bounded. Never reaches the agent read. */
export function auditNotes(database: DatabaseSync, request: AuditRequest): NotesResult<{ notes: HistoryNoteView[] }> {
  const rows = selectAll(database, "SELECT * FROM effect_value_notes WHERE state='replaced' AND (?1 IS NULL OR match_name=?1) ORDER BY replaced_at DESC,id LIMIT ?2", noteRow, request.matchName, request.limit);
  const effects = new Map<string, EffectRef | undefined>();
  const notes = rows.map((row) => {
    if (!effects.has(row.match_name)) effects.set(row.match_name, effectFor(database, row.match_name));
    return historyView(row, effects.get(row.match_name));
  });
  return { ok: true, notes, writeAuthorizing: false };
}

/** Brings a replaced note back as current. It obeys the same read-before-write and caps as a new note; at the cap it must replace another. */
export function restoreNote(database: DatabaseSync, input: { request: RestoreRequest; at: number }): NotesResult<NotesReadResponse & { restored: NoteView }> {
  const { request, at } = input;
  let effect: EffectRef | undefined;
  try {
    const row = selectOne(database, "SELECT * FROM effect_value_notes WHERE id=? AND state='replaced'", noteRow, request.noteId);
    if (!row) throw new EffectNotesError("EFFECT_NOTES_NOT_FOUND", "No replaced note has that id.");
    effect = resolveEffect(database, row.match_name);
    const target = admitNote(database, { effect, controlPath: row.control_path, expected: request.expectedNoteIds, replaces: request.replaces, actor: "system" });
    execute(database, "UPDATE effect_value_notes SET state='current',replaced_by=NULL,replace_reason=NULL,replaced_at=NULL WHERE id=?", row.id);
    if (target && request.reason !== null) retireNote(database, { id: target.id, by: row.id, reason: request.reason, at });
    const read = readNotesFor(database, effect, row.control_path), restored = read.notes.find((note) => note.id === row.id);
    if (!restored) throw new Error("GRAPH_NOTES_RESTORE_LOST");
    return { ...read, restored };
  } catch (error) {
    if (!(error instanceof EffectNotesError)) throw error;
    return refusal(database, error, effect);
  }
}

function forgetTarget(scope: ForgetRequest): string {
  if (scope.kind === "note") return scope.noteId;
  return scope.kind === "effect" ? scope.matchName : scope.pluginKey;
}

/** Hard delete: one note (history or current), every note of an effect, or every note of a plugin. Usage is forgotten separately. */
export function forgetNotes(database: DatabaseSync, scope: ForgetRequest): NotesResult<{ removed: number }> {
  return { ok: true, removed: execute(database, FORGET_SQL[scope.kind], forgetTarget(scope)), writeAuthorizing: false };
}
