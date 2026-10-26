// Dotted-path lookup over JSON objects.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { decode, isJsonObject, wireJson } from "@extynt/decode";

/** Reads a `head` or `head.tail` path from an object. */
export function valueAtPath(record: JsonObject, path: string): JsonValue | undefined {
  const [head, tail] = path.split(".");
  if (head === undefined || head === "") return undefined;
  if (tail === undefined) return record[head];
  const parent = record[head];
  return isJsonObject(parent) ? parent[tail] : undefined;
}

/** The JSON object a typed record is on the wire, or undefined when it is not an object JSON can carry. */
export function objectView<T>(value: T): JsonObject | undefined {
  const wire = decode(wireJson, value);
  return wire.ok && isJsonObject(wire.value) ? wire.value : undefined;
}
