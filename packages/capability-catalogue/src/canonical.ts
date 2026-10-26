// Machine-independent ordering, serialization and hashing, so every fingerprint and payload order is the same on every computer.
import { createHash } from "node:crypto";

import type { JsonValue } from "@extynt/decode";

/** Orders by code unit, not locale collation, so the result never varies by machine. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Serializes JSON with object keys in code-unit order, so equal values always produce equal text. */
export function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const members = Object.entries(value).sort(([a], [b]) => compareText(a, b));
  return `{${members.map(([key, member]) => `${JSON.stringify(key)}:${stableJson(member)}`).join(",")}}`;
}

/** The SHA-256 digest of the text as lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
