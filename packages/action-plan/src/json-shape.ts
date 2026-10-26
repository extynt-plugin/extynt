// Type guards that narrow untrusted plan values to the JSON shapes the dolly and vector-shape validators read.
import type { JsonObject, JsonValue } from "@extynt/decode";

/** True for a non-null, non-array object. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for an array. */
export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}
