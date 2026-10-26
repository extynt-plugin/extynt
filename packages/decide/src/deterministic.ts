// The offline tier: answers a decision with the spec's own pure function and states it with full confidence.
import type { JsonValue } from "./json.js";
import type { AnyCore } from "./result.js";
import type { AnySpec, BinarySpec, ChoiceSpec, LabelsSpec, ScoreSpec } from "./spec.js";
import { labelsOf } from "./spec.js";

function oneHot(length: number, index: number): ReadonlyArray<number> {
  return Array.from({ length }, (_, position) => (position === index ? 1 : 0));
}

function labelledProbabilities(labels: ReadonlyArray<string>, applied: ReadonlySet<string>): Readonly<Record<string, number>> {
  return Object.fromEntries(labels.map((label) => [label, applied.has(label) ? 1 : 0]));
}

function clamped(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function statedConfidence(stated: number | undefined): number {
  return clamped(stated ?? 1);
}

function choiceCore<S extends JsonValue>(spec: ChoiceSpec<S, string>, state: S): AnyCore {
  const label = spec.deterministic(state);
  return { label, confidence: statedConfidence(spec.deterministicConfidence?.(state, label)), probabilities: labelledProbabilities(labelsOf(spec.labels), new Set([label])) };
}

function labelsCore<S extends JsonValue>(spec: LabelsSpec<S, string>, state: S): AnyCore {
  const applied = new Set(spec.deterministic(state));
  return { labels: applied, confidence: statedConfidence(spec.deterministicConfidence?.(state, [...applied])), probabilities: labelledProbabilities(labelsOf(spec.labels), applied) };
}

function scoreCore<S extends JsonValue>(spec: ScoreSpec<S>, state: S): AnyCore {
  const level = spec.deterministic(state);
  return { level, expected: level, confidence: statedConfidence(spec.deterministicConfidence?.(state, level)), probabilities: oneHot(spec.levels.length, level) };
}

function binaryCore<S extends JsonValue>(spec: BinarySpec<S>, state: S): AnyCore {
  const value = spec.deterministic(state);
  return { probability: value ? 1 : 0, value, confidence: statedConfidence(spec.deterministicConfidence?.(state, value)) };
}

/** The core of a decision's result as its deterministic function answers it, with the confidence its spec states for the answer (1 when it states none). */
export function deterministicCore<S extends JsonValue>(spec: AnySpec<S>, state: S): AnyCore {
  switch (spec.kind) {
    case "choice": return choiceCore(spec, state);
    case "labels": return labelsCore(spec, state);
    case "score": return scoreCore(spec, state);
    case "binary": return binaryCore(spec, state);
  }
}

/** Whether the offline answer's confidence is below the spec's abstain threshold; a spec with no threshold never abstains. */
export function abstains(spec: AnySpec<never>, core: AnyCore): boolean {
  return spec.abstainBelow !== undefined && core.confidence < spec.abstainBelow;
}
