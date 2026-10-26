/** Typed reads of fields in decoded JSON objects, for the comparison of snapshots whose rows are open-ended. */
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";

/** The object under `key`, or an empty object when it is absent or not an object. */
export function objectAt(row: JsonObject, key: string): JsonObject {
  const found = row[key];
  return isJsonObject(found) ? found : {};
}

/** The objects in the array under `key`; an absent or non-array field reads as empty and non-object entries are skipped. */
export function rowsAt(row: JsonObject, key: string): ReadonlyArray<JsonObject> {
  const found = row[key];
  return isJsonArray(found) ? found.filter(isJsonObject) : [];
}

/** The string under `key`, or undefined. */
export function textAt(row: JsonObject, key: string): string | undefined {
  const found = row[key];
  return typeof found === "string" ? found : undefined;
}

/** The number under `key`, or undefined. */
export function numberAt(row: JsonObject, key: string): number | undefined {
  const found = row[key];
  return typeof found === "number" ? found : undefined;
}

/** The boolean under `key`, or undefined. */
export function flagAt(row: JsonObject, key: string): boolean | undefined {
  const found = row[key];
  return typeof found === "boolean" ? found : undefined;
}

/** The value as an object, or an empty object when it is absent or any other JSON value. */
export function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}
