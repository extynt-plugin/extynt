/**
 * The variant card's words and shapes: what the sidecar's GET /v1/variants says, how a value reads on a tile, the sentence
 * for each way a choice can end. Decoders and pure derivations only: the options, their labels and their values are the
 * model's, and a choice is the sidecar's to make.
 */
import type { Decoder, Infer } from "@extynt/decode";
import type { TransportError } from "./panel-transport.js";
import { currentLanguage, t } from "./panel-language.js";
import { plainTextOf, type UiKey } from "@extynt/ui-text";
import { planUpdateDecoder } from "./plan-content.js";
import type { PlanUpdate } from "./plan-content.js";
import { array, fallback, literal, map, number, object, record, refine, skippingInvalid, string, union } from "@extynt/decode";

type VariantValue = number | ReadonlyArray<number>;
/** One option on a tile. */
export interface VariantCandidate { readonly index: number; readonly label: string; readonly value: VariantValue; readonly current: boolean; readonly picture: string | null }
interface VariantFrame {
  readonly id: string; readonly name: string; readonly width: number; readonly height: number; readonly duration: number | null;
  readonly frameRate: number | null; readonly time: number; readonly background: readonly [number, number, number] | null;
}
interface VariantTarget { readonly compositionId: string; readonly layerId: string; readonly effectPath: string; readonly propertyPath: string; readonly effectMatchName: string }
type VariantCandidates = readonly [VariantCandidate, VariantCandidate, ...VariantCandidate[]];
/** One question: a choice of values for one control. */
export interface VariantSet {
  readonly setId: string; readonly status: "open" | "picked" | "dismissed"; readonly reason: string; readonly question: string; readonly control: string;
  readonly layer: string; readonly stale: boolean; readonly target: VariantTarget; readonly frame: VariantFrame | null; readonly candidates: VariantCandidates;
}
/** The sidecar's answer to a pick: how it ended, and the plan it left, when it left one. */
export interface ChoiceAnswer { readonly outcome: string; readonly plan: PlanUpdate | null }
type Pictures = ReadonlyArray<readonly [number, string]>;

const PICTURE_PREFIX = "data:image/";
const FINAL_CODES: ReadonlySet<string> = new Set(["VARIANT_SET_STALE", "VARIANT_SET_EXPIRED", "VARIANT_SET_CLOSED", "VARIANT_PLAN_UNAVAILABLE", "VARIANT_SET_NOT_FOUND"]);
const CLOSED_REASON_KEYS: ReadonlyMap<string, UiKey> = new Map<string, UiKey>([
  ["superseded", "chat.variants.supersededNote"],
  ["stale", "chat.variants.staleNote"],
  ["expired", "chat.variants.expiredNote"],
]);

function pictureOf(url: string | null): string | null { return url !== null && url.startsWith(PICTURE_PREFIX) ? url : null; }

const valueDecoder: Decoder<VariantValue> = union(number(), array(number(), { minLength: 2, maxLength: 4 }));
const candidateFields = object({ index: fallback(number(), null), label: string({ nonEmpty: true }), value: valueDecoder, current: fallback(literal(true), false), picture: map(fallback(string(), null), pictureOf) });
type CandidateFields = Infer<typeof candidateFields>;

function candidatesAt(entries: ReadonlyArray<CandidateFields | null>): ReadonlyArray<VariantCandidate> {
  return entries.flatMap((entry, position) => (entry ? [{ ...entry, index: entry.index ?? position }] : []));
}

function isOfferable(candidates: ReadonlyArray<VariantCandidate>): candidates is VariantCandidates {
  return candidates.length >= 2 && candidates.length <= 4;
}

const candidatesDecoder = refine(map(array(fallback(candidateFields, null)), candidatesAt), isOfferable, "two to four options");

function colourOf(entries: ReadonlyArray<number | null>): readonly [number, number, number] | null {
  const [red, green, blue] = entries;
  return typeof red === "number" && typeof green === "number" && typeof blue === "number" ? [red, green, blue] : null;
}

const frameDecoder: Decoder<VariantFrame> = map(
  object({
    id: string({ nonEmpty: true }), name: fallback(string(), ""), width: number(), height: number(), duration: fallback(number(), null), frameRate: fallback(number(), null),
    currentTime: fallback(number(), 0), backgroundColor: map(fallback(array(fallback(number(), null)), []), colourOf)
  }),
  (frame) => ({ id: frame.id, name: frame.name, width: frame.width, height: frame.height, duration: frame.duration, frameRate: frame.frameRate, time: frame.currentTime, background: frame.backgroundColor })
);

