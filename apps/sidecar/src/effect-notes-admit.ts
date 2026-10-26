// The admission rules for a note: read-before-write, the per-effect and per-control caps, and what a replacement may displace.
import type { DatabaseSync } from "node:sqlite";
import { execute } from "./graph-sql.js";
import { observedControls } from "./effect-notes-observed.js";
import { currentNoteRows, type NoteRow } from "./effect-notes-read.js";
import { EffectNotesError, effectNoteCaps, type EffectRef } from "./effect-notes-types.js";
import { sameSet } from "./effect-notes-value.js";

interface AdmitInput {
  effect: EffectRef; controlPath: string | null; expected: ReadonlySet<string>; replaces: string | null;
  actor: "agent" | "system";
}

interface Overflow { effect: boolean; control: boolean }

function replaceInvalid(message: string): never {
  throw new EffectNotesError("EFFECT_NOTES_REPLACE_INVALID", message);
}

/** A note about a control needs that control's observed definition; a group row has no value to document. */
export function requireKnownControl(database: DatabaseSync, effect: EffectRef, controlPath: string | null): void {
  if (controlPath === null) return;
  const observed = observedControls(database, effect, controlPath);
  if (!observed.probed) throw new EffectNotesError("EFFECT_NOTES_INVALID", "This effect's controls have not been learned yet, so only an effect-level note (no controlPath) can be written.");
  const control = observed.controls[0];
  if (!control || control.group) throw new EffectNotesError("EFFECT_NOTES_INVALID", "controlPath is not a value control of this effect on this host; use a controlPath from observed.controls.");
}

function replacementTarget(current: ReadonlyArray<NoteRow>, input: AdmitInput, over: Overflow): NoteRow {
  const target = current.find((row) => row.id === input.replaces);
  if (!target) return replaceInvalid("replaces must be the id of one of this effect's current notes.");
  if ((over.control || !over.effect) && target.control_path !== input.controlPath) return replaceInvalid("replaces must name a current note on the same control.");
  if (input.actor === "agent" && target.kind === "measured") return replaceInvalid("A measured note is evidence from calibration; an agent-inferred note cannot replace it.");
  return target;
}

function capRefusal(over: Overflow): EffectNotesError {
  const noun = over.control ? "control has" : "effect has";
  return new EffectNotesError("EFFECT_NOTES_CAP_REACHED", `This ${noun} reached its note limit; name one current note in replaces with a one-line reason to swap it out.`, over.control ? "control" : "effect");
}

/** The read-before-write check, the caps and the replace rules, run before anything is stored. Returns the current note being replaced, if any. */
export function admitNote(database: DatabaseSync, input: AdmitInput): NoteRow | null {
  const current = currentNoteRows(database, input.effect.matchName);
  if (!sameSet(new Set(current.map((row) => row.id)), input.expected)) throw new EffectNotesError("EFFECT_NOTES_STALE", "The effect's notes changed since you read them; the current notes are returned. Re-check them and retry with their noteIds as expectedNoteIds.");
  const caps = effectNoteCaps();
  const over = { effect: current.length >= caps.perEffect, control: input.controlPath !== null && current.filter((row) => row.control_path === input.controlPath).length >= caps.perControl };
  if (input.replaces !== null) return replacementTarget(current, input, over);
  if (over.control || over.effect) throw capRefusal(over);
  return null;
}

/** Moves a current note to hidden history. */
export function retireNote(database: DatabaseSync, input: { id: string; by: string; reason: string; at: number }): void {
  execute(database, "UPDATE effect_value_notes SET state='replaced',replaced_by=?,replace_reason=?,replaced_at=? WHERE id=? AND state='current'", input.by, input.reason, input.at, input.id);
}
