// The decision-model port: what a provider that answers decision questions must offer, kept free of any one vendor.
import type { Bands, Criteria, DecisionKind } from "./spec.js";
import type { JsonValue } from "./json.js";

/** A label offered to a decision model, with the description that tells it what the label means. */
export interface LabelEntry {
  readonly label: string;
  readonly description: string | null;
}

/** One question in a batch; `id` is how the provider's answer finds its way back. */
export type Question =
  | { readonly id: string; readonly kind: "choice" | "labels"; readonly instructions: string; readonly labels: ReadonlyArray<LabelEntry> }
  | { readonly id: string; readonly kind: "score"; readonly instructions: string; readonly levels: ReadonlyArray<string> }
  | { readonly id: string; readonly kind: "binary"; readonly instructions: string; readonly criteria?: Criteria };

/** A provider's answer to one question, stating how sure it is from 0 to 1, or its refusal to answer that one question. */
export type Answer =
  | { readonly kind: "choice"; readonly label: string; readonly confidence: number; readonly probabilities: Readonly<Record<string, number>> }
  | { readonly kind: "labels"; readonly confidence: number; readonly probabilities: Readonly<Record<string, number>> }
  | { readonly kind: "score"; readonly expected: number; readonly confidence: number; readonly probabilities: ReadonlyArray<number> }
  | { readonly kind: "binary"; readonly probability: number; readonly confidence: number }
  | { readonly kind: "refusal"; readonly detail: string };

/** Why a provider could not answer, so a receipt can tell a bad key from a busy server from a bad reply. */
export type FailureReason =
  | "unauthorized"
  | "rejected"
  | "backoff"
  | "unavailable"
  | "refused"
  | "timeout"
  | "malformed"
  | "low-confidence"
  | "disagreement"
  | "state-too-large"
  | "image-unavailable";

/** A typed failure: the reason, and the provider's own words for it. */
export interface Failure {
  readonly reason: FailureReason;
  readonly detail: string;
}

interface Usage {
  readonly model: string | null;
  readonly inputTokens: number | null;
}

/** The outcome of one batched call: an answer for each question id and what the batch used, or a typed failure for the whole batch. */
export type DecisionOutcome =
  | { readonly ok: true; readonly answers: ReadonlyMap<string, Answer>; readonly usage: Usage }
  | { readonly ok: false; readonly failure: Failure };

/** A picture a question may look at: its media type (for example "image/png") and its bytes as base64 without a data-URL prefix; never logged. */
export interface DecisionImage {
  readonly mediaType: string;
  readonly base64: string;
}

/** Where a provider sits in the resolution order: purpose-built decision models run before the user's language model. */
export type ModelTier = "decision-model" | "model";

/**
 * Something that answers batches of decision questions; the resolver maps the kinds it lacks onto the kinds it has.
 * `calibrated` says whether confidences are real probabilities, and `threshold` is the confidence below which this
 * provider's answers are discarded: thresholds belong to a provider because one vendor's 0.7 is not another's.
 * `acceptsImages` says the provider reads a picture next to the numbers; absent means it does not, and it is then never sent one. `imageOnly` limits the provider to the questions that need an image.
 */
export interface DecisionModel {
  readonly id: string;
  readonly tier: ModelTier;
  readonly supports: ReadonlySet<DecisionKind>;
  readonly calibrated: boolean;
  readonly threshold: number;
  readonly bands?: Bands;
  readonly acceptsImages?: boolean;
  readonly imageOnly?: boolean;
  decide(state: JsonValue, questions: ReadonlyArray<Question>, signal: AbortSignal, image?: DecisionImage): Promise<DecisionOutcome>;
}
