// Decoders for every effect-notes request and usage record: the one place text, numbers and ids are checked before storage.
import { array, boolean, decode, literal, map, number, object, optional, refine, string, taggedUnion, type JsonValue } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { createHash } from "node:crypto";
import { EffectNotesError } from "./effect-notes-types.js";
import { noteValueDecoder } from "./effect-notes-value.js";

const IDENTIFIER_LIMITS = { minLength: 1, maxLength: 512, pattern: /^[^\0]*$/ } as const;
const SLOT_HASH_THRESHOLD = 256;
const NOTE_TEXT_LENGTH = 280;
const REASON_LENGTH = 160;
const EXPECTED_ID_LIMIT = 64;
const AUDIT_LIMIT = 200;
const AUDIT_DEFAULT = 50;

const identifier = string(IDENTIFIER_LIMITS);

function absent<T>(decoder: Decoder<T>): Decoder<T | null> {
  return { run: (input) => (input === undefined || input === null ? null : decoder.run(input)) };
}

function oneLine(maximum: number): Decoder<string> {
  const collapsed = map(string(), (text) => text.replace(/\s+/g, " ").trim());
  return refine(collapsed, (text): text is string => text.length >= 1 && text.length <= maximum && !text.includes("\0"), `text of 1 to ${maximum} characters`);
}

const noteValue = noteValueDecoder;
const expectedNoteIds = map(array(string({ minLength: 1, maxLength: EXPECTED_ID_LIMIT }), { maxLength: EXPECTED_ID_LIMIT }), (ids) => new Set(ids));

function slotKey(slot: string): string {
  return slot.length > SLOT_HASH_THRESHOLD ? createHash("sha256").update(slot).digest("hex") : slot;
}

function slotOr(fallback: string): Decoder<string> {
  return { run: (input) => (input === undefined ? fallback : map(identifier, slotKey).run(input)) };
}

const replacePair = <T extends { replaces: string | null; reason: string | null }>(decoder: Decoder<T>): Decoder<T> =>
  refine(decoder, (request): request is T => (request.replaces === null) === (request.reason === null), "replaces and reason given together");

/** A read of one effect, optionally narrowed to one control. */
export const readRequest = object({ matchName: identifier, controlPath: absent(identifier) });

/** A note write: the note, the notes the writer last read, and optionally the current note it replaces and why. */
export const noteWriteRequest = replacePair(object({
  matchName: identifier, controlPath: absent(identifier), text: oneLine(NOTE_TEXT_LENGTH), value: absent(noteValue),
  expectedNoteIds, replaces: absent(identifier), reason: absent(oneLine(REASON_LENGTH)),
}));

/** Bringing a replaced note back, under the same read-before-write rule as a new note. */
export const restoreRequest = replacePair(object({ noteId: identifier, expectedNoteIds, replaces: absent(identifier), reason: absent(oneLine(REASON_LENGTH)) }));

const auditLimit: Decoder<number> = { run: (input) => (typeof input === "number" && Number.isSafeInteger(input) ? Math.max(1, Math.min(AUDIT_LIMIT, input)) : AUDIT_DEFAULT) };

/** The hidden-history listing: optionally one effect, bounded. */
export const auditRequest = object({ matchName: absent(identifier), limit: auditLimit });

/** What a forget removes: one note, every note of an effect, or every note of a plugin. */
export const forgetRequest = taggedUnion("kind", {
  note: object({ kind: literal("note"), noteId: identifier }),
  effect: object({ kind: literal("effect"), matchName: identifier }),
  plugin: object({ kind: literal("plugin"), pluginKey: identifier }),
});

/** Turning "document this plugin" on or off. */
export const optInRequest = object({ pluginKey: identifier, enabled: boolean() });

const shortName = string({ minLength: 1, maxLength: 64, pattern: IDENTIFIER_LIMITS.pattern });
const usageKind = literal("effect", "font", "preset");

/** A kept control value, checked. */
export const keptUsageRecord = object({ planId: identifier, matchName: identifier, controlPath: identifier, value: noteValue, slot: slotOr(""), at: optional(number()) });

/** A control value seen in a snapshot, checked. */
export const seenUsageRecord = object({ matchName: identifier, controlPath: identifier, value: noteValue, key: map(identifier, slotKey), at: optional(number()) });

/** An effect, font or preset a verified plan used, checked. */
export const keptEventRecord = object({ planId: identifier, kind: usageKind, name: identifier, slot: slotOr(""), at: optional(number()) });

/** An effect, font or preset an accepted snapshot showed, checked. */
export const seenEventRecord = object({ kind: usageKind, name: identifier, key: map(identifier, slotKey), at: optional(number()) });

/** One animated property of a verified plan, checked. */
export const habitSampleRecord = object({
  planId: identifier, slot: slotOr("-"), propertyKind: shortName, duration: number({ min: 1e-6, max: 86400 }), keyframes: number({ min: 2, max: 1024, int: true }),
  easing: shortName, influence: absent(number({ min: 0.1, max: 100 })), at: optional(number()),
});

/** A checked kept control value. */
export type KeptUsageRecord = Infer<typeof keptUsageRecord>;
/** A checked seen control value. */
export type SeenUsageRecord = Infer<typeof seenUsageRecord>;
/** A checked kept event. */
export type KeptEventRecord = Infer<typeof keptEventRecord>;
/** A checked seen event. */
export type SeenEventRecord = Infer<typeof seenEventRecord>;
/** A checked habit sample. */
export type HabitSampleRecord = Infer<typeof habitSampleRecord>;
/** A checked note write. */
export type NoteWriteRequest = Infer<typeof noteWriteRequest>;
/** A checked restore. */
export type RestoreRequest = Infer<typeof restoreRequest>;
/** A checked audit. */
export type AuditRequest = Infer<typeof auditRequest>;
/** A checked forget scope. */
export type ForgetRequest = Infer<typeof forgetRequest>;
/** A checked opt-in change. */
export type OptInRequest = Infer<typeof optInRequest>;

/** Decodes a request or throws the coded refusal `EFFECT_NOTES_INVALID` naming the offending field. */
export function checked<T>(decoder: Decoder<T>, input: JsonValue): T {
  const result = decode(decoder, input);
  if (!result.ok) throw new EffectNotesError("EFFECT_NOTES_INVALID", result.error.message);
  return result.value;
}
