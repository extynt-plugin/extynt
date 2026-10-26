// Copies plain in-memory data into the JSON value it would serialise to, so callers holding typed data can reach the plan validators.
import { decode } from "@extynt/decode";
import type { Decoder, JsonValue } from "@extynt/decode";

const plainJson: Decoder<JsonValue | undefined> = {
  run: (input) => {
    if (input === null || typeof input === "string" || typeof input === "boolean" || typeof input === "number") return input;
    if (Array.isArray(input)) return input.map((item) => toJsonValue(item) ?? null);
    if (typeof input !== "object") return undefined;
    const members = Object.entries(input).flatMap(([key, member]) => {
      const copy = toJsonValue(member);
      return copy === undefined ? [] : [[key, copy] as const];
    });
    return Object.fromEntries(members);
  },
};

/** The value `JSON.stringify` would write for the input: members that are undefined, functions or symbols are dropped (null inside arrays). Numbers are kept as they are, so a non-finite number stays visible to the validators that refuse it. Undefined when the input has no JSON form. */
export function toJsonValue<T>(value: T): JsonValue | undefined {
  const result = decode(plainJson, value);
  return result.ok ? result.value : undefined;
}
