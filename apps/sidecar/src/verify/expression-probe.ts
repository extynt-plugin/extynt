// The probe the host runs on a wiggle or loopOut expression, and the verdict it supports: sampled values within the wiggle's amplitude, or past the last key repeating the keyed span.
import { array, fallback, jsonValue, object, optional } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { readbackTolerance } from "./compare-values.js";
import type { Reading } from "./compare-values.js";
import { listOf, numberOf } from "./json-fields.js";
import { exactStep, failedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

const LOOP_REPEAT_TOLERANCE = 0.0005;
const WIGGLE_AMPLITUDE_SLACK = 0.05;
const WIGGLE_SOURCE = /^\s*wiggle\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*;?\s*$/;
const LOOP_CYCLE_SOURCE = /^\s*loopOut\(\s*(?:(["'])cycle\1\s*(?:,\s*0\s*)?)?\)\s*;?\s*$/;
const LOOP_PINGPONG_SOURCE = /^\s*loopOut\(\s*(["'])pingpong\1\s*(?:,\s*0\s*)?\)\s*;?\s*$/;

const wiggleSample = object({ value: optional(fallback(jsonValue, undefined)), base: optional(fallback(jsonValue, undefined)) });
const loopPoint = object({ looped: optional(fallback(jsonValue, undefined)), keyed: optional(fallback(jsonValue, undefined)) });

/** The host's probe of a wiggle or loopOut expression: values sampled against their pre-expression base, or looped values against the keyed span. */
export const expressionProbe = object({
  wiggle: optional(fallback(array(wiggleSample), undefined)),
  loop: optional(fallback(object({ points: optional(fallback(array(loopPoint), undefined)) }), undefined)),
});

type ExpressionProbe = Infer<typeof expressionProbe>;
type Offsets = ReadonlyArray<ReadonlyArray<number>>;
interface LoopPair {
  readonly looped: ReadonlyArray<number>;
  readonly keyed: ReadonlyArray<number>;
}
interface ProbeVerdict {
  readonly matched: boolean;
  readonly check: string;
}

function numbersOf(list: ReadonlyArray<Reading>): ReadonlyArray<number> | null {
  const numbers: number[] = [];
  for (const entry of list) {
    const number = numberOf(entry);
    if (number === undefined) return null;
    numbers.push(number);
  }
  return numbers;
}

function componentsOf(value: Reading): ReadonlyArray<number> | null {
  const one = numberOf(value);
  if (one !== undefined) return [one];
  const list = listOf(value);
  return list && list.length > 0 ? numbersOf(list) : null;
}

function wiggleOffsets(samples: ProbeSamples): Offsets | null {
  const offsets: number[][] = [];
  for (const sample of samples) {
    const value = componentsOf(sample.value);
    const base = componentsOf(sample.base);
    if (!value || !base || value.length !== base.length) return null;
    offsets.push(value.map((component, dimension) => component - (base[dimension] ?? 0)));
  }
  return offsets.length >= 2 ? offsets : null;
}

type ProbeSamples = NonNullable<ExpressionProbe["wiggle"]>;

function offsetsVary(offsets: Offsets): boolean {
  const first = offsets[0] ?? [];
  return offsets.some((offset) => offset.some((component, dimension) => Math.abs(component - (first[dimension] ?? 0)) > LOOP_REPEAT_TOLERANCE));
}

function wiggleSource(source: string): { readonly frequency: number; readonly amplitude: number } | null {
  const parsed = WIGGLE_SOURCE.exec(source);
  const frequency = Number(parsed?.[1]);
  const amplitude = Number(parsed?.[2]);
  return parsed && frequency > 0 && amplitude !== 0 ? { frequency, amplitude } : null;
}

function wiggleVerdict(source: string, probe: ExpressionProbe): ProbeVerdict | null {
  const parsed = wiggleSource(source);
  const offsets = parsed && probe.wiggle ? wiggleOffsets(probe.wiggle) : null;
  if (!parsed || !offsets) return null;
  const amplitude = parsed.amplitude;
  const limit = Math.abs(amplitude) * (1 + WIGGLE_AMPLITUDE_SLACK);
  const bounded = offsets.every((offset) => offset.every((component) => Math.abs(component) <= limit));
  return { matched: bounded && offsetsVary(offsets), check: "wiggle-bounds" };
}

function loopPairs(points: NonNullable<NonNullable<ExpressionProbe["loop"]>["points"]>): ReadonlyArray<LoopPair> | null {
  const pairs: LoopPair[] = [];
  for (const point of points) {
    const looped = componentsOf(point.looped);
    const keyed = componentsOf(point.keyed);
    if (!looped || !keyed || looped.length !== keyed.length) return null;
    pairs.push({ looped, keyed });
  }
  return pairs.length >= 2 ? pairs : null;
}

function repeatsKeyedSpan(pairs: ReadonlyArray<LoopPair>): boolean {
  return pairs.every((pair) => pair.looped.every((component, dimension) => {
    const keyed = pair.keyed[dimension] ?? 0;
    return Math.abs(component - keyed) <= readbackTolerance(keyed);
  }));
}

function loopVerdict(source: string, probe: ExpressionProbe): ProbeVerdict | null {
  const pingpong = LOOP_PINGPONG_SOURCE.test(source);
  const pairs = (pingpong || LOOP_CYCLE_SOURCE.test(source)) && probe.loop?.points ? loopPairs(probe.loop.points) : null;
  if (!pairs || !offsetsVary(pairs.map((pair) => pair.keyed))) return null;
  return { matched: repeatsKeyedSpan(pairs), check: pingpong ? "loop-pingpong" : "loop-cycle" };
}

/** The verdict for a wiggle or loopOut source the host probed, or null for every other source (left to the sampled motion). */
export function expressionProbeResult(kind: string, source: string | undefined, probe: ExpressionProbe | undefined, details: Details): VerifiedStep | null {
  if (source === undefined || !probe) return null;
  const verdict = wiggleVerdict(source, probe) ?? loopVerdict(source, probe);
  if (!verdict) return null;
  return verdict.matched ? exactStep(kind, `property-expression-${verdict.check}`, details) : failedStep(kind, "expression-motion-mismatch", { ...details, expressionCheck: verdict.check });
}
