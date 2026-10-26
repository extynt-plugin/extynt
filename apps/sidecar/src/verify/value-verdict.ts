// How a property's read-back value compares with the requested one: exact, a scalar broadcast to every dimension, coerced by After Effects, or different.
import type { JsonValue } from "@extynt/decode";
import { broadcastVector, hasNullComponent, mergeGapsMoved, readbackTolerance, sameValue, unstoreableTrailingRun } from "./compare-values.js";
import type { Reading } from "./compare-values.js";
import { listOf, numberOf } from "./json-fields.js";

type ValueVerdict = "exact" | "broadcast" | "coerced" | "mismatch";

type ComponentVerdict = "skip" | "match" | "coerced" | "mismatch";

function scalarVerdict(observed: Reading, requested: Reading): ValueVerdict {
  const seen = numberOf(observed);
  const wanted = numberOf(requested);
  return seen !== undefined && wanted !== undefined && Math.abs(seen - wanted) <= readbackTolerance(wanted) ? "exact" : "mismatch";
}

function componentVerdict(values: ReadonlyArray<JsonValue>, expected: ReadonlyArray<JsonValue>, index: number): ComponentVerdict {
  const wanted = expected[index];
  if (wanted === null) return "skip";
  const seen = numberOf(values[index]);
  const asked = numberOf(wanted);
  if (seen !== undefined && asked !== undefined && Math.abs(seen - asked) <= readbackTolerance(asked)) return "match";
  if (values[index] === wanted) return "match";
  return unstoreableTrailingRun(values, expected, index) ? "coerced" : "mismatch";
}

function nullsProvenBy(expected: ReadonlyArray<JsonValue>, prior: ReadonlyArray<JsonValue> | undefined): boolean {
  return expected.every((component, index) => component !== null || (prior !== undefined && index < prior.length));
}

function firstComponentFault(values: ReadonlyArray<JsonValue>, expected: ReadonlyArray<JsonValue>): ComponentVerdict | null {
  for (let index = 0; index < expected.length; index += 1) {
    const verdict = componentVerdict(values, expected, index);
    if (verdict !== "skip" && verdict !== "match") return verdict;
  }
  return null;
}

function arrayVerdict(values: ReadonlyArray<JsonValue>, expected: ReadonlyArray<JsonValue>, prior: Reading, gaps: boolean): ValueVerdict {
  if (values.length < expected.length) return "mismatch";
  const fault = firstComponentFault(values, expected);
  if (fault === "coerced" || fault === "mismatch") return fault;
  if (!gaps && values.length <= expected.length) return "exact";
  if (mergeGapsMoved(values, expected, prior)) return "mismatch";
  return nullsProvenBy(expected, listOf(prior)) ? "exact" : "coerced";
}

function leavesGaps(requested: Reading, before: Reading): boolean {
  const asked = listOf(requested);
  const prior = listOf(before);
  return hasNullComponent(requested) || (prior !== undefined && asked !== undefined && prior.length > asked.length);
}

/** Compares the value read back with the requested one, given what the property held before the write. */
export function propertyValueVerdict(observed: Reading, requested: Reading, before: Reading): ValueVerdict {
  const gaps = leavesGaps(requested, before);
  if (!gaps && sameValue(observed, requested)) return "exact";
  const wanted = numberOf(requested);
  if (broadcastVector(observed, requested, readbackTolerance(wanted ?? 0))) return "broadcast";
  const values = listOf(observed);
  const expected = listOf(requested);
  return values && expected ? arrayVerdict(values, expected, before, gaps) : scalarVerdict(observed, requested);
}
