// Property resolution: which property of a layer or an effect a request means to change, as a closed choice built at run time from that target's own properties.
import { array, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { runtimeChoice } from "./candidate-search.js";
import type { Candidate, Habits } from "./candidate-search.js";
import { pickAttribute, standAttributes } from "./resolution-attributes.js";
import { standingConfidence } from "./resolution-confidence.js";
import type { ChoiceSpec } from "./spec.js";

const propertyCandidate = object({ key: string({ nonEmpty: true }), title: string({ nonEmpty: true }), group: string() });

/** The decoder for the properties of one layer or effect. */
export const propertyCandidates = array(propertyCandidate);

/** A property that can change: the key it is addressed by, the name After Effects shows and the group it sits in. */
export type PropertyCandidate = Infer<typeof propertyCandidate>;

/** What the property choice reads: the words used for the change and the name of the layer or effect they are about. */
export type PropertyRequest = { readonly phrase: string; readonly target: string };

const INSTRUCTIONS = [
  "A motion designer's request changes one property of the target named in the state. Pick the property they mean, by its key.",
  "Go by meaning: fading is opacity, spinning is rotation, growing or shrinking is scale, sliding or moving is position, strength or amount of a blur is its blurriness or radius; requests in any language count.",
  "Answer none when the request names no property of this target, when the words fit several properties equally well and nothing tells them apart,",
  "or no property does what was asked: it must change the same quantity, on the same axis and in the same direction, and a nearby property that changes something else (size for strength, distance for direction, one axis for the other) is no stand-in.",
].join(" ");

const NONE_MEANING = "no property of this target changes the specific quantity the request asks about, or the request cannot tell the properties apart";

function asCandidate(property: PropertyCandidate): Candidate {
  return { key: property.key, names: [property.title], group: property.group, title: property.title };
}

/**
 * The closed question "which property does the phrase mean?": one label per property key plus "none". The offline answer is the best-ranked
 * property whose names hold every word of the phrase, else the property the request words point at (fade is opacity, spin is rotation), else "none".
 */
export function propertyChoice(properties: ReadonlyArray<PropertyCandidate>, habits?: Habits): ChoiceSpec<PropertyRequest, string> {
  const candidates = properties.map(asCandidate);
  const base = runtimeChoice<PropertyRequest>({ name: "property", instructions: INSTRUCTIONS, noneMeaning: NONE_MEANING, candidates, ...(habits === undefined ? {} : { habits }) });
  const deterministic = (state: PropertyRequest): string => pickAttribute(state.phrase, state.target, candidates, habits?.score);
  const deterministicConfidence = (state: PropertyRequest): number => standingConfidence(standAttributes(state.phrase, state.target, candidates, habits?.score));
  return { ...base, deterministic, deterministicConfidence };
}
