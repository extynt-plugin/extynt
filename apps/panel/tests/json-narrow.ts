/**
 * Narrowing boundary for the panel contract and host-apply suites. Every value these tests read from a host response, a
 * storage blob or an evaluated panel function arrives as text. `readJson` is the single place that text becomes a
 * `JsonValue`; the readers below are the only way it is narrowed again, so no test needs an unchecked assertion on parsed data.
 */
import { decode, decodeJson, decodeOrThrow, jsonValue, type DecodeResult, type Decoder, type JsonObject, type JsonValue } from "@extynt/decode";

/** A value a path read may land on: any JSON value, or nothing when a step of the path is missing. */
export type Found = JsonValue | undefined;

/** One step of a path: an object key or an array index. */
export type Step = string | number;

function describe(value: Found): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/** Parses a JSON document into a `JsonValue`; text that is not JSON throws. */
export function readJson(text: string): JsonValue {
  const outcome = decodeJson(text, jsonValue);
  if (!outcome.ok) throw new TypeError("expected JSON text, received " + text.slice(0, 80));
  return outcome.value;
}

/** Whether the value is a JSON object (not null, not an array). */
export function isRecord(value: Found): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parsed object at `value`, or a thrown error naming what was found instead. */
export function recordOf(value: Found): JsonObject {
  if (!isRecord(value)) throw new TypeError("expected a JSON object, received " + describe(value));
  return value;
}

function isList(value: Found): value is ReadonlyArray<JsonValue> {
  return Array.isArray(value);
}

/** The parsed array at `value`, or a thrown error naming what was found instead. */
export function arrayOf(value: Found): ReadonlyArray<JsonValue> {
  if (!isList(value)) throw new TypeError("expected a JSON array, received " + describe(value));
  return value;
}

function child(current: Found, step: Step): Found {
  if (typeof step === "number") return isList(current) ? current[step] : undefined;
  return isRecord(current) ? current[step] : undefined;
}

/** The value at a field/index path; `undefined` when a step of the path is missing. */
export function fieldOf(value: Found, ...path: Step[]): Found {
  let current = value;
  for (const step of path) current = child(current, step);
  return current;
}

/** The object at a path. */
export function recordAt(value: Found, ...path: Step[]): JsonObject {
  return recordOf(fieldOf(value, ...path));
}

/** The parsed array at `value`, with every element checked to be an object. */
export function recordsOf(value: Found): JsonObject[] {
  return arrayOf(value).map(recordOf);
}

/** The objects of the array at a path. */
export function recordsAt(value: Found, ...path: Step[]): JsonObject[] {
  return recordsOf(fieldOf(value, ...path));
}

/** Records at a path that may legitimately be absent (the `?? []` read): empty when it is. */
export function recordsOr(value: Found, ...path: Step[]): JsonObject[] {
  const found = fieldOf(value, ...path);
  return found === undefined || found === null ? [] : recordsOf(found);
}

/** The array at a path. */
export function listAt(value: Found, ...path: Step[]): ReadonlyArray<JsonValue> {
  return arrayOf(fieldOf(value, ...path));
}

/** The object at a path that may legitimately be absent (the `?? {}` read): empty when it is. */
export function recordOr(value: Found, ...path: Step[]): JsonObject {
  const found = fieldOf(value, ...path);
  return found === undefined || found === null ? {} : recordOf(found);
}

/** The values of the record at a path that may be absent, each checked to be an object. */
export function recordValuesAt(value: Found, ...path: Step[]): JsonObject[] {
  return Object.values(recordOr(value, ...path)).map(recordOf);
}

/** The string at `value`, or a thrown error naming what was found instead. */
export function textOf(value: Found): string {
  if (typeof value !== "string") throw new TypeError("expected a string, received " + describe(value));
  return value;
}

/** The string at a path. */
export function textAt(value: Found, ...path: Step[]): string {
  return textOf(fieldOf(value, ...path));
}

/** A string field, or `fallback` when the field is absent: the `?? ""` read. */
export function textOr(value: Found, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** The string at a path, or `undefined` when it is absent: the `?.field` read. */
export function optionalTextAt(value: Found, ...path: Step[]): string | undefined {
  const found = fieldOf(value, ...path);
  return found === undefined || found === null ? undefined : textOf(found);
}

/** The boolean at `value`, or a thrown error naming what was found instead. */
export function booleanOf(value: Found): boolean {
  if (typeof value !== "boolean") throw new TypeError("expected a boolean, received " + describe(value));
  return value;
}

/** A number field, or `fallback` when the field is absent: the `?? 0` read. */
export function numberOr(value: Found, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/** The number at a path. */
export function numberAt(value: Found, ...path: Step[]): number {
  const found = fieldOf(value, ...path);
  if (typeof found !== "number") throw new TypeError("expected a number, received " + describe(found));
  return found;
}

function settled(outcome: DecodeResult<Found>): Found {
  return outcome.ok ? outcome.value : undefined;
}

function memberOf(key: string, copy: Found): ReadonlyArray<readonly [string, JsonValue]> {
  return copy === undefined ? [] : [[key, copy]];
}

const hostJson: Decoder<Found> = {
  run: (input) => {
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "string" || typeof input === "boolean" || input === null) return input;
    if (typeof input !== "object") return undefined;
    if (Array.isArray(input)) return Array.from(input, (member) => settled(decode(hostJson, member)) ?? null);
    return Object.fromEntries(Object.entries(input).flatMap((entry) => memberOf(entry[0], settled(decode(hostJson, entry[1])))));
  },
};

/** A value the fake host holds copied into plain JSON, as JSON text would carry it (functions and undefined members dropped, non-finite numbers null), but with no prototypes from the vm realm. */
export function plain<Source>(source: Source): JsonValue {
  const copy = decodeOrThrow(hostJson, source);
  if (copy === undefined) throw new TypeError("the value has no JSON form");
  return copy;
}

/** The fields of a JSON object read in the order given, each `undefined` when absent. */
export function fieldsOf(source: Found, keys: ReadonlyArray<string>): Found[] {
  return keys.map((key) => fieldOf(source, key));
}
