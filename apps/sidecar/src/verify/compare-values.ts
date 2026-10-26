// The comparisons every read-back verdict is built from: numbers within a tolerance, vectors, colours, frame times and the named comparison table.
import type { JsonValue } from "@extynt/decode";
import { listOf, numberOf } from "./json-fields.js";

/** A value as the host read it or as the plan asked for it; undefined when it was not given. */
export type Reading = JsonValue | undefined;

type Comparison = (observed: Reading, expected: Reading) => boolean;

/** A render-time colour component is stored in 8 bits, so a background colour reads back within one step. */
export const EIGHT_BIT_COLOR_TOLERANCE = 1 / 255;

/** Two key times are the same key when they differ by less than this many seconds. */
export const KEY_TIME_TOLERANCE = 0.0005;

const OPTION_TOLERANCE = 0.01;
const COLOR_TOLERANCE = 0.00001;

/** Two values are equal when they serialize to the same JSON. */
export function sameValue(left: Reading, right: Reading): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The per-component slack for a value read back from After Effects: 0.0005, or 10 ppm of the value when larger. */
export function readbackTolerance(expected: number): number {
  return Math.max(0.0005, Math.abs(expected) * 0.00001);
}

/** Whether `observed` is within `tolerance` of `expected`; an expected value that was not given is no claim. */
export function withinTolerance(observed: Reading, expected: Reading, tolerance: number): boolean {
  if (expected === undefined) return true;
  const seen = numberOf(observed);
  const wanted = numberOf(expected);
  return seen !== undefined && wanted !== undefined && Math.abs(seen - wanted) <= tolerance + 1e-9;
}

/** After Effects snaps a time to its composition's frame grid, so a requested time reads back within half a frame. */
export function sameFrameTime(observed: Reading, expected: Reading, frameRate: number | undefined): boolean {
  return withinTolerance(observed, expected, frameRate !== undefined && frameRate > 0 ? 0.5 / frameRate : 0.5);
}

/** Whether `observed` is within the read-back tolerance of the number `expected`. */
export function sameNumber(observed: Reading, expected: Reading): boolean {
  const seen = numberOf(observed);
  const wanted = numberOf(expected);
  return seen !== undefined && wanted !== undefined && Math.abs(seen - wanted) <= readbackTolerance(wanted);
}

function componentAt(list: ReadonlyArray<JsonValue>, index: number): number | undefined {
  return numberOf(list[index]);
}

/** A scalar written to a multi-dimensional property reads back as that scalar in every dimension. */
export function broadcastVector(observed: Reading, expected: Reading, tolerance: number): boolean {
  const list = listOf(observed);
  const wanted = numberOf(expected);
  if (!list || list.length < 2 || wanted === undefined) return false;
  return list.every((component) => {
    const seen = numberOf(component);
    return seen !== undefined && Math.abs(seen - wanted) <= tolerance;
  });
}

/** From `from` on, the requested components are non-zero where the property can only hold zero. */
export function unstoreableTrailingRun(observed: ReadonlyArray<JsonValue>, requested: ReadonlyArray<JsonValue>, from: number): boolean {
  if (from < 2) return false;
  for (let index = from; index < requested.length; index += 1) {
    if (componentAt(observed, index) !== 0 || componentAt(requested, index) === undefined || componentAt(requested, index) === 0) return false;
  }
  return true;
}

/** Whether a requested vector leaves a component alone with a null. */
export function hasNullComponent(requested: Reading): boolean {
  return (listOf(requested) ?? []).includes(null);
}

function duplicateMatches(value: JsonValue | undefined, duplicate: number | null): boolean {
  const seen = numberOf(value);
  return duplicate !== null && seen !== undefined && Math.abs(seen - duplicate) <= readbackTolerance(duplicate);
}

function unchangedBefore(value: JsonValue | undefined, previous: ReadonlyArray<JsonValue> | undefined, index: number): boolean {
  if (!previous || index >= previous.length) return true;
  const was = numberOf(previous[index]);
  const seen = numberOf(value);
  return was !== undefined && seen !== undefined ? Math.abs(seen - was) <= readbackTolerance(was) : value === previous[index];
}

