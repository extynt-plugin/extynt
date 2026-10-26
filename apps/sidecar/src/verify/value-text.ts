// The bounded text a receipt shows for a value: a repair line's expected and observed text, and the rounded text of a mismatch row.
import type { JsonValue } from "@extynt/decode";
import type { Reading } from "./compare-values.js";

const BOUNDED_LIMIT = 200;
const ROUNDED_LIMIT = 80;

/** A value as at most 200 characters of text, or null when there is none to show. */
export function boundedValueText(value: Reading): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > BOUNDED_LIMIT ? `${text.slice(0, BOUNDED_LIMIT)}…` : text;
}

/** A value for a mismatch row: numbers rounded to three decimals, text cut to 80 characters. */
export function roundedValueText(value: Reading): string | null {
  if (value === undefined || value === null) return null;
  const text = JSON.stringify(value, (_key: string, entry: JsonValue) => (typeof entry === "number" ? Math.round(entry * 1000) / 1000 : entry));
  return text.length > ROUNDED_LIMIT ? `${text.slice(0, ROUNDED_LIMIT)}…` : text;
}
