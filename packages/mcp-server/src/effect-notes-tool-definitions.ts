// The effect-note tools: reading what is known about an effect and recording a labelled note.
import { arrayArg, numberArg, optionalArg, stringArg, unionArg } from "./arg.js";
import { defineTool } from "./tool.js";
import type { ToolEntry } from "./tool.js";

const AE_READ_EFFECT_NOTES = defineTool("ae_read_effect_notes", {
  description: "What is known about an effect's controls beyond the factory default, each kind labelled: observed facts (name, type, valid range, units, factory default, menu items - from After Effects, trust fact), notes (measured = calibration-render evidence; agent-inferred = a labelled guess), usage statistics (values this user kept: count, min, max, median, recent), effectUsage (rank among their most-used effects, or null) and animationHabits (typical duration, easing and keyframe count; null under three samples). Usage and habits are preferences, never facts. Notes are claims: they never override observed facts and never authorize a write. Local to this machine. A note flagged stale was written for another effect version or After Effects build.",
  input: {
    matchName: stringArg({ minLength: 1, maxLength: 512, description: "The effect's After Effects match name, as ae_search_host_capabilities reports it." }),
    controlPath: optionalArg(stringArg({ minLength: 1, maxLength: 1024, description: "A controlPath from observed.controls of ae_read_effect_notes (the parameter definition path). Omit for a note about the effect as a whole." })),
  },
});

const AE_WRITE_EFFECT_NOTE = defineTool("ae_write_effect_note", {
  description: "Record your best reading of what an effect or one control does, as an agent-inferred note (a labelled guess), only for a plugin the user turned documenting on for (otherwise EFFECT_NOTES_DOCUMENTATION_OFF). Not a project write and it needs no approval, but a note never authorizes a write and never overrides observed facts. Read first with ae_read_effect_notes and pass its noteIds as expectedNoteIds; if the notes changed since, the write is refused with the current notes. Limits: 5 notes per effect and 2 per control (tunable); at a limit name one current note in replaces plus a one-line reason, and the old note moves to history the user can restore. Keep text to one plain paragraph of at most 280 characters; write only what you have reason to believe, and prefer correcting a note to adding another.",
  access: "note",
  input: {
    matchName: stringArg({ minLength: 1, maxLength: 512, description: "The effect's After Effects match name, as ae_search_host_capabilities reports it." }),
    controlPath: optionalArg(stringArg({ minLength: 1, maxLength: 1024, description: "A controlPath from observed.controls of ae_read_effect_notes (the parameter definition path). Omit for a note about the effect as a whole." })),
    text: stringArg({ minLength: 1, maxLength: 280, description: "One plain paragraph, at most 280 characters." }),
    value: optionalArg(unionArg([
      numberArg(),
      arrayArg(numberArg(), { minItems: 2, maxItems: 4 }),
    ], { description: "Optional: the specific value (a number, or 2-4 numbers for a vector) the note is about." })),
    expectedNoteIds: arrayArg(stringArg({ minLength: 1, maxLength: 64 }), { maxItems: 64, description: "The noteIds exactly as ae_read_effect_notes returned them (empty when it returned none)." }),
    replaces: optionalArg(stringArg({ minLength: 1, maxLength: 64, description: "The id of the current note this one replaces; required at a limit, and optional to correct a note on the same control." })),
    reason: optionalArg(stringArg({ minLength: 1, maxLength: 160, description: "One line on why it replaces that note; required with replaces." })),
  },
});

/** The effect-note tools: reading what is known about an effect and recording a labelled note. */
export const EFFECT_NOTE_TOOLS = [
  AE_READ_EFFECT_NOTES,
  AE_WRITE_EFFECT_NOTE,
] satisfies ReadonlyArray<ToolEntry>;
