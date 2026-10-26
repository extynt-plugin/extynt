/** Reading and comparing the loosely shaped numbers, vectors and rows an open-questions probe records, and formatting them for a finding. */
import { isJsonArray } from "@extynt/decode";
import { isJsonObject } from "./json.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { HostReply } from "./question-data.js";

/** A recorded value that may be missing. */
export type Recorded = JsonValue | undefined;

/** The text of a recorded string, number or boolean; undefined for anything else. */
export const str = (value: Recorded): string | undefined => (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : undefined);

/** The finite number a recorded value holds, or null. */
export const numberOf = (value: Recorded): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The recorded value as JSON text cut to 120 characters. */
export function fmt(value: Recorded): string {
  if (value === undefined) return "undefined";
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** Whether two recorded values serialize identically. */
export const sameJson = (left: Recorded, right: Recorded): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Whether two recorded numbers are within `tolerance`; false when either is not a number. */
export function sameNumber(left: Recorded, right: Recorded, tolerance = 1e-3): boolean {
  const a = numberOf(left), b = numberOf(right);
  return a === null || b === null ? false : Math.abs(a - b) <= tolerance;
}

/** Deep equality in which numbers match within `tolerance`. */
export function sameValue(left: Recorded, right: Recorded, tolerance = 1e-3): boolean {
  if (isJsonArray(left) && isJsonArray(right))
    return left.length === right.length && left.every((entry, index) => sameValue(entry, right[index], tolerance));
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= tolerance;
  return left === right;
}

/** The numbers of a non-empty all-number array, or null. */
export function vector(value: Recorded): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const numbers = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  return numbers.length === value.length ? numbers : null;
}

/** `vector`, or an empty array. */
export const vectorOf = (value: Recorded): number[] => vector(value) ?? [];

/** Whether a read-back vector starts with the requested components within `tolerance`. */
export function matchesVector(read: Recorded, requested: number[], tolerance = 1e-3): boolean {
  const actual = vector(read);
  if (!actual || actual.length < requested.length) return false;
  return requested.every((value, index) => Math.abs(value - (actual[index] ?? value)) <= tolerance);
}

/** The object members of a recorded array; anything else is no rows. */
export const objectRows = (value: Recorded): JsonObject[] => (Array.isArray(value) ? value.filter(isJsonObject) : []);

/** The member of a recorded row, or undefined. */
export const memberOf = (row: JsonObject | undefined, key: string): Recorded => row?.[key];

/** One line saying whether the host applied a step or refused it, and why. */
export function hostOutcome(host: HostReply): string {
  if (host.ok === true) return `applied (mutationState ${host.mutationState ?? "none reported"})`;
  return `refused ${host.errorCode ?? "with no code"}${host.errorMessage ? `: ${host.errorMessage}` : ""}`;
}
