// Reads an effect's notes: observed facts, current notes with their staleness, computed usage, and the coded refusals that carry them.
import { literal, nullable, number, object, string, type JsonValue } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import type { DatabaseSync } from "node:sqlite";
import { selectAll, selectOne } from "./graph-sql.js";
import { aeBuildOf, resolveEffect } from "./effect-notes-effect.js";
import { effectUsageOf } from "./effect-notes-events.js";
import { checked, readRequest } from "./effect-notes-input.js";
import { observedControls } from "./effect-notes-observed.js";
import { readUsage } from "./effect-notes-usage-read.js";
import { parseValueText } from "./effect-notes-value.js";
import { EffectNotesError, effectNoteCaps, type EffectRef, type HistoryNoteView, type NoteFailure, type NoteView, type NotesReadResponse, type NotesResult } from "./effect-notes-types.js";

/** The stored shape of a note row. */
export const noteRow = object({
  id: string(), match_name: string(), control_path: nullable(string()), plugin_key: string(), kind: literal("measured", "agent-inferred"), text: string(),
  value_text: nullable(string()), effect_version: nullable(string()), ae_build: string(), state: literal("current", "replaced"), created_at: number(),
  replaced_by: nullable(string()), replace_reason: nullable(string()), replaced_at: nullable(number()),
});

/** One decoded note row. */
export type NoteRow = Infer<typeof noteRow>;

const presentRow = object({ present: number() });
const WITH_CURRENT = new Set(["EFFECT_NOTES_STALE", "EFFECT_NOTES_CAP_REACHED", "EFFECT_NOTES_REPLACE_INVALID"]);

const OBSERVED_RANGE_NOTE = "Range as reported by After Effects: minimum/maximum are the valid range of the property, not the narrower slider range its UI shows (scripts cannot see that). units is the label After Effects reports, null when it reports none. defaultPosition is where the factory default sits in that range (0 to 1).";

/** A coded refusal as the response shape, with the current notes when a retry needs them. */
export function noteFailure(error: EffectNotesError, current?: NotesReadResponse): NoteFailure {
  return { ok: false, code: error.code, message: error.message, ...(error.cap ? { cap: error.cap } : {}), ...(current ? { current } : {}), writeAuthorizing: false };
}

/** A refusal; the ones a retry needs the notes for carry them. */
export function refusal(database: DatabaseSync, error: EffectNotesError, effect: EffectRef | undefined): NoteFailure {
  return noteFailure(error, effect && WITH_CURRENT.has(error.code) ? readNotesFor(database, effect, null) : undefined);
}

function staleness(row: NoteRow, effect: EffectRef | undefined): Pick<NoteView, "stale" | "staleReason"> {
  if (!effect) return { stale: false, staleReason: null };
  if (row.effect_version !== effect.version) return { stale: true, staleReason: "effect-version" };
  if (row.ae_build !== aeBuildOf(effect.hostKey)) return { stale: true, staleReason: "ae-build" };
  return { stale: false, staleReason: null };
}

function noteView(row: NoteRow, effect: EffectRef | undefined): NoteView {
  return {
    id: row.id, kind: row.kind, trust: row.kind === "measured" ? "evidence" : "labelled-guess", controlPath: row.control_path, text: row.text, value: parseValueText(row.value_text),
    effectVersion: row.effect_version, aeBuild: row.ae_build, createdAt: row.created_at, ...staleness(row, effect),
  };
}

/** A note as the user's audit sees it. */
export function historyView(row: NoteRow, effect: EffectRef | undefined): HistoryNoteView {
  return { ...noteView(row, effect), state: row.state, replacedBy: row.replaced_by, replaceReason: row.replace_reason, replacedAt: row.replaced_at, matchName: row.match_name, pluginKey: row.plugin_key };
}

/** The current notes of an effect, oldest first. */
export function currentNoteRows(database: DatabaseSync, matchName: string): ReadonlyArray<NoteRow> {
  return selectAll(database, "SELECT * FROM effect_value_notes WHERE match_name=? AND state='current' ORDER BY created_at,id", noteRow, matchName);
}

/** Whether the user has turned on "Document this plugin". */
export function pluginDocumented(database: DatabaseSync, pluginKey: string): boolean {
  return selectOne(database, "SELECT 1 AS present FROM effect_note_plugin_optin WHERE plugin_key=?", presentRow, pluginKey) !== undefined;
}

/** The read an agent works from: observed facts first and separate, then labelled notes, then computed usage. */
export function readNotesFor(database: DatabaseSync, effect: EffectRef, controlPath: string | null): NotesReadResponse {
  const notes = currentNoteRows(database, effect.matchName).map((row) => noteView(row, effect));
  return {
    ok: true, effect: { matchName: effect.matchName, displayName: effect.displayName, category: effect.category, version: effect.version, pluginKey: effect.pluginKey },
    host: { key: effect.hostKey, aeBuild: aeBuildOf(effect.hostKey) }, observed: { trust: "fact", rangeNote: OBSERVED_RANGE_NOTE, ...observedControls(database, effect, controlPath) },
    notes, noteIds: notes.map((note) => note.id), usage: readUsage(database, effect.matchName, controlPath), effectUsage: effectUsageOf(database, effect.matchName), animationHabits: null, caps: effectNoteCaps(),
    documentationEnabled: pluginDocumented(database, effect.pluginKey), writeAuthorizing: false,
  };
}

/** The agent's read of an effect, or the coded refusal for an invalid request or an unknown effect. */
export function readEffectNotes(database: DatabaseSync, input: JsonValue): NotesReadResponse | NoteFailure {
  try {
    const request = checked(readRequest, input);
    return readNotesFor(database, resolveEffect(database, request.matchName), request.controlPath);
  } catch (error) {
    if (error instanceof EffectNotesError) return noteFailure(error);
    throw error;
  }
}

/** Decodes a raw request, then runs the work; an invalid request or a domain refusal comes back as the coded failure. */
export function withRequest<Request, Result>(decoder: Decoder<Request>, input: JsonValue, work: (request: Request) => NotesResult<Result>): NotesResult<Result> {
  try {
    return work(checked(decoder, input));
  } catch (error) {
    if (error instanceof EffectNotesError) return noteFailure(error);
    throw error;
  }
}
