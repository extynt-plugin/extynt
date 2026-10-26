// Control resolution: which control of an effect a request phrase means, as a closed choice built at run time from that effect's own controls.
import { array, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { runtimeChoice } from "./candidate-search.js";
import { pickAttribute, standAttributes } from "./resolution-attributes.js";
import { standingConfidence } from "./resolution-confidence.js";
import type { Candidate, Habits } from "./candidate-search.js";
import type { ChoiceSpec } from "./spec.js";

const controlCandidate = object({ matchName: string({ nonEmpty: true }), displayName: string({ nonEmpty: true }), valueType: string() });

/** The decoder for the controls of one effect. */
export const controlCandidates = array(controlCandidate);

/** A control of an effect: its match name, the name the Effect Controls panel shows and the kind of value it holds. */
export type ControlCandidate = Infer<typeof controlCandidate>;

/** What the control choice reads: the words used for the control and the display name of the effect they are about. */
export type ControlRequest = { readonly phrase: string; readonly effect: string };

const INSTRUCTIONS = [
  "A motion designer's request is about one control of the effect named in the state. Pick the control they mean, by its match name.",
  "Go by meaning: strength, amount or size of a blur is its blurriness or radius; how far a shadow sits is its distance; requests in any language count.",
  "Answer none when the request names no control of this effect, when the phrase fits several controls equally well and nothing in it tells them apart,",
  "or no control does what was asked: it must change the same quantity, on the same axis and in the same direction, and a nearby control of the same effect that changes something else (size for strength, distance for direction, one axis for the other) is no stand-in.",
].join(" ");

const NONE_MEANING = "no control of this effect changes the specific quantity the request asks about, or the request cannot tell the controls apart";

function asCandidate(control: ControlCandidate): Candidate {
  return { key: control.matchName, names: [control.displayName, control.matchName], group: control.valueType, title: control.displayName };
}

/** The closed question "which control of this effect does the phrase mean?": one label per control match name plus "none"; the offline answer is the best-ranked control whose names hold every word. */
export function controlChoice(controls: ReadonlyArray<ControlCandidate>, habits?: Habits): ChoiceSpec<ControlRequest, string> {
  const candidates = controls.map(asCandidate);
  const base = runtimeChoice<ControlRequest>({ name: "control", instructions: INSTRUCTIONS, noneMeaning: NONE_MEANING, candidates, ...(habits === undefined ? {} : { habits }) });
  return {
    ...base,
    deterministic: (state) => pickAttribute(state.phrase, state.effect, candidates, habits?.score),
    deterministicConfidence: (state) => standingConfidence(standAttributes(state.phrase, state.effect, candidates, habits?.score)),
  };
}
