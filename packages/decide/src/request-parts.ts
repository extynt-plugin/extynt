// The request-parts decision: which features a request asks for, and the completion decision: which of those the executed operations do not yet show.
import { labels } from "./spec.js";
import type { LabelsSpec } from "./spec.js";
import { FEATURES, FEATURE_DESCRIPTIONS, FEATURE_IDS, ignoredSpans } from "./request-features.js";
import { rampReading } from "./ramp-context.js";
import type { AppliedStep, FeatureId } from "./request-features.js";
import { readPart } from "./request-parts-reading.js";
import { foldRequest } from "./request-text.js";

/** What the request-parts decision reads: the user's request, in any language. */
export type RequestText = { readonly request: string };

/** What the completion decision reads: the request and the operations executed for it. */
export type RequestProgress = { readonly request: string; readonly applied: ReadonlyArray<AppliedStep> };

/** The features a request asks for under the refusal reading: a mention is asked unless a cue such as no, without or don't reaches it. */
export function featuresAsked(request: string): ReadonlyArray<FeatureId> {
  const text = foldRequest(request);
  return FEATURE_IDS.filter((id) => readPart(text, FEATURES[id].pattern, ignoredSpans(id, request)) === "asked");
}

const DOUBTFUL_COST = 0.12;

const REFUSED_COST = 0.04;

const CROWDED_FROM = 6;

const CROWDED_COST = 0.04;

const AMBIGUOUS_RAMP_COST = 0.5;

/** How sure the feature reading is: a mention refused by a cue beside it costs a little, one refused by a far cue, a list or a context costs more, and the more features a request asks the likelier one was missed or over-read. */
export function partsConfidence(request: string, asked: ReadonlyArray<FeatureId>): number {
  const text = foldRequest(request);
  const readings = FEATURE_IDS.filter((id) => !asked.includes(id)).map((id) => readPart(text, FEATURES[id].pattern, ignoredSpans(id, request)));
  const cost = readings.filter((reading) => reading === "doubtful").length * DOUBTFUL_COST + readings.filter((reading) => reading === "refused").length * REFUSED_COST;
  const unclearRamp = rampReading(request) === "ambiguous" ? AMBIGUOUS_RAMP_COST : 0;
  return Math.max(0, 1 - cost - unclearRamp - CROWDED_COST * Math.max(0, asked.length - CROWDED_FROM));
}

/** Every feature the request asks the artist to make, naming it in any language; a feature the request rules out (no glow, without a blur) is not asked. */
export const REQUEST_PARTS: LabelsSpec<RequestText, FeatureId> = labels<RequestText, FeatureId>({
  name: "request-parts",
  instructions: [
    "A motion designer's request asks for some features to be made in After Effects. Pick every feature the request asks for, whatever language it is written in.",
    "A feature the request rules out (no glow, without a blur, don't dolly) is not asked for. A feature only mentioned as context or as something that already exists is not asked for.",
    "Motion blur, the layer switch, is not a blur effect.",
  ].join(" "),
  labels: FEATURE_DESCRIPTIONS,
  criteria: {
    true: "The request asks for this feature to be made.",
    false: "The request does not mention this feature, rules it out (no glow, without a blur), or mentions it only as context.",
  },
  abstainBelow: 0.6,
  deterministic: (state) => featuresAsked(state.request),
  deterministicConfidence: (state, answer) => partsConfidence(state.request, answer),
});

/** The features the request asks for that no executed operation shows yet; an empty answer means the request is done. */
export const REQUEST_MISSING: LabelsSpec<RequestProgress, FeatureId> = labels<RequestProgress, FeatureId>({
  name: "request-missing",
  instructions: [
    "A motion designer's request asked for some features, and a list of the operations already executed for it is given (each with its type and its payload as JSON).",
    "Pick every feature the request asks for, whatever language it is written in, that the executed operations do not show was made.",
    "A feature the request rules out (no glow, without a blur) is not asked for, so it is never missing. Pick nothing when every asked feature is shown.",
  ].join(" "),
  labels: FEATURE_DESCRIPTIONS,
  stakes: "high",
  criteria: {
    true: "The request asks for this feature and the executed operations do not show that it was made.",
    false: "The request does not ask for this feature, rules it out, or the executed operations show it was made.",
  },
  deterministic: (state) => featuresAsked(state.request).filter((id) => !FEATURES[id].shown(state.applied)),
});
