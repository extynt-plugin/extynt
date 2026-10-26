// Typed readers for the fields of a JSON object, and the wire form of plain values; the JSON types and decoders live in @extynt/decode.
import { decode, isJsonArray, isJsonObject, wireJson } from "@extynt/decode";
import type { JsonArray, JsonObject, JsonValue } from "@extynt/decode";

/** Fields for a JSON object, some of which may be absent. */
export interface JsonFields {
  readonly [key: string]: JsonValue | undefined;
}

/** A JSON object holding the fields that are present, in the order given. */
export function objectOf(fields: JsonFields): JsonObject {
  return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const])));
}

/** The value when it is a JSON object, otherwise `undefined`. */
export function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

/** The object's string at `key`, or `undefined` when it is absent or another type. */
export function stringAt(object: JsonObject | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === "string" ? value : undefined;
}

/** The object's non-empty string at `key`, or `undefined`. */
export function nonEmptyStringAt(object: JsonObject | undefined, key: string): string | undefined {
  const value = stringAt(object, key);
  return value === undefined || value === "" ? undefined : value;
}

/** The object's finite number at `key`, or `undefined`. */
export function numberAt(object: JsonObject | undefined, key: string): number | undefined {
  const value = object?.[key];
  return typeof value === "number" ? value : undefined;
}

/** The object's integer at `key`, or `undefined`. */
export function integerAt(object: JsonObject | undefined, key: string): number | undefined {
  const value = numberAt(object, key);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

/** The object's boolean at `key`, or `undefined`. */
export function booleanAt(object: JsonObject | undefined, key: string): boolean | undefined {
  const value = object?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/** The object's nested object at `key`, or `undefined`. */
export function objectAt(object: JsonObject | undefined, key: string): JsonObject | undefined {
  return asObject(object?.[key]);
}

/** The object's array at `key`, or `undefined`. */
export function arrayAt(object: JsonObject | undefined, key: string): JsonArray | undefined {
  const value = object?.[key];
  return isJsonArray(value) ? value : undefined;
}

/** The array's elements that are objects, in order. */
export function objectsIn(values: JsonArray | undefined): ReadonlyArray<JsonObject> {
  return (values ?? []).filter(isJsonObject);
}

/** The array's elements that are strings, in order. */
export function stringsIn(values: JsonArray | undefined): ReadonlyArray<string> {
  return (values ?? []).filter((value) => typeof value === "string");
}

/** The value as it would travel over the wire: what JSON serialisation keeps, with anything it drops left out. */
export function jsonOf<T>(value: T): JsonValue {
  return wireOf(value) ?? null;
}

function wireOf<T>(value: T): JsonValue | undefined {
  const result = decode(wireJson, value);
  return result.ok ? result.value : undefined;
}

/** The fields of an object as they would travel over the wire; a value that is not an object gives no fields. */
export function jsonFieldsOf<T>(value: T): JsonObject {
  return asObject(wireOf(value)) ?? {};
}

interface Bounds {
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

/** The whole number at `key` held within the bounds, or the bounds' fallback when it is absent or another type. */
export function boundedAt(object: JsonObject | undefined, key: string, bounds: Bounds): number {
  const value = integerAt(object, key);
  return value === undefined ? bounds.fallback : Math.min(bounds.max, Math.max(bounds.min, value));
}

/** The items that are JSON values, in order; an item JSON cannot carry is left out. */
export function jsonItems<T>(values: ReadonlyArray<T>): JsonArray {
  return values.flatMap((value) => {
    const item = wireOf(value);
    return item === undefined ? [] : [item];
  });
}

/** The value as a JSON object, or undefined when it is not one. */
export function jsonRecordOf<T>(value: T): JsonObject | undefined {
  return asObject(wireOf(value));
}

function sortedKeys(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(sortedKeys);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys(value[key] ?? null)]));
}

/** The value as JSON text with every object's keys in sorted order, so equal data gives equal text whatever order it was built in. */
export function canonicalJson<T>(value: T): string {
  return JSON.stringify(sortedKeys(jsonOf(value)));
}
