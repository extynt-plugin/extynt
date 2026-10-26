// Compact, human-sized renderings of plan values for the approval card's value rows.
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { Translate } from "@extynt/ui-text";
import { ENGLISH_TEXT } from "./plan-text.js";

const ROW_TEXT_CHARS = 40;
const MAX_INLINE_NUMBERS = 6;

/** Flattens whitespace and cuts free text to `limit` characters (a row shows a hint; the full text stays in the plan). */
export function clipText(text: string, limit: number = ROW_TEXT_CHARS): string {
  const flat = text.replace(/[\u0003\s]+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

/** Two decimals at most, never a trailing zero or a negative zero. */
export function compactNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** "1 key" or "3 keys". */
export function formatKeys(count: number, translate: Translate = ENGLISH_TEXT): string {
  return translate("plan.row.keys", { count });
}

function channelHex(channel: number): string {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0").toUpperCase();
}

function isUnitInterval(part: JsonValue): boolean {
  return typeof part === "number" && Number.isFinite(part) && part >= 0 && part <= 1;
}

/** True for three or four numbers that are all between 0 and 1: the shape of an AE colour. */
export function isColorTuple(value: JsonValue | undefined): value is readonly number[] {
  return isJsonArray(value) && (value.length === 3 || value.length === 4) && value.every(isUnitInterval);
}

/** AE colours are 0-1 floats; an alpha below one rides along as a fourth pair. */
export function colorHex(value: readonly number[]): string {
  const [red = 0, green = 0, blue = 0, alpha = 1] = value;
  return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}${alpha < 1 ? channelHex(alpha) : ""}`;
}

function numberList(values: readonly number[], translate: Translate): string {
  return values.length > MAX_INLINE_NUMBERS ? translate("plan.row.values", { count: values.length }) : values.map(compactNumber).join(", ");
}

function isFiniteNumber(part: JsonValue): boolean {
  return typeof part === "number" && Number.isFinite(part);
}

function isNumberList(value: JsonValue | undefined): value is readonly number[] {
  return isJsonArray(value) && value.length > 0 && value.every(isFiniteNumber);
}

function formatScalar(value: JsonValue | undefined, translate: Translate): string | null | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? compactNumber(value) : null;
  if (typeof value === "boolean") return translate(value ? "plan.row.on" : "plan.row.off");
  if (typeof value === "string") return value === "" ? null : clipText(value);
  return undefined;
}

/** `colour` marks a value that is a colour by the property it belongs to; a bare 0-1 triple elsewhere stays a list of numbers. */
export function formatValue(value: JsonValue | undefined, colour = false, translate: Translate = ENGLISH_TEXT): string | null {
  const scalar = formatScalar(value, translate);
  if (scalar !== undefined) return scalar;
  if (colour && isColorTuple(value)) return colorHex(value);
  return isNumberList(value) ? numberList(value, translate) : null;
}

/** "ADBE Gaussian Blur 2" → "Gaussian Blur"; "transform.opacity" → "Opacity"; "dropShadow" → "Drop shadow"; "MULTIPLY" → "Multiply". */
export function humanizeName(raw: string): string {
  const stripped = raw.replace(/^ADBE\s+/, "").replace(/-\d+$/, "").replace(/\s+\d+$/, "");
  const last = stripped.includes(".") ? (stripped.split(".").at(-1) ?? stripped) : stripped;
  const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  if (!words) return raw;
  const lower = words === words.toUpperCase() ? words.toLowerCase() : words;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A plain-language list of the fields an options object sets, for operations whose value is a bag of settings. */
export function describeFields(fields: JsonObject, limit = 3, translate: Translate = ENGLISH_TEXT): string | null {
  const parts = Object.entries(fields).map(([key, setting]) => {
    const shown = formatValue(setting, /colou?r/i.test(key), translate);
    const name = humanizeName(key).toLowerCase();
    return shown === null ? name : `${name} ${shown}`;
  });
  if (parts.length === 0) return null;
  return parts.length > limit ? `${parts.slice(0, limit).join(", ")} +${parts.length - limit}` : parts.join(", ");
}
