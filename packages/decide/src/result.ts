// What a decision returns: the typed answer, plus where it came from and, when it fell back, why.
import type { Failure } from "./port.js";
import type { AnySpec } from "./spec.js";
import type { JsonValue } from "./json.js";

/** Which tier produced a result. */
export type DecisionSource = "decision-model" | "model" | "deterministic";

/** How a decision model's confidence routed its answer: taken (act), checked against the deterministic answer (verify) or dropped (escalate). */
export type Band = "act" | "verify" | "escalate";

/** The provider that was tried and failed, and how. */
export interface Fallback extends Failure {
  readonly provider: string;
}

/**
 * Where a result came from. `provider`, `calibrated`, `model` and `inputTokens` are null for a deterministic result (`model` and
 * `inputTokens` describe the whole batch the answer came in); `band` says how confidence routed the answer, and is null when no model was tried;
 * `fallback` is null when nothing failed; `abstained` is true when the offline answer was below its spec's abstain threshold, so the answer stands but is reported unsure, in the escalate band; `imageSent` is true only when the provider that answered was sent a picture with the batch.
 */
export interface Provenance {
  readonly source: DecisionSource;
  readonly provider: string | null;
  readonly calibrated: boolean | null;
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly imageSent: boolean;
  readonly band: Band | null;
  readonly abstained: boolean;
  readonly fallback: Fallback | null;
}

interface ChoiceCore<L extends string> {
  readonly label: L;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<L, number>>;
}

interface LabelsCore<L extends string> {
  readonly labels: ReadonlySet<L>;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<L, number>>;
}

interface ScoreCore {
  readonly level: number;
  readonly expected: number;
  readonly confidence: number;
  readonly probabilities: ReadonlyArray<number>;
}

interface BinaryCore {
  readonly probability: number;
  readonly value: boolean;
  readonly confidence: number;
}

/** The result of a choice decision. */
export type ChoiceResult<L extends string> = ChoiceCore<L> & Provenance;

/** The result of a multi-label decision. */
export type LabelsResult<L extends string> = LabelsCore<L> & Provenance;

/** The result of a rubric decision. */
export type ScoreResult = ScoreCore & Provenance;

/** The result of a yes or no decision. */
export type BinaryResult = BinaryCore & Provenance;

/** The untyped core of any result, as the resolver builds it before the public types are applied. */
export type AnyCore = ChoiceCore<string> | LabelsCore<string> | ScoreCore | BinaryCore;

/** The result type a spec promises, inferred from the spec's kind and label keys. */
export type ResultOf<X> = X extends { readonly kind: "choice"; readonly labels: infer M }
  ? ChoiceResult<Extract<keyof M, string>>
  : X extends { readonly kind: "labels"; readonly labels: infer M }
    ? LabelsResult<Extract<keyof M, string>>
    : X extends { readonly kind: "score" }
      ? ScoreResult
      : X extends { readonly kind: "binary" }
        ? BinaryResult
        : never;

/** The record of results `decideAll` returns for a record of specs. */
export type ResultsOf<D> = { readonly [K in keyof D]: ResultOf<D[K]> };

/** A record of specs sharing one state type. */
export type Decisions<S extends JsonValue> = Readonly<Record<string, AnySpec<S>>>;
