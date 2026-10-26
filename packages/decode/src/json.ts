// The one JSON value type and its decoders: any JSON value, a bounded variant for hostile input, and the wire form of a plain value.
import type { Decoder } from "./decoder.js";
import { Failure, fail, within } from "./failure.js";
import { isArray, isRecord } from "./guards.js";
import type { KeyedInput } from "./guards.js";

/** Any value JSON can carry; numbers are finite and containers are read-only. */
export type JsonValue = null | boolean | number | string | JsonArray | JsonObject;

/** A JSON array. */
export interface JsonArray extends ReadonlyArray<JsonValue> {}

/** A JSON object with open keys; reading a key gives `JsonValue | undefined`. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** How many arrays or objects `jsonValue` allows inside one another. */
export const JSON_NESTING_LIMIT = 128;

const CARRIES_JSON = "value JSON can carry";

function readItems(items: ReadonlyArray<unknown>, levels: number): JsonArray | Failure {
  const read: JsonValue[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = readJson(items[index], levels);
    if (item instanceof Failure) return within(item, index);
    read.push(item);
  }
  return read;
}

function readFields(fields: KeyedInput, levels: number): JsonObject | Failure {
  const read: Array<[string, JsonValue]> = [];
  for (const key of Object.keys(fields)) {
    const field = readJson(fields[key], levels);
    if (field instanceof Failure) return within(field, key);
    read.push([key, field]);
  }
  return Object.fromEntries(read);
}

function readContainer(input: ReadonlyArray<unknown> | KeyedInput, levels: number): JsonValue | Failure {
  if (levels <= 0) return fail("JSON nested less deeply", input);
  return isArray(input) ? readItems(input, levels - 1) : readFields(input, levels - 1);
}

function readJson(input: unknown, levels: number): JsonValue | Failure {
  if (input === null || typeof input === "boolean" || typeof input === "string") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : fail("finite number", input);
  return isArray(input) || isRecord(input) ? readContainer(input, levels) : fail("JSON value", input);
}

/** Accepts any JSON value nested at most `levels` arrays or objects deep, so hostile nesting cannot exhaust the stack; object keys such as `__proto__` stay plain data. */
export function jsonValueWithin(levels: number): Decoder<JsonValue> {
  return { run: (input) => readJson(input, levels) };
}

/** Accepts any JSON value up to `JSON_NESTING_LIMIT` levels deep; non-finite numbers and `undefined` fields are rejected, so the output is exactly what `JSON.stringify` could write. */
export const jsonValue: Decoder<JsonValue> = jsonValueWithin(JSON_NESTING_LIMIT);

/** Accepts a JSON object whatever its contents; any other JSON value is rejected. */
export const jsonObject: Decoder<JsonObject> = {
  run: (input) => (isRecord(input) ? readFields(input, JSON_NESTING_LIMIT) : fail("object", input)),
};

/** True when a JSON value is an object, not a scalar, an array or absent. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a JSON value is an array. */
export function isJsonArray(value: JsonValue | undefined): value is JsonArray {
  return Array.isArray(value);
}

function serialized(input: unknown): string | undefined {
  try {
    const text: string | undefined = JSON.stringify(input);
    return text;
  } catch {
    return undefined;
  }
}

/** Accepts any plain value and yields what it would be on the wire: `undefined` fields are dropped, non-finite numbers become `null`, `toJSON` is honoured; a value JSON cannot carry (a function, a cycle, a bigint) is rejected. */
export const wireJson: Decoder<JsonValue> = {
  run(input) {
    const text = serialized(input);
    if (text === undefined) return fail(CARRIES_JSON, input);
    const wire: unknown = JSON.parse(text);
    return readJson(wire, JSON_NESTING_LIMIT);
  },
};
