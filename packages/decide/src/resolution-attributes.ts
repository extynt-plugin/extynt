// The offline resolver for the controls of an effect and the properties of a layer: scores them against a request with the attribute word table.
import { compileConcepts, conceptHits } from "./resolution-concepts.js";
import { ATTRIBUTE_WORDS } from "./resolution-attribute-words.js";
import { COLOUR_NAME_WORDS, MORE_ATTRIBUTE_WORDS } from "./resolution-attribute-words-more.js";
import { ADJUST_WORDS } from "./resolution-attribute-words-adjust.js";
import { CONTROL_WORDS } from "./resolution-attribute-words-controls.js";
import { TRANSFORM_WORDS } from "./resolution-attribute-words-transform.js";
import { SHAPE_WORDS, TEXT_WORDS } from "./resolution-attribute-words-shape.js";
import { PIVOT_WORDS } from "./resolution-attribute-words-pivot.js";
import { MASK_WORDS } from "./resolution-attribute-words-mask.js";
import { CORNER_WORDS } from "./resolution-attribute-words-corner.js";
import { QUANTITY_WORDS } from "./resolution-attribute-words-guards.js";
import { PART_WORDS } from "./resolution-attribute-words-parts.js";
import { LENS_WORDS } from "./resolution-attribute-words-lens.js";
import { LOOK_WORDS } from "./resolution-attribute-words-looks.js";
import { SIZE_WORDS } from "./resolution-attribute-words-sizes.js";
import { SPREAD_WORDS } from "./resolution-attribute-words-spread.js";
import { TRIM_WORDS } from "./resolution-attribute-words-trim.js";
import { CAMERA_WORDS, LIGHT_WORDS, SOURCE_WORDS } from "./resolution-attribute-words-scene.js";
import { EFFECT_AMOUNT_WORDS, EFFECT_COLOUR_WORDS, EFFECT_RAMP_WORDS } from "./resolution-attribute-words-fx.js";
import { EVERYDAY_PROPERTY_WORDS } from "./resolution-attribute-words-everyday.js";
import { LAYER_WORDS } from "./resolution-attribute-words-layer.js";
import { withoutSharedMatchWords } from "./resolution-attribute-names.js";
import { designatedCandidates } from "./resolution-designators.js";
import { SWEEP_STANDING, readRequest, scoreCandidates, standingOf, winnerOf } from "./resolution-score.js";
import type { Scored, Standing, Tuning } from "./resolution-score.js";
import { NO_MATCH, type Candidate } from "./candidate-search.js";
import { clausesOf, normaliseText, stemWord, wordsOf } from "./resolution-text.js";

const CONCEPTS = compileConcepts([...ATTRIBUTE_WORDS, ...CONTROL_WORDS, ...TRANSFORM_WORDS, ...MORE_ATTRIBUTE_WORDS, ...ADJUST_WORDS, ...COLOUR_NAME_WORDS, ...SHAPE_WORDS, ...TRIM_WORDS, ...TEXT_WORDS, ...CAMERA_WORDS, ...LIGHT_WORDS, ...SOURCE_WORDS, ...MASK_WORDS, ...CORNER_WORDS, ...SPREAD_WORDS, ...SIZE_WORDS, ...LOOK_WORDS, ...LENS_WORDS, ...PART_WORDS, ...QUANTITY_WORDS, ...PIVOT_WORDS, ...EFFECT_AMOUNT_WORDS, ...EFFECT_RAMP_WORDS, ...EFFECT_COLOUR_WORDS, ...LAYER_WORDS, ...EVERYDAY_PROPERTY_WORDS]);

const QUANTIFIERS = new Set(["every", "all", "each", "todas", "todos", "cada", "alle", "jede", "jeder", "jedes", "chaque", "tous", "toutes"]);

const AMOUNTS = /\ba (?:bit|little|lot|touch|tad|few|bunch)\b|\bun (?:poco|poquito|peu|petit peu)\b|\bein (?:wenig|bisschen|kleines bisschen)\b/gu;

