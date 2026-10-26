/**
 * A size figure for a snapshot that is reported, never relied on. The walk counts members instead of serializing the project:
 * `JSON.stringify` of a whole snapshot is tens of milliseconds of main-thread work on a big project.
 */
import { isJsonArray } from "@extynt/decode";
import type { Opaque } from "./snapshot-view.js";

const NUMBER_BYTES = 8, LITERAL_BYTES = 5, STRING_QUOTES = 2, KEY_PUNCTUATION = 4;

function weigh(next: Opaque, pending: Opaque[]): number {
  if (typeof next === "string") return next.length + STRING_QUOTES;
  if (typeof next === "number") return NUMBER_BYTES;
  if (typeof next === "boolean" || next === null) return LITERAL_BYTES;
  if (isJsonArray(next)) { pending.push(...next); return next.length + STRING_QUOTES; }
  if (typeof next !== "object") return 0;
  let own = 0;
  for (const [key, member] of Object.entries(next)) { own += key.length + KEY_PUNCTUATION; pending.push(member); }
  return own;
}

/** About how many bytes `value` takes as JSON, counted by walking it. Strings count their UTF-16 length. */
export function approximateBytes(value: Opaque): number {
  const pending: Opaque[] = [value];
  let total = 0;
  while (pending.length > 0) total += weigh(pending.pop(), pending);
  return total;
}