/** Whether a component the request left alone (null, or past its end) changed from its value before the write. */
export function mergeGapsMoved(observed: ReadonlyArray<JsonValue>, requested: ReadonlyArray<JsonValue>, before: Reading): boolean {
  const duplicate = requested.length === 1 ? (numberOf(requested[0]) ?? null) : null;
  const previous = listOf(before);
  const last = Math.max(observed.length, previous?.length ?? 0);
  const moved = (index: number): boolean => {
    const asked = index < requested.length && requested[index] !== null;
    return !asked && !duplicateMatches(observed[index], duplicate) && !unchangedBefore(observed[index], previous, index);
  };
  for (let index = 0; index < last; index += 1) if (moved(index)) return true;
  return false;
}

/** Whether `observed` starts with three colour components within `tolerance` of the three in `expected`. */
export function sameRgbColor(observed: Reading, expected: Reading, tolerance = COLOR_TOLERANCE): boolean {
  const wanted = listOf(expected);
  const seen = listOf(observed);
  if (!wanted || !seen || wanted.length !== 3 || seen.length < 3) return false;
  return [0, 1, 2].every((index) => {
    const left = componentAt(wanted, index);
    const right = componentAt(seen, index);
    return left !== undefined && right !== undefined && Math.abs(left - right) <= tolerance;
  });
}

function sameOptionNumber(observed: Reading, expected: Reading): boolean {
  const seen = numberOf(observed);
  const wanted = numberOf(expected);
  return seen !== undefined && wanted !== undefined && Math.abs(seen - wanted) < OPTION_TOLERANCE;
}

function sameOptionBoolean(observed: Reading, expected: Reading): boolean {
  if (typeof expected === "boolean" && numberOf(observed) !== undefined) return observed === (expected ? 1 : 0);
  return typeof observed === "boolean" && numberOf(expected) !== undefined && expected === (observed ? 1 : 0);
}

/** A camera, light, material or marker option: equal, within 0.01, broadcast, a boolean as 0/1, or the same colour. */
export function sameOptionValue(observed: Reading, expected: Reading): boolean {
  return sameValue(observed, expected) || sameOptionNumber(observed, expected) || broadcastVector(observed, expected, OPTION_TOLERANCE) || sameOptionBoolean(observed, expected) || sameRgbColor(observed, expected);
}

function sameComponents(observed: ReadonlyArray<JsonValue>, expected: ReadonlyArray<JsonValue>): boolean {
  if (observed.length < expected.length) return false;
  return expected.every((component, index) => {
    const wanted = component === null ? 0 : numberOf(component);
    const seen = componentAt(observed, index);
    return wanted !== undefined && seen !== undefined && Math.abs(seen - wanted) <= readbackTolerance(wanted);
  });
}

/** An effect control or style value: components within the read-back tolerance (a null component reads as zero), a broadcast scalar, or an option match. */
export function sameControlValue(observed: Reading, expected: Reading): boolean {
  const wanted = listOf(expected);
  if (wanted) {
    const seen = listOf(observed);
    return seen !== undefined && sameComponents(seen, wanted);
  }
  const scalar = numberOf(expected);
  if (scalar !== undefined && broadcastVector(observed, scalar, readbackTolerance(scalar))) return true;
  return sameOptionValue(observed, expected);
}

function foldedFontName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

function foldedText(text: string): string {
  return text.replace(/\r\n|\n/g, "\r");
}

/** A text document field: a font by its folded name, text by its folded line breaks, anything else as an option. */
export function sameTextDocumentField(field: string, observed: Reading, expected: Reading): boolean {
  if (typeof observed === "string" && typeof expected === "string") {
    if (field === "font") return foldedFontName(observed) === foldedFontName(expected);
    if (field === "text") return foldedText(observed) === foldedText(expected);
  }
  return sameOptionValue(observed, expected);
}

/** The comparisons a table row names instead of carrying a function: one entry per way a value can be judged. */
export const COMPARISONS = {
  exact: (observed, expected) => observed === expected,
  option: sameOptionValue,
  control: sameControlValue,
  number: sameNumber,
} as const satisfies Readonly<Record<string, Comparison>>;

/** The name of one comparison in the table. */
export type ComparisonName = keyof typeof COMPARISONS;