const IDIOMS = /\ball the way(?: round| around)?\b|\ball (?:round|around|over|along)\b|\b(?:every|each) time\b/gu;

const SPIN_VERBS = /\b(?:rotate|rotates|rotating|rotated|spin|spins|spinning|turn|turns|turning|twirl|rota|rotar|gira|girar|dreh|drehe|drehen|dreht|tourne|tourner)\b/gu;

const SPIN_VERBS_CJK: ReadonlyArray<string> = ["回転", "回す", "回して", "回る"];

const PHASE_WORDS: ReadonlySet<string> = new Set(["color", "colors", "hue", "hues", "phase", "phases", "cycle", "cycles", "cycling", "wheel", "wheels"]);

const PHASE_WORDS_CJK: ReadonlyArray<string> = ["色相", "位相", "フェーズ"];

function contextOf(owner: string): ReadonlySet<string> {
  return new Set(wordsOf(normaliseText(owner)).map(stemWord));
}

function isColourPhase(normalised: string): boolean {
  return wordsOf(normalised).some((word) => PHASE_WORDS.has(word)) || PHASE_WORDS_CJK.some((word) => normalised.includes(word));
}

function withoutIdioms(normalised: string): string {
  return normalised.replace(IDIOMS, " ");
}

function withoutAmounts(phrase: string): string {
  return normaliseText(phrase).replace(AMOUNTS, " ");
}

function withoutSpinVerbs(phrase: string): string {
  const normalised = normaliseText(phrase);
  if (!isColourPhase(normalised)) return phrase;
  const latinFree = normalised.replace(SPIN_VERBS, " ");
  return SPIN_VERBS_CJK.reduce((rest, word) => rest.split(word).join(" "), latinFree);
}

function titleStems(candidates: ReadonlyArray<Candidate>): ReadonlySet<string> {
  return new Set(candidates.flatMap((candidate) => wordsOf(normaliseText(candidate.title)).map(stemWord)));
}

function sweeps(normalised: string, candidates: ReadonlyArray<Candidate>): boolean {
  if (!wordsOf(normalised).some((word) => QUANTIFIERS.has(word))) return false;
  const stems = titleStems(candidates);
  const quantified = conceptHits(clausesOf(normalised), CONCEPTS).filter((hit) => wordsOf(hit.phrase).some((word) => QUANTIFIERS.has(word)));
  return !quantified.some((hit) => hit.concept.targets.some((target) => stems.has(target)));
}

interface Standings {
  readonly scored: ReadonlyArray<Scored>;
  readonly standing: Standing;
}

function scoredByWords(phrase: string, owner: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>): Standings | null {
  if (sweeps(withoutIdioms(normaliseText(phrase)), candidates)) return null;
  const tuning: Tuning = { concepts: CONCEPTS, context: contextOf(owner), strict: 5, denyNames: false, attribute: true };
  const reading = readRequest(withoutSpinVerbs(withoutAmounts(phrase)), tuning);
  const scored = scoreCandidates(reading, designatedCandidates(phrase, withoutSharedMatchWords(candidates)), tuning, habit);
  return { scored, standing: standingOf(reading, scored) };
}

function scoredAttributes(phrase: string, owner: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>): Standings | null {
  const byWords = scoredByWords(phrase, owner, candidates, {});
  const clear = byWords !== null && byWords.standing.key !== NO_MATCH;
  return clear || Object.keys(habit).length === 0 ? byWords : scoredByWords(phrase, owner, candidates, habit);
}

/** The key of the control or property the request means in the named effect or layer, or "none" when it names none or fits several equally. */
export function pickAttribute(phrase: string, owner: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): string {
  const found = scoredAttributes(phrase, owner, candidates, habit);
  return found === null ? "none" : winnerOf(found.scored);
}

/** How the candidates stand against the request; a request that sweeps over everything ("every", "all") stands as a decisive nothing. */
export function standAttributes(phrase: string, owner: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): Standing {
  return scoredAttributes(phrase, owner, candidates, habit)?.standing ?? SWEEP_STANDING;
}
