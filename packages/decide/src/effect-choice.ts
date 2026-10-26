// Effect resolution: which of a shortlist of installed effects a request phrase means, as a closed choice built at run time.
import { array, object, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { rankedCandidates, runtimeChoice } from "./candidate-search.js";
import type { Candidate, Habits } from "./candidate-search.js";
import { rankEffects } from "./resolution-effects.js";
import type { ChoiceSpec } from "./spec.js";

const effectCandidate = object({ matchName: string({ nonEmpty: true }), displayName: string({ nonEmpty: true }), category: string() });

/** The decoder for a list of installed effects. */
export const effectCandidates = array(effectCandidate);

/** What the effect choice reads: the words the user used for the effect. */
export type EffectRequest = { readonly phrase: string };

/** An installed effect: the match name After Effects knows it by, the name its menu shows, and its menu category. */
export type EffectCandidate = Infer<typeof effectCandidate>;

/** How many search hits make a shortlist: enough to hold near-duplicates, far below the 255-label limit. */
export const EFFECT_SHORTLIST_LIMIT = 32;

/** The instructions of the effect question, shared by the flat choice and the tournament. */
export const EFFECT_INSTRUCTIONS = [
  "A motion designer's request names a visual effect. Pick the one candidate effect they mean, by its match name.",
  "Go by meaning, not spelling: soften, defocus or feather mean a blur; bloom means a glow; requests in any language count.",
  "Choose the closest specific effect when the request describes a look (a sharp-edged streak is directional, a bokeh blur is a lens blur).",
  "Answer none when the request names no effect, rejects it (no glow, without blur), fits candidates of unrelated kinds, or no candidate does what was asked:",
  "a candidate must do the specific thing asked, with the same kind of look and the same method (a radial, zoom or spin blur is not a plain blur, a wipe is not an iris or a key, a sharpen is not a blur, a colour key is not a luma key);",
  "a same-family candidate that does something else is no stand-in, and a plugin or product named but not listed is none.",
  "When it names only a kind of effect (a blur, a glow, a shadow), pick the most common effect of that kind, such as Gaussian Blur for a plain blur.",
].join(" ");

/** What "none" means in the effect question. */
export const EFFECT_NONE_MEANING = "no candidate does the specific thing the request asks (a neighbour of the same family that does something else, or an unlisted plugin, is none), or the request names no effect, rejects it or fits unrelated kinds";

/** The candidate form of an installed effect. */
export function asEffectCandidate(effect: EffectCandidate): Candidate {
  return { key: effect.matchName, names: [effect.matchName, effect.displayName], group: effect.category, title: effect.displayName };
}

/** The effects whose names or category hold every word of the phrase, best first and at most `limit`: the shortlist the choice is built from. */
export function shortlistEffects(phrase: string, installed: ReadonlyArray<EffectCandidate>, limit: number = EFFECT_SHORTLIST_LIMIT): ReadonlyArray<EffectCandidate> {
  const byKey = new Map(installed.map((effect) => [effect.matchName, effect]));
  const candidates = installed.map(asEffectCandidate);
  const keys = [...new Set([...rankEffects(phrase, candidates), ...rankedCandidates(phrase, candidates).map((candidate) => candidate.key)])].slice(0, limit);
  return keys.flatMap((key) => byKey.get(key) ?? []);
}

/**
 * The closed question "which of these effects does the phrase mean?": one label per shortlisted match name plus "none". Throws a
 * RangeError when the shortlist is longer than 254 effects. The offline answer is the best-ranked effect whose names hold every word, a tie going to the user's habit.
 */
export function effectChoice(shortlist: ReadonlyArray<EffectCandidate>, habits?: Habits): ChoiceSpec<EffectRequest, string> {
  return runtimeChoice<EffectRequest>({ name: "effect", instructions: EFFECT_INSTRUCTIONS, noneMeaning: EFFECT_NONE_MEANING, candidates: shortlist.map(asEffectCandidate), ...(habits === undefined ? {} : { habits }) });
}
