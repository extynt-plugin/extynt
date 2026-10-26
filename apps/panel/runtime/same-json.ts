/** Structural equality of JSON values, so a change to state is detected without serializing either side. */
import { type JsonObject, type JsonValue } from "@extynt/decode";

function isList(value: JsonValue): value is ReadonlyArray<JsonValue> {
  return Array.isArray(value);
}

function isMap(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameList(left: ReadonlyArray<JsonValue>, right: ReadonlyArray<JsonValue>): boolean {
  return left.length === right.length && left.every((entry, index) => sameEntry(entry, right[index]));
}

function sameMap(left: JsonObject, right: JsonObject): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => sameEntry(left[key], right[key]));
}

function sameEntry(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return left !== undefined && right !== undefined && sameJson(left, right);
}

/** True when both values hold the same data: same scalars, same list order, same keys whatever their order. */
export function sameJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (isList(left)) return isList(right) && sameList(left, right);
  return isMap(left) && isMap(right) && sameMap(left, right);
}
