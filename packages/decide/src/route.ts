// Routing by confidence: whether a decision model's answer is taken (act), checked against the deterministic answer (verify) or dropped (escalate).
import type { Failure } from "./port.js";
import type { AnyCore, Band } from "./result.js";
import type { Bands } from "./spec.js";

/** How far a disagreeing model answer must lead the deterministic answer, in probability, to be taken in the verify band. */
export const DEFAULT_VERIFY_MARGIN = 0.15;

/** The preference score from which a model's pick that is also the user's top habit counts as certain. */
export const STRONG_PREFERENCE = 3;

/** What routing needs to know about one decision. */
export interface RouteInput {
  readonly model: AnyCore;
  readonly deterministic: AnyCore;
  readonly bands: Bands;
  readonly high: boolean;
  readonly deterministicAbstained?: boolean;
  readonly preference: Readonly<Partial<Record<string, number>>> | undefined;
  readonly guarded?: ReadonlyArray<string> | undefined;
}

/** The routed outcome: the model's core is taken, or the decision falls to the next tier for the stated reason. */
export type Routed =
  | { readonly ok: true; readonly core: AnyCore; readonly band: Band }
  | { readonly ok: false; readonly failure: Failure; readonly band: Band };

function sameLabels(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((label) => right.has(label));
}

function sameRated(left: AnyCore, right: AnyCore): boolean {
  if ("level" in left) return "level" in right && left.level === right.level;
  return "value" in left && "value" in right && left.value === right.value;
}

function sameAnswer(left: AnyCore, right: AnyCore): boolean {
  if ("label" in left) return "label" in right && left.label === right.label;
  if ("labels" in left) return "labels" in right && sameLabels(left.labels, right.labels);
  return sameRated(left, right);
}

function yesNoMargin(probability: number): number {
  return Math.abs(2 * probability - 1);
}

function labelMargin(model: ReadonlySet<string>, deterministic: ReadonlySet<string>, probabilities: Readonly<Record<string, number>>): number {
  const differing = Object.entries(probabilities).filter(([label]) => model.has(label) !== deterministic.has(label));
  return Math.min(...differing.map(([, probability]) => yesNoMargin(probability)));
}

function pickedMargin(probabilities: Readonly<Record<string, number>>, model: string, deterministic: string): number {
  return (probabilities[model] ?? 0) - (probabilities[deterministic] ?? 0);
}

function levelMargin(probabilities: ReadonlyArray<number>, model: number, deterministic: number): number {
  return (probabilities[model] ?? 0) - (probabilities[deterministic] ?? 0);
}

function marginOver(model: AnyCore, deterministic: AnyCore): number {
  if ("label" in model && "label" in deterministic) return pickedMargin(model.probabilities, model.label, deterministic.label);
  if ("level" in model && "level" in deterministic) return levelMargin(model.probabilities, model.level, deterministic.level);
  if ("labels" in model && "labels" in deterministic) return labelMargin(model.labels, deterministic.labels, model.probabilities);
  return model.confidence;
}

function preferenceOf(preference: RouteInput["preference"], label: string): number {
  return preference?.[label] ?? 0;
}

function liftedByHabit(input: RouteInput): boolean {
  if (!("label" in input.model) || input.preference === undefined) return false;
  const own = preferenceOf(input.preference, input.model.label);
  const best = Math.max(...Object.values(input.preference).map((score) => score ?? 0));
  return own >= STRONG_PREFERENCE && own >= best;
}

function holdsHabit(input: RouteInput): boolean {
  if (input.deterministicAbstained === true || !("label" in input.model) || !("label" in input.deterministic)) return false;
  const habitual = preferenceOf(input.preference, input.deterministic.label);
  const best = Math.max(0, ...Object.values(input.preference ?? {}).map((score) => score ?? 0));
  return habitual > 0 && habitual >= best && habitual > preferenceOf(input.preference, input.model.label);
}

function disagreement(band: Band): Routed {
  return { ok: false, band, failure: { reason: "disagreement", detail: "The decision model and the deterministic answer disagree, and the model's lead is not enough to overrule it." } };
}

function isGuardedAnswer(input: RouteInput): boolean {
  return "label" in input.model && (input.guarded ?? []).includes(input.model.label);
}

function habitFavoursModel(input: RouteInput): boolean {
  if (!("label" in input.model) || !("label" in input.deterministic)) return false;
  return preferenceOf(input.preference, input.model.label) > preferenceOf(input.preference, input.deterministic.label);
}

function settleDisagreement(input: RouteInput): Routed {
  if (input.deterministicAbstained === true && !isGuardedAnswer(input)) return { ok: true, core: input.model, band: "verify" };
  if (input.high || isGuardedAnswer(input)) return disagreement("verify");
  const lead = marginOver(input.model, input.deterministic);
  if (lead > DEFAULT_VERIFY_MARGIN) return { ok: true, core: input.model, band: "verify" };
  return habitFavoursModel(input) ? { ok: true, core: input.model, band: "verify" } : disagreement("verify");
}

/** Routes a model answer by its confidence against the decision's bands; below the lower band it is dropped, at the upper band it is taken, between them it must agree with the deterministic answer or lead it clearly. A model answer that leaves the user's habit when the deterministic answer, which reads the request, still lands on that habit is never taken. */
export function route(input: RouteInput): Routed {
  const { confidence } = input.model;
  if (confidence < input.bands.verify) {
    return { ok: false, band: "escalate", failure: { reason: "low-confidence", detail: `Confidence ${confidence.toFixed(2)} is below ${input.bands.verify}.` } };
  }
  if (!sameAnswer(input.model, input.deterministic) && holdsHabit(input)) return disagreement("verify");
  if (confidence >= input.bands.act || liftedByHabit(input)) return { ok: true, core: input.model, band: "act" };
  return sameAnswer(input.model, input.deterministic) ? { ok: true, core: input.model, band: "verify" } : settleDisagreement(input);
}
