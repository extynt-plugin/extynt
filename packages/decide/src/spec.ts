// Decision specs: the constant, typed declaration of one fuzzy decision, with the pure function that answers it offline.
import type { JsonValue } from "./json.js";

/** Labels with an optional description each; `null` means the label name says enough. */
export type Labelled<L extends string> = { readonly [K in L]: string | null };

/** What a yes or no question means in each answer, for the model to read next to the instructions. */
export interface Criteria {
  readonly true: string;
  readonly false: string;
}

/** The two confidences that route a decision model's answer: at `act` it is taken, between `verify` and `act` it is checked against the deterministic answer, below `verify` it is dropped. */
export interface Bands {
  readonly verify: number;
  readonly act: number;
}

interface SpecBase {
  readonly name: string;
  readonly instructions: string;
  readonly threshold?: number;
  readonly bands?: Bands;
  readonly stakes?: "high";
  readonly abstainBelow?: number;
  readonly useModel?: true;
  readonly deterministicOnly?: true;
  readonly wantsImage?: true;
  readonly needsImage?: true;
}

/**
 * Pick exactly one of the labels. A spec may set `threshold` to override its provider's, `bands` to route answers by confidence,
 * `stakes: "high"` to keep a disagreeing model answer out, `useModel` to opt in to the user's own language model (which costs a turn),
 * `deterministicOnly` for a lookup over facts the state already holds, which no model is asked, because a model can only guess what the facts settle,
 * `preference` (a score per label, from the user's history) to settle near-ties, and `guarded` to name labels that are costly to get wrong:
 * a model answer of a guarded label is taken only in the act band, never by overruling the deterministic answer.
 * Any spec may set `abstainBelow` and a `deterministicConfidence` function (the offline answer's confidence from 0 to 1, 1 when absent): an offline
 * answer whose confidence is below `abstainBelow` is reported as abstained, in the escalate band, instead of as a confident answer.
 * Any spec may set `needsImage` to say it cannot be judged without the picture: it is then asked only of a provider that accepts images and only when an image is given, otherwise it is answered offline with the fallback reason `image-unavailable`. A spec that sets it sets `wantsImage` too, and a model that sees images answers it without a `useModel` opt-in.
 * Any spec may set `wantsImage` to say a picture of the frame helps; the picture goes only to a provider that accepts images, and the offline answer never sees it.
 */
export interface ChoiceSpec<S extends JsonValue, L extends string> extends SpecBase {
  readonly kind: "choice";
  readonly labels: Labelled<L>;
  readonly preference?: Readonly<Partial<Record<L, number>>>;
  readonly guarded?: ReadonlyArray<L>;
  deterministic(state: S): NoInfer<L>;
  deterministicConfidence?(state: S, answer: NoInfer<L>): number;
}

/** Pick every label that applies, possibly none; `criteria` applies to the yes or no question asked for each label. */
export interface LabelsSpec<S extends JsonValue, L extends string> extends SpecBase {
  readonly kind: "labels";
  readonly labels: Labelled<L>;
  readonly criteria?: Criteria;
  deterministic(state: S): ReadonlyArray<NoInfer<L>>;
  deterministicConfidence?(state: S, answer: ReadonlyArray<NoInfer<L>>): number;
}

/** Place the state on a rubric of ordered level descriptions; the deterministic answer is a level index. */
export interface ScoreSpec<S extends JsonValue> extends SpecBase {
  readonly kind: "score";
  readonly levels: readonly [string, string, ...string[]];
  deterministic(state: S): number;
  deterministicConfidence?(state: S, answer: number): number;
}

/** Answer yes or no; `criteria` says what each answer means. */
export interface BinarySpec<S extends JsonValue> extends SpecBase {
  readonly kind: "binary";
  readonly criteria?: Criteria;
  deterministic(state: S): boolean;
  deterministicConfidence?(state: S, answer: boolean): number;
}

/** Any decision spec over the given state. */
export type AnySpec<S extends JsonValue> = ChoiceSpec<S, string> | LabelsSpec<S, string> | ScoreSpec<S> | BinarySpec<S>;

/** The kind of a decision, which is also the kind of question a decision model is asked. */
export type DecisionKind = AnySpec<JsonValue>["kind"];

const MAX_SCORE_LEVELS = 10;

const MAX_CHOICE_LABELS = 255;

/** The labels of a spec, in declaration order. */
export function labelsOf<L extends string>(labelled: Labelled<L>): ReadonlyArray<L> {
  return Object.keys(labelled).filter((key): key is L => Object.hasOwn(labelled, key));
}

function requireLabelCount(spec: { readonly name: string; readonly labels: Labelled<string> }, maximum: number): void {
  const count = Object.keys(spec.labels).length;
  if (count < 1 || count > maximum) throw new RangeError(`Decision "${spec.name}" needs 1 to ${maximum} labels, found ${count}.`);
}

/** Declares a choice decision; throws a RangeError at declaration when the label count is outside 1 to 255. */
export function choice<S extends JsonValue, const L extends string>(spec: Omit<ChoiceSpec<S, L>, "kind">): ChoiceSpec<S, L> {
  requireLabelCount(spec, MAX_CHOICE_LABELS);
  return { kind: "choice", ...spec };
}

/** Declares a multi-label decision; throws a RangeError at declaration when the label count is outside 1 to 255. */
export function labels<S extends JsonValue, const L extends string>(spec: Omit<LabelsSpec<S, L>, "kind">): LabelsSpec<S, L> {
  requireLabelCount(spec, MAX_CHOICE_LABELS);
  return { kind: "labels", ...spec };
}

/** Declares a rubric decision; throws a RangeError at declaration when there are more than 10 levels. */
export function score<S extends JsonValue>(spec: Omit<ScoreSpec<S>, "kind">): ScoreSpec<S> {
  if (spec.levels.length > MAX_SCORE_LEVELS) throw new RangeError(`Decision "${spec.name}" has ${spec.levels.length} levels; the most is ${MAX_SCORE_LEVELS}.`);
  return { kind: "score", ...spec };
}

/** Declares a yes or no decision. */
export function binary<S extends JsonValue>(spec: Omit<BinarySpec<S>, "kind">): BinarySpec<S> {
  return { kind: "binary", ...spec };
}
