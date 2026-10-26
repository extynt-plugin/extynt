// The verdict for set_text_document: each requested document field, and any per-range read-back, against the text document the fresh read holds.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { array, boolean, decode, fallback, jsonObject, jsonValue, object, optional } from "@extynt/decode";
import { TEXT_DOCUMENT_FIELDS } from "@extynt/project-graph";
import { sameTextDocumentField } from "./compare-values.js";
import { objectOf } from "./json-fields.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { layerWhere, propertyOf } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import { boundedValueText } from "./value-text.js";

const TEXT_DOCUMENT_PATH = "ADBE Text Properties/ADBE Text Document";
const MAX_UNOBSERVED = 16;

const rangeEvidence = object({ rangeReadback: optional(fallback(object({ matched: optional(fallback(boolean(), undefined)), mismatches: optional(fallback(jsonValue, undefined)) }), undefined)) });
const requestedRanges = object({ characterRanges: optional(fallback(array(fallback(jsonObject, {})), undefined)) });

type RangeReadback = NonNullable<ReturnType<typeof rangeReadbackOf>>;

interface TextCheck {
  readonly state: LayerState;
  readonly text: JsonObject;
  readonly ranges: ReadonlyArray<JsonObject>;
  readonly readback: RangeReadback | undefined;
}

type FieldOutcome = "unobserved" | "compared" | "covered" | VerifiedStep;

function rangeReadbackOf(state: LayerState) {
  const decoded = decode(rangeEvidence, state.step.row);
  return decoded.ok ? decoded.value.rangeReadback : undefined;
}

function rangeVerdict(state: LayerState, readback: RangeReadback | undefined): VerifiedStep | null {
  if (!state.request.row.characterRanges) return null;
  const kind = state.request.operation;
  if (!readback) return unverifiedStep(kind, "text-ranges-not-read-back", layerWhere(state));
  return readback.matched ? null : failedStep(kind, "text-range-mismatch", { ...layerWhere(state), mismatches: readback.mismatches });
}

function expectation(check: TextCheck, field: string): { readonly expected: JsonValue | undefined; readonly covered: boolean } {
  let expected = check.state.request.row[field];
  let covered = false;
  for (const range of check.ranges) {
    if (range[field] === undefined) continue;
    covered = check.readback?.matched === true;
    if (range.start === 0) expected = range[field];
  }
  return { expected, covered };
}

function fieldOutcome(check: TextCheck, field: string): FieldOutcome {
  const { expected, covered } = expectation(check, field);
  const observed = check.text[field];
  if (observed === undefined || observed === null) return covered ? "covered" : "unobserved";
  if (sameTextDocumentField(field, observed, expected)) return "compared";
  return failedStep(check.state.request.operation, "text-document-mismatch", { ...layerWhere(check.state), field, observedValue: boundedValueText(observed), expectedValue: boundedValueText(expected) });
}

function requestedFields(state: LayerState): ReadonlyArray<string> {
  return Object.keys(state.request.row).filter((field) => field in TEXT_DOCUMENT_FIELDS && state.request.row[field] !== undefined);
}

function outcomeVerdict(state: LayerState, compared: number, unobserved: ReadonlyArray<string>): VerifiedStep {
  const kind = state.request.operation;
  const where = layerWhere(state);
  const hasRanges = Boolean(state.request.row.characterRanges);
  if (unobserved.length > 0) return unverifiedStep(kind, "text-document-fields-not-in-snapshot", { ...where, unobservedFields: [...unobserved], comparedFields: compared });
  if (compared > 0 || hasRanges) return exactStep(kind, hasRanges ? "text-document-fields-and-range-readback" : "text-document-fields", where);
  return unverifiedStep(kind, "text-document-no-observable-requested-fields", where);
}

function compareFields(check: TextCheck): VerifiedStep {
  let compared = 0;
  const unobserved: string[] = [];
  for (const field of requestedFields(check.state)) {
    const outcome = fieldOutcome(check, field);
    if (typeof outcome === "object") return outcome;
    if (outcome === "compared") compared += 1;
    if (outcome === "unobserved" && unobserved.length < MAX_UNOBSERVED) unobserved.push(field);
  }
  return outcomeVerdict(check.state, compared, unobserved);
}

/** The verdict for set_text_document. */
export function verifyTextDocument(state: LayerState): VerifiedStep {
  const text = objectOf(propertyOf(state.layer, TEXT_DOCUMENT_PATH)?.value);
  if (!text) return unverifiedStep(state.request.operation, "text-document-not-observable", layerWhere(state));
  const readback = rangeReadbackOf(state);
  const ranged = rangeVerdict(state, readback);
  if (ranged) return ranged;
  const decoded = decode(requestedRanges, state.request.row);
  return compareFields({ state, text, readback, ranges: decoded.ok ? (decoded.value.characterRanges ?? []) : [] });
}
