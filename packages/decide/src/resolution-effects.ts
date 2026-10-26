// The offline effect resolver: scores installed effects against a request with the effect word tables and picks the clear winner.
import { compileConcepts, conceptHits } from "./resolution-concepts.js";
import { withoutBareRamp } from "./ramp-context.js";
import { BLUR_SHARPEN_WORDS } from "./resolution-effect-words-blur-sharpen.js";
import { COLOUR_GRADE_WORDS } from "./resolution-effect-words-colour-grade.js";
import { DISTORT_STYLIZE_WORDS } from "./resolution-effect-words-distort-stylize.js";
import { TIME_TRANSITION_WORDS } from "./resolution-effect-words-time-transition.js";
import { LOOK_WORDS } from "./resolution-effect-words-look.js";
import { MOTION_WORDS } from "./resolution-effect-words-motion.js";
import { FIGURATIVE_WORDS } from "./resolution-effect-words-figurative.js";
import { HABIT_WORDS } from "./resolution-effect-words-habit.js";
import { VAGUE_WORDS } from "./resolution-effect-words-vague.js";
import { PLAIN_LOOK_WORDS } from "./resolution-effect-words-plain-look.js";
import { PLAIN_COLOUR_WORDS } from "./resolution-effect-words-plain-colour.js";
import { FOOTAGE_WORDS } from "./resolution-effect-words-footage.js";
import { PLAIN_SHAPE_WORDS } from "./resolution-effect-words-plain-shape.js";
import { namesUnlistedProduct } from "./resolution-product-names.js";
import { profileOf } from "./resolution-profile.js";
import { clausesOf, normaliseText, stemWord } from "./resolution-text.js";
import { readRequest, scoreCandidates, standingOf, winnerOf } from "./resolution-score.js";
import type { Scored, Standing, Tuning } from "./resolution-score.js";
import type { Candidate } from "./candidate-search.js";

const EFFECT_TUNING: Tuning = { concepts: compileConcepts([...LOOK_WORDS, ...MOTION_WORDS, ...FIGURATIVE_WORDS, ...HABIT_WORDS, ...VAGUE_WORDS, ...PLAIN_LOOK_WORDS, ...PLAIN_COLOUR_WORDS, ...PLAIN_SHAPE_WORDS, ...BLUR_SHARPEN_WORDS,
    ...COLOUR_GRADE_WORDS, ...DISTORT_STYLIZE_WORDS, ...TIME_TRANSITION_WORDS, ...FOOTAGE_WORDS]), context: new Set(), strict: 4, denyNames: true, attribute: false };

const FADE_WORD = /(?<![\p{L}\p{N}])(?:fade|fades|faded|fading|gradient\p{L}*|degrad\p{L}*)(?![\p{L}\p{N}])/iu;
const SOLID_FILL = "ADBE Fill";

function withoutSolidFill(phrase: string, candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> {
  return FADE_WORD.test(phrase) ? candidates.filter((candidate) => candidate.key !== SOLID_FILL) : candidates;
}

function isEffectWord(word: string, candidates: ReadonlyArray<Candidate>): boolean {
  const stem = stemWord(normaliseText(word));
  const named = candidates.map(profileOf).some((profile) => [...profile.display, ...profile.extra, ...profile.group].some((token) => token === stem || (stem.length >= 4 && token.startsWith(stem))));
  return named || conceptHits(clausesOf(word), EFFECT_TUNING.concepts).length > 0;
}

function scoreEffects(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): ReadonlyArray<Scored> {
  if (namesUnlistedProduct(phrase, (word) => isEffectWord(word, candidates))) return [];
  return scoreCandidates(readRequest(withoutBareRamp(phrase), EFFECT_TUNING), withoutSolidFill(phrase, candidates), EFFECT_TUNING, habit);
}

/** The key of the effect the request means, or "none" when it names none, rejects it or fits several equally. */
export function pickEffect(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): string {
  return winnerOf(scoreEffects(phrase, candidates, habit));
}

/** The keys of the effects that fit the request at all, best first. */
export function rankEffects(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): ReadonlyArray<string> {
  return scoreEffects(phrase, candidates, habit).filter((row) => row.score > 0).map((row) => row.profile.key);
}

/** How the effects stand against the request: the best and second-best scores, whether the best is anchored in the request and whether the request names an effect no candidate is. */
export function standEffects(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): Standing {
  return standingOf(readRequest(withoutBareRamp(phrase), EFFECT_TUNING), scoreEffects(phrase, candidates, habit));
}
