// Writes one note: resolves the effect, enforces the opt-in and the admission rules, stores it and reads the result back.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { execute } from "./graph-sql.js";
import { admitNote, requireKnownControl, retireNote } from "./effect-notes-admit.js";
import { aeBuildOf, resolveEffect } from "./effect-notes-effect.js";
import type { NoteWriteRequest } from "./effect-notes-input.js";
import { pluginDocumented, readNotesFor, refusal } from "./effect-notes-read.js";
import { EffectNotesError, type EffectRef, type NoteKind, type NoteView, type NotesReadResponse, type NotesResult } from "./effect-notes-types.js";
import { valueText } from "./effect-notes-value.js";

/** A stored note: the read that follows the write, the note itself, and the note it replaced. */
export type NoteWritten = NotesReadResponse & { written: NoteView; replaced: string | null };

interface Insertion { id: string; effect: EffectRef; kind: NoteKind; request: NoteWriteRequest; at: number }

function insertNote(database: DatabaseSync, row: Insertion): void {
  const { id, effect, kind, request, at } = row;
  execute(database, "INSERT INTO effect_value_notes(id,match_name,control_path,plugin_key,kind,text,value_text,effect_version,ae_build,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,'current',?)",
    id, effect.matchName, request.controlPath, effect.pluginKey, kind, request.text, request.value === null ? null : valueText(request.value), effect.version, aeBuildOf(effect.hostKey), at);
}

function store(database: DatabaseSync, effect: EffectRef, kind: NoteKind, input: { request: NoteWriteRequest; at: number }): NoteWritten {
  const { request, at } = input;
  const target = admitNote(database, { effect, controlPath: request.controlPath, expected: request.expectedNoteIds, replaces: request.replaces, actor: kind === "measured" ? "system" : "agent" });
  const id = randomUUID();
  insertNote(database, { id, effect, kind, request, at });
  if (target && request.reason !== null) retireNote(database, { id: target.id, by: id, reason: request.reason, at });
  const read = readNotesFor(database, effect, request.controlPath), written = read.notes.find((note) => note.id === id);
  if (!written) throw new Error("GRAPH_NOTES_WRITE_LOST");
  return { ...read, written, replaced: target ? target.id : null };
}

function requireDocumented(database: DatabaseSync, effect: EffectRef, kind: NoteKind): void {
  if (kind === "agent-inferred" && !pluginDocumented(database, effect.pluginKey)) throw new EffectNotesError("EFFECT_NOTES_DOCUMENTATION_OFF", `Documenting is off for "${effect.pluginKey}". The user turns it on per plugin ("Document this plugin") in extynt settings; until then do not write notes for it.`);
}

/** One note write. Measured notes come from calibration only (sidecar-internal); agent-inferred notes need the plugin opted in. Refusals write nothing. */
export function writeEffectNote(database: DatabaseSync, input: { request: NoteWriteRequest; kind: NoteKind; at: number }): NotesResult<NoteWritten> {
  let effect: EffectRef | undefined;
  try {
    effect = resolveEffect(database, input.request.matchName);
    requireDocumented(database, effect, input.kind);
    requireKnownControl(database, effect, input.request.controlPath);
    return store(database, effect, input.kind, input);
  } catch (error) {
    if (!(error instanceof EffectNotesError)) throw error;
    return refusal(database, error, effect);
  }
}
