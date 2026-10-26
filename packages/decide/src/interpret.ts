// Reads a decision model's answers back into the core of a decision's result, rejecting what the spec cannot hold.
import { yesConfidence } from "./confidence.js";
import type { Plan } from "./plan.js";
import { fanOutId } from "./plan.js";
import type { Answer, Failure } from "./port.js";
import type { AnyCore } from "./result.js";
import type { JsonValue } from "./json.js";
import { labelsOf } from "./spec.js";

type Interpreted = { readonly ok: true; readonly core: AnyCore } | { readonly ok: false; readonly failure: Failure };

type Answers = ReadonlyMap<string, Answer>;

const YES_AT = 0.5;

function answerOfKind<K extends Answer["kind"]>(answers: Answers, id: string, kind: K): Extract<Answer, { readonly kind: K }> | null {
  const found = answers.get(id);
  return found !== undefined && isKind(found, kind) ? found : null;
}

function isKind<K extends Answer["kind"]>(answer: Answer, kind: K): answer is Extract<Answer, { readonly kind: K }> {
  return answer.kind === kind;
}

function indexOfLargest(values: ReadonlyArray<number>): number {
  return values.reduce((best, value, index) => (value > (values[best] ?? -Infinity) ? index : best), 0);
}

function distribution(labels: ReadonlyArray<string>, read: (label: string) => number): Readonly<Record<string, number>> {
  return Object.fromEntries(labels.map((label) => [label, read(label)]));
}

function perLabelProbabilities<S extends JsonValue>(plan: Plan<S>, answers: Answers, labels: ReadonlyArray<string>): ReadonlyArray<number> | null {
  const found: number[] = [];
  for (const label of labels) {
    const answer = answerOfKind(answers, fanOutId(plan.key, label), "binary");
    if (answer === null) return null;
    found.push(answer.probability);
  }
  return found;
}

function choiceFromYesNo(labels: ReadonlyArray<string>, yes: ReadonlyArray<number>): AnyCore | null {
  const total = yes.reduce((sum, probability) => sum + probability, 0);
  if (total <= 0) return null;
  const normalised = yes.map((probability) => probability / total);
  const best = indexOfLargest(normalised);
  return { label: labels[best] ?? "", confidence: normalised[best] ?? 0, probabilities: distribution(labels, (label) => normalised[labels.indexOf(label)] ?? 0) };
}

function labelsFromYesNo(labels: ReadonlyArray<string>, yes: ReadonlyArray<number>): AnyCore {
  const applied = labels.filter((_, index) => (yes[index] ?? 0) >= YES_AT);
  return { labels: new Set(applied), confidence: Math.min(...yes.map(yesConfidence)), probabilities: distribution(labels, (label) => yes[labels.indexOf(label)] ?? 0) };
}

function perLabelCore<S extends JsonValue>(plan: Plan<S>, answers: Answers): AnyCore | null {
  if (plan.spec.kind !== "choice" && plan.spec.kind !== "labels") return null;
  const labels = labelsOf(plan.spec.labels);
  const yes = perLabelProbabilities(plan, answers, labels);
  if (yes === null) return null;
  return plan.spec.kind === "choice" ? choiceFromYesNo(labels, yes) : labelsFromYesNo(labels, yes);
}

function choiceCore<S extends JsonValue>(plan: Plan<S>, answers: Answers): AnyCore | null {
  const answer = answerOfKind(answers, plan.key, "choice");
  if (answer === null || plan.spec.kind !== "choice" || !Object.hasOwn(plan.spec.labels, answer.label)) return null;
  const probabilities = distribution(labelsOf(plan.spec.labels), (label) => answer.probabilities[label] ?? 0);
  return { label: answer.label, confidence: answer.confidence, probabilities };
}

function labelsCore<S extends JsonValue>(plan: Plan<S>, answers: Answers): AnyCore | null {
  const answer = answerOfKind(answers, plan.key, "labels");
  if (answer === null || plan.spec.kind !== "labels") return null;
  const labels = labelsOf(plan.spec.labels);
  const probabilities = distribution(labels, (label) => answer.probabilities[label] ?? 0);
  return { labels: new Set(labels.filter((label) => (probabilities[label] ?? 0) >= YES_AT)), confidence: answer.confidence, probabilities };
}

function scoreCore<S extends JsonValue>(plan: Plan<S>, answers: Answers): AnyCore | null {
  const answer = answerOfKind(answers, plan.key, "score");
  if (answer === null || plan.spec.kind !== "score" || answer.probabilities.length !== plan.spec.levels.length) return null;
  const level = indexOfLargest(answer.probabilities);
  return { level, expected: answer.expected, confidence: answer.confidence, probabilities: answer.probabilities };
}

function binaryCore<S extends JsonValue>(plan: Plan<S>, answers: Answers): AnyCore | null {
  const answer = answerOfKind(answers, plan.key, "binary");
  return answer === null ? null : { probability: answer.probability, value: answer.probability >= YES_AT, confidence: answer.confidence };
}

function coreOf<S extends JsonValue>(plan: Plan<S>, answers: Answers): AnyCore | null {
  if (plan.perLabel) return perLabelCore(plan, answers);
  const readers = { choice: choiceCore, labels: labelsCore, score: scoreCore, binary: binaryCore };
  return readers[plan.spec.kind](plan, answers);
}

function refusalIn(plan: Plan<JsonValue>, answers: Answers): string | null {
  for (const question of plan.questions) {
    const answer = answers.get(question.id);
    if (answer?.kind === "refusal") return answer.detail;
  }
  return null;
}

/** The result core a plan's answers add up to, or a refused or malformed failure when they do not stand; how far to trust the core is the router's call. */
export function interpret<S extends JsonValue>(plan: Plan<S>, answers: Answers): Interpreted {
  const refusal = refusalIn(plan, answers);
  if (refusal !== null) return { ok: false, failure: { reason: "refused", detail: refusal } };
  const core = coreOf(plan, answers);
  if (core === null) return { ok: false, failure: { reason: "malformed", detail: `The answers for "${plan.key}" do not fit its ${plan.spec.kind} spec.` } };
  return { ok: true, core };
}
