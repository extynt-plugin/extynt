// The fields learning reads from an applied plan step and its outcome row, decoded leniently so a malformed field is skipped rather than fatal.
import { array, fallback, map, number, object, string, union } from "@extynt/decode";
import type { Decoder, Infer } from "@extynt/decode";
import { noteValueDecoder } from "./effect-notes-value.js";
import type { NoteValue } from "./effect-notes-types.js";

const MAX_KEYFRAMES = 1024;
const MAX_RANGES = 64;

function listOf<T, Fallback>(item: Decoder<T>, input: { limit: number; fallback: Fallback }): Decoder<Array<T | Fallback>> {
  return fallback(map(array(fallback(item, input.fallback)), (items) => items.slice(0, input.limit)), []);
}

const text = fallback(string({ nonEmpty: true }), undefined);
const finite = fallback(number(), undefined);

/** A static number or two to four numbers: the only values worth a statistic. Booleans, strings and menus become undefined. */
export const staticValue: Decoder<NoteValue | undefined> = fallback(noteValueDecoder, undefined);

const easeSpec = object({ influence: finite, speed: finite });
const easeSpecs: Decoder<EaseSpec[]> = fallback(union(map(array(fallback(easeSpec, undefined)), (specs) => specs.flatMap((spec) => spec ?? [])), map(easeSpec, (spec) => [spec])), []);

type EaseSpec = Infer<typeof easeSpec>;

const curvePoints = object({ x1: finite, y1: finite, x2: finite, y2: finite });

const keyframeFacts = object({
  time: finite, value: staticValue, ease: fallback(object({ in: easeSpecs, out: easeSpecs }), undefined),
  curve: fallback(union(string(), curvePoints), undefined), interpolation: fallback(object({ outType: fallback(string(), undefined), inType: fallback(string(), undefined) }), undefined),
});

/** One keyframe of an animate step, as learning reads it. */
export type KeyframeFacts = Infer<typeof keyframeFacts>;

const NO_KEYFRAME: KeyframeFacts = { time: undefined, value: undefined, ease: undefined, curve: undefined, interpolation: undefined };

/** A keyframe entry, or an empty one when the entry is not an object, so positions in the list never shift. */
export const keyframeOrNone: Decoder<KeyframeFacts> = fallback(keyframeFacts, NO_KEYFRAME);
const landing = object({ layerId: text, propertyPath: text });

/** The fields of a plan step that learning reads. */
export const stepFacts = object({
  type: text, effectMatchName: text, presetId: text, propertyPath: text, role: fallback(string(), undefined), font: text, value: staticValue,
  target: fallback(landing, undefined), keyframes: listOf(keyframeOrNone, { limit: MAX_KEYFRAMES, fallback: NO_KEYFRAME }),
  characterRanges: listOf(object({ font: text }), { limit: MAX_RANGES, fallback: undefined }),
});

/** A decoded plan step. */
export type StepFacts = Infer<typeof stepFacts>;

const outcomeFacts = object({ outcome: fallback(string(), undefined), type: text, targets: fallback(landing, undefined) });

/** A decoded outcome row. */
export type OutcomeFacts = Infer<typeof outcomeFacts>;

/** The outcome rows of an apply receipt, in plan order; a row that is not an object is undefined. */
export const receiptFacts = object({ status: fallback(string(), undefined), postcondition: fallback(string(), undefined), operationOutcomes: fallback(listOf(fallback(outcomeFacts, undefined), { limit: 200, fallback: undefined }), []) });
