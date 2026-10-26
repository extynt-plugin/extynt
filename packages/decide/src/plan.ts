// Turns a decision spec into the questions a particular decision model can answer, mapping kinds it lacks onto kinds it has.
import type { JsonValue } from "./json.js";
import type { LabelEntry, Question } from "./port.js";
import type { AnySpec, Criteria, DecisionKind, Labelled } from "./spec.js";

/** The questions asked for one decision, and whether they are one question per label standing in for the decision. */
export interface Plan<S extends JsonValue> {
  readonly key: string;
  readonly spec: AnySpec<S>;
  readonly questions: ReadonlyArray<Question>;
  readonly perLabel: boolean;
}

const FAN_OUT_SEPARATOR = "::";

/** The id of the yes or no question that stands in for one label of a decision. */
export function fanOutId(key: string, label: string): string {
  return `${key}${FAN_OUT_SEPARATOR}${label}`;
}

function entriesOf(labelled: Labelled<string>): ReadonlyArray<LabelEntry> {
  return Object.entries(labelled).map(([label, description]) => ({ label, description }));
}

function labelQuestion(key: string, instructions: string, entry: LabelEntry, criteria: Criteria | undefined): Question {
  const meaning = entry.description === null ? "" : ` (${entry.description})`;
  return { id: fanOutId(key, entry.label), kind: "binary", instructions: `${instructions}\n\nDoes "${entry.label}"${meaning} apply?`, ...(criteria === undefined ? {} : { criteria }) };
}

function labelledPlan<S extends JsonValue>(key: string, spec: Extract<AnySpec<S>, { readonly kind: "choice" | "labels" }>, supports: ReadonlySet<DecisionKind>): Plan<S> | null {
  const entries = entriesOf(spec.labels);
  if (supports.has(spec.kind)) {
    return { key, spec, perLabel: false, questions: [{ id: key, kind: spec.kind, instructions: spec.instructions, labels: entries }] };
  }
  if (!supports.has("binary")) return null;
  return { key, spec, perLabel: true, questions: entries.map((entry) => labelQuestion(key, spec.instructions, entry, spec.kind === "labels" ? spec.criteria : undefined)) };
}

/** The plan for a decision on a model that supports the given kinds, or null when the model cannot serve it at all. */
export function planFor<S extends JsonValue>(key: string, spec: AnySpec<S>, supports: ReadonlySet<DecisionKind>): Plan<S> | null {
  if (spec.kind === "choice" || spec.kind === "labels") return labelledPlan(key, spec, supports);
  if (!supports.has(spec.kind)) return null;
  const question: Question = spec.kind === "score"
    ? { id: key, kind: "score", instructions: spec.instructions, levels: spec.levels }
    : { id: key, kind: "binary", instructions: spec.instructions, ...(spec.criteria === undefined ? {} : { criteria: spec.criteria }) };
  return { key, spec, perLabel: false, questions: [question] };
}
