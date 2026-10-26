/** Typed readers for custom checks: access into values read back from After Effects. */
import { isJsonArray } from "@extynt/decode";
import { isJsonObject, type JsonValue } from "../json.js";

/** A member of a read-back object, or undefined when the value is not an object. */
export const fieldOf = (value: JsonValue | undefined, key: string): JsonValue | undefined => (isJsonObject(value) ? value[key] : undefined);

/** An element of a read-back list, or undefined when the value is not a list. */
export const itemAt = (value: JsonValue | undefined, index: number): JsonValue | undefined => (isJsonArray(value) ? value[index] : undefined);

/** A numeric member of a read-back object, or undefined. */
export function numberField(value: JsonValue | undefined, key: string): number | undefined {
  const member = fieldOf(value, key);
  return typeof member === "number" ? member : undefined;
}

/** Whether a read-back value equals the expected one: numbers and number lists within the tolerance, everything else exactly. */
export function nearly(actual: JsonValue | undefined, expected: JsonValue, tolerance: number): boolean {
  if (typeof expected === "number") return typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
  if (Array.isArray(expected))
    return Array.isArray(actual) && expected.every((channel, index) => Math.abs(Number(actual[index]) - Number(channel)) <= tolerance);
  return JSON.stringify(actual) === JSON.stringify(expected);
}
