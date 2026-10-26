/**
 * Decoders for the raw values `runner/questions*.jsx` record for each open question.
 *
 * Every decoder is lenient on purpose: an interrupted probe records what it had, so a
 * member that is missing or mistyped reads as absent and the rule that derives the
 * finding says what could not be read instead of failing the whole report.
 */
import { boolean, decodeOrThrow, map, number, object, string, union } from "@extynt/decode";
import type { Decoder, Infer, ObjectOf, Shape } from "@extynt/decode";
import { fallback, isJsonObject, jsonObject, jsonValue, lenient, list } from "./json.js";
import type { JsonObject, JsonValue } from "./json.js";

const shown = lenient(map(union(string(), number(), boolean()), String));
const count = lenient(number());
const recorded = lenient(jsonValue);

function row<S extends Shape>(shape: S): Decoder<ObjectOf<S>> {
  const decoder = object(shape);
  return fallback(decoder, () => decodeOrThrow(decoder, {}));
}
const rowList = <T>(item: Decoder<T>): Decoder<T[]> => fallback<T[]>(list(item), () => []);

const hostReply = row({ ok: lenient(boolean()), mutationState: shown, errorCode: shown, errorMessage: shown });
const transform = row({ position: recorded, scale: recorded, rotation: recorded, anchor: recorded, opacity: recorded });
const sampleRow = row({ t: count, preExpression: recorded, postExpression: recorded, propertyValue: recorded });

const parentCase = row({ label: shown, before: transform, after: transform, host: hostReply });
export const parentCompensation = row({ cases: rowList(parentCase) });

const sampledProperty = row({
  keys: rowList(jsonObject),
  numKeys: shown,
  isTimeVarying: recorded,
  canVaryOverTime: shown,
  expressionEnabled: shown,
  rows: rowList(sampleRow),
});
const keyRangeCase = row({
  label: shown,
  staticValue: recorded,
  keyframes: recorded,
  afterStatic: row({ value: recorded, numKeys: shown }),
  sampled: sampledProperty,
});
/** The decoder for the data of the question measured as `keyRangeValue`. */
export const keyRangeValue = row({ cases: rowList(keyRangeCase) });

const staticWriteCase = row({ label: shown, host: hostReply, numKeysAfter: shown, keysAfter: recorded, sampled: row({ rows: rowList(sampleRow) }) });
/** The decoder for the data of the question measured as `staticOverKeyframes`. */
export const staticOverKeyframes = row({ keyWrite: hostReply, keysBefore: row({ numKeys: shown, keys: recorded }), cases: rowList(staticWriteCase) });

const rect = row({ top: count, left: count, width: count, height: count });
const shapeGroup = row({ name: shown, matchName: shown, children: rowList(row({ matchName: shown })) });
const shapeCase = row({ label: shown, host: hostReply, rect, contents: rowList(shapeGroup) });
/** The decoder for the data of the question measured as `shapeWithoutPaint`. */
export const shapeWithoutPaint = row({ cases: rowList(shapeCase) });

const colourCase = row({ label: shown, host: hostReply, readBack: recorded, eightBitPrediction: recorded, dimensions: count });
/** The decoder for the data of the question measured as `effectColourPrecision`. */
export const effectColourPrecision = row({ sent: recorded, composition: row({ write: hostReply, readBack: recorded }), cases: rowList(colourCase) });

/** The members of a question's recorded data; anything that is not an object reads as nothing recorded. */
export function questionData<T>(decoder: Decoder<T>, data: JsonValue | undefined): T {
  return decodeOrThrow(decoder, isJsonObject(data) ? data : {});
}

/** The reads the probe itself marked unanswered, as text. */
export function unansweredOf(data: JsonValue | undefined): string[] {
  const members: JsonObject = isJsonObject(data) ? data : {};
  const entries = members.unanswered;
  return Array.isArray(entries) ? entries.map(String) : [];
}

/** A host reply summary: whether it applied, or why it was refused. */
export type HostReply = Infer<typeof hostReply>;
/** One parenting case. */
export type ParentCase = Infer<typeof parentCompensation>["cases"][number];
/** One sampled time of a keyframed property. */
export type SampleRow = Infer<typeof sampleRow>;
/** One key-range case. */
export type KeyRangeCase = Infer<typeof keyRangeValue>["cases"][number];
/** One static-write case. */
export type StaticWriteCase = Infer<typeof staticOverKeyframes>["cases"][number];
/** One shape-bounds case. */
export type ShapeCase = Infer<typeof shapeWithoutPaint>["cases"][number];
/** One effect-colour case. */
export type ColourCase = Infer<typeof effectColourPrecision>["cases"][number];

/** A colour case with nothing recorded, for a probe that recorded no cases. */
export const NO_COLOUR_CASE: ColourCase = decodeOrThrow(colourCase, {});