const targetDecoder: Decoder<VariantTarget> = object({
  compositionId: string({ nonEmpty: true }), layerId: string({ nonEmpty: true }), effectPath: fallback(string(), ""),
  propertyPath: string({ nonEmpty: true }), effectMatchName: string({ nonEmpty: true })
});

const setDecoder: Decoder<VariantSet> = map(
  object({
    setId: string({ nonEmpty: true }), status: literal("open", "picked", "dismissed"), reason: fallback(string(), ""), question: fallback(string(), ""),
    names: fallback(object({ control: fallback(string(), ""), layer: fallback(string(), "") }), null), stale: fallback(literal(true), false), target: targetDecoder, composition: fallback(frameDecoder, null),
    candidates: candidatesDecoder
  }),
  (set) => ({
    setId: set.setId, status: set.status, reason: set.reason, question: set.question, control: set.names?.control ?? "", layer: set.names?.layer ?? "",
    stale: set.stale, target: set.target, frame: set.composition, candidates: set.candidates
  })
);

/** The sidecar's list. A set that does not read cleanly is left out, never guessed at. */
export const variantSetsAnswer: Decoder<ReadonlyArray<VariantSet>> = map(object({ ok: literal(true), sets: skippingInvalid(setDecoder) }), (answer) => answer.sets);

/** The sidecar's answer to a pick. The plan it left joins the waiting list like any plan. */
export const choiceAnswer: Decoder<ChoiceAnswer> = object({ ok: literal(true), outcome: fallback(string(), ""), plan: fallback(planUpdateDecoder, null) });

/** The pictures of the options once the host lane has made them. */
export const previewAnswer: Decoder<Pictures> = map(
  object({ status: literal("ready"), pictures: record(string(), fallback(string(), null)) }),
  (answer) => Object.entries(answer.pictures).flatMap(([index, url]) => {
    const picture = pictureOf(url);
    return picture === null ? [] : [[Number(index), picture] as const];
  })
);

function numberWords(value: number): string { return String(Number(value.toPrecision(4))); }

/** One value on a tile: "6", or "1, 0.5, 0" for a vector. */
export function valueWords(value: VariantValue): string {
  return typeof value === "number" ? numberWords(value) : value.map((part) => numberWords(part)).join(", ");
}

/** The line above the tiles: the model's own question when it asked one, otherwise what is being chosen. */
export function headline(set: VariantSet): string {
  if (set.question) return set.question;
  if (set.control) return set.layer ? t("chat.variants.pickValueOnLayer", { control: set.control, layer: set.layer }) : t("chat.variants.pickValue", { control: set.control });
  return set.layer ? t("chat.variants.pickValueThisControlOnLayer", { layer: set.layer }) : t("chat.variants.pickValueThisControl");
}

/** The plain-words status for what a successful answer did. */
export function outcomeLine(outcome: string, candidate: VariantCandidate | null): string {
  if (outcome === "picked") return candidate ? t("chat.variants.chosenNamed", { label: candidate.label }) : t("chat.variants.chosenOption");
  if (outcome === "kept_current") return t("chat.variants.keptCurrent");
  return t("chat.variants.leftAsIs");
}

/** How a set that closed without the user's answer reads on its card. */
export function closedLine(set: VariantSet): string {
  if (set.status === "picked") return set.reason === "kept_current" ? t("chat.variants.keptCurrent") : t("chat.variants.chosen");
  const key = CLOSED_REASON_KEYS.get(set.reason);
  return key ? plainTextOf(currentLanguage(), key) : t("chat.variants.leftAsIs");
}

/** Refusals that end the question: the set is closed on the sidecar's side, so the card stops offering buttons. */
export function isFinal(error: TransportError): boolean { return error.code !== null && FINAL_CODES.has(error.code); }

/** The plain fallback sentence for a choice that did not go through; never a code. */
export function failedLine(): string { return t("chat.variants.failed"); }

/** The sidecar's own sentence for a refusal (it is written for the user), or the plain fallback. */
export function failureLine(error: TransportError): string { return error.code === null ? failedLine() : error.reason; }
