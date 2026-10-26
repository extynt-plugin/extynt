// The shared scorer of the offline resolvers: direct word matches against a candidate's name, concept matches from a table, a preference for the common member of a kind and the user's habits.
import { BOTH_MARK, VENDOR_MARK, conceptHits, isExactTarget } from "./resolution-concepts.js";
import type { Concept, ConceptHit } from "./resolution-concepts.js";
import { penaliseQualifiers } from "./resolution-qualifier.js";
import { objectFlags } from "./resolution-objects.js";
import { markTwins, plainKey, profileOf } from "./resolution-profile.js";
import type { Profile } from "./resolution-profile.js";
import { clausesOf, hasCjk, isTypoOf, stemWord, wordsOf } from "./resolution-text.js";
import type { Clause } from "./resolution-text.js";
import type { Candidate } from "./candidate-search.js";

const NO_KEY = "none";

const MIN_SCORE = 1.5;
const MIN_MARGIN = 0.5;

const MIN_NATIVE_MARGIN = 0.2;
const EXACT_WEIGHT = 3;
const NEAR_WEIGHT = 2;
const GROUP_WEIGHT = 0.5;
const EXTRA_FACTOR = 0.6;
const MISSING_PENALTY = 0.3;
const MASTER_BONUS = 0.6;
const GROUP_ONLY = 0.7;
const VARIANT_PENALTY = 0.7;
const COMPLETE_BONUS = 2;
const RAW_BONUS = 1;
const PRIOR_BONUS = 1.2;
const NATIVE_BONUS = 0.6;
const STANDARD_BONUS = 1;
const HABIT_FACTOR = 0.8;
const HABIT_CAP = 5;
const LOOSE_WEIGHT = 2;
const EXCLUDED = -100;

const STOP_WORDS = new Set((
  "a an the this that these those it its i me my we you your to of in on at for from by with as is are be was were am do does did can could would should will " +
  "make makes made making add adds adding apply applying use using give gives put set change changes changing want need please let lets get got have has " +
  "some any more less very really just only also then so and or but if when while into onto over under up down out off than too much many bit little " +
  "effect effects filter filters one thing things like look looks feel style kind type nice better good cool " +
  "un una el la los las de del al con para por y o que lo es se su sus mas haz hazlo " +
  "ein eine einen einem der die das den dem des und oder mit fur zu zum zur es ist sie wie mach mache bitte " +
  "le les des du au aux et ou pour avec"
).split(" "));

interface Reading {
  readonly words: ReadonlyArray<string>;
  readonly stems: ReadonlyArray<string>;
  readonly denied: ReadonlySet<string>;
  readonly hits: ReadonlyArray<ConceptHit>;
  readonly context: ReadonlySet<string>;
  readonly reached: boolean;
  readonly framed: boolean;
}

/** What differs between the domains that share the scorer. */
export interface Tuning {
  readonly concepts: ReadonlyArray<Concept>;
  readonly context: ReadonlySet<string>;
  readonly strict: number;
  readonly denyNames: boolean;
  readonly attribute: boolean;
}

interface Entry {
  readonly word: string;
  readonly denied: boolean;
  readonly object: boolean;
}

const ACTION_WORDS = new WeakMap<ReadonlyArray<Concept>, ReadonlySet<string>>();
const NAMED_WORDS = new WeakMap<ReadonlyArray<Concept>, ReadonlySet<string>>();

function singleWords(concepts: ReadonlyArray<Concept>): ReadonlySet<string> {
  return new Set(concepts.flatMap((concept) => concept.triggers).filter((trigger) => !trigger.includes(" ") && !hasCjk(trigger) && !STOP_WORDS.has(trigger)));
}

function actionWordsOf(concepts: ReadonlyArray<Concept>): ReadonlySet<string> {
  const known = ACTION_WORDS.get(concepts) ?? singleWords(concepts);
  ACTION_WORDS.set(concepts, known);
  return known;
}

function namedWordsOf(concepts: ReadonlyArray<Concept>, strict: number): ReadonlySet<string> {
  const known = NAMED_WORDS.get(concepts) ?? singleWords(concepts.filter((concept) => concept.weight >= strict));
  NAMED_WORDS.set(concepts, known);
  return known;
}

function keptWords(tuning: Tuning, actions: ReadonlySet<string>): ReadonlySet<string> {
  return tuning.attribute ? actions : namedWordsOf(tuning.concepts, tuning.strict);
}

function entriesWith(clauses: ReadonlyArray<Clause>, tuning: Tuning, context: ReadonlySet<string>): ReadonlyArray<Entry> {
  const actions = actionWordsOf(tuning.concepts);
  return clauses.flatMap((clause) => {
    const objects = objectFlags(clause.words, actions, keptWords(tuning, actions));
    return clause.words.flatMap((word, index): ReadonlyArray<Entry> => (
      STOP_WORDS.has(word) || context.has(stemWord(word)) || /^\d+$/u.test(word)
        ? []
        : [{ word, denied: clause.negated[index] === true, object: objects[index] === true }]
    ));
  });
}

function entriesOf(clauses: ReadonlyArray<Clause>, tuning: Tuning): ReadonlyArray<Entry> {
  const entries = entriesWith(clauses, tuning, tuning.context);
  return entries.length > 0 || conceptHits(clauses, tuning.concepts).length === 0 ? entries : entriesWith(clauses, tuning, new Set());
}

function subjectClauses(clauses: ReadonlyArray<Clause>, tuning: Tuning): ReadonlyArray<Clause> {
  const actions = actionWordsOf(tuning.concepts);
  return clauses.map((clause) => {
    const objects = objectFlags(clause.words, actions, keptWords(tuning, actions));
    const keep = clause.words.map((_, index) => objects[index] !== true);
    return {
      text: clause.text,
      denied: clause.denied,
      words: clause.words.filter((_, index) => keep[index] === true),
      negated: clause.negated.filter((_, index) => keep[index] === true),
    };
  });
}

/** Reads a request: the content words, which of them are denied, and the concepts of the table it mentions. The object of an action ("the face" in "pixelate the face") is left out unless nothing else is left. */
export function readRequest(phrase: string, tuning: Tuning): Reading {
  const clauses = clausesOf(phrase);
  const entries = entriesOf(clauses, tuning);
  const subject = entries.filter((entry) => !entry.object);
  const used = subject.length > 0 ? subject : entries;
  const live = used.filter((entry) => !entry.denied);
  return {
    words: live.map((entry) => entry.word),
    stems: live.map((entry) => stemWord(entry.word)),
    denied: new Set(used.filter((entry) => entry.denied).map((entry) => stemWord(entry.word))),
    hits: conceptHits(subject.length > 0 ? subjectClauses(clauses, tuning) : clauses, tuning.concepts),
    context: tuning.context,
    reached: tuning.attribute,
    framed: subject.length > 0 && subject.length < entries.length,
  };
}

function nameMatch(stem: string, token: string): number {
  if (stem === token) return EXACT_WEIGHT;
  const near = Math.min(stem.length, token.length) >= 3 && (token.startsWith(stem) || stem.startsWith(token));
  return near || (stem.length >= 6 && isTypoOf(stem, token)) ? NEAR_WEIGHT : 0;
}

function bestMatch(stem: string, tokens: ReadonlyArray<string>): number {
  return tokens.reduce((best, token) => Math.max(best, nameMatch(stem, token)), 0);
}

function phraseStems(hit: ConceptHit): ReadonlyArray<string> {
  return hit.phrase.includes(" ") && !hasCjk(hit.phrase) ? wordsOf(hit.phrase).map(stemWord) : [];
}

function looseStems(hit: ConceptHit): ReadonlyArray<string> {
  return hit.concept.weight < LOOSE_WEIGHT && !hasCjk(hit.phrase) ? wordsOf(hit.phrase).map(stemWord) : [];
}

function directStems(profile: Profile, reading: Reading): ReadonlyArray<string> {
  const absent = reading.hits.filter((hit) => !hit.negated && !hit.concept.targets.some((target) => holds(profile, target)));
  const spoken = new Set([...absent.flatMap(phraseStems), ...reading.hits.filter((hit) => !hit.negated).flatMap(looseStems)]);
  return [...new Set(reading.stems)].filter((stem) => !spoken.has(stem));
}

function reachedBy(reading: Reading, token: string): boolean {
  return reading.hits.some((hit) => !hit.negated && (reading.reached || hit.concept.weight < LOOSE_WEIGHT) && hit.concept.targets.some((target) => target.split(BOTH_MARK).some((stem) => stemHolds([token], stem))));
}

function directScore(profile: Profile, reading: Reading): number {
  const stems = directStems(profile, reading);
  let score = 0;
  for (const stem of stems) {
    const own = bestMatch(stem, profile.display);
    score += own > 0 ? own : bestMatch(stem, profile.extra) * EXTRA_FACTOR;
    score += profile.group.includes(stem) ? GROUP_WEIGHT : 0;
  }
  const own = profile.display.filter((token) => !reading.context.has(token));
  const spoken = own.filter((token) => stems.some((stem) => nameMatch(stem, token) > 0) || reachedBy(reading, token));
  const covered = spoken.length;
  const complete = own.length > 0 && covered === own.length && stems.every((stem) => bestMatch(stem, own) > 0);
  const rawBonus = reading.words.filter((word) => profile.raw.includes(word)).length * RAW_BONUS;
  return score - (own.length - covered) * (MISSING_PENALTY + (profile.native ? 0 : VARIANT_PENALTY)) + (complete ? COMPLETE_BONUS : 0) + rawBonus;
}

function stemHolds(tokens: ReadonlyArray<string>, stem: string): boolean {
  return tokens.some((token) => token === stem || (stem.length >= 4 && token.startsWith(stem)));
}

function holdsExactly(profile: Profile, key: string): boolean {
  if (profile.twin) return profile.fullNameKey === key || profile.fullMatchKey === key;
  const plain = plainKey(key);
  return profile.nameKey === plain || profile.matchKey === plain;
}

function vendorHolds(profile: Profile, vendors: string): boolean {
  return vendors === "" || vendors.split("_").every((vendor) => profile.vendors.includes(vendor));
}

function holdsExactTarget(profile: Profile, target: string): boolean {
  const [key = "", vendors = ""] = target.slice(1).split(VENDOR_MARK);
  return holdsExactly(profile, key) && vendorHolds(profile, vendors);
}

/** Whether a candidate holds a table target: an exact target ("=name") by its display-name key or its match-name key and, when the target names a vendor, a candidate of that vendor; any other target by a name, match-name or group stem. */
export function holds(profile: Profile, target: string): boolean {
  if (isExactTarget(target)) return holdsExactTarget(profile, target);
  const tokens = [profile.display, profile.extra, profile.group];
  return target.split(BOTH_MARK).every((stem) => tokens.some((held) => stemHolds(held, stem)));
}

function namedBy(profile: Profile, target: string): boolean {
  const tokens = [profile.display, profile.extra];
  return isExactTarget(target) || target.split(BOTH_MARK).every((stem) => tokens.some((named) => stemHolds(named, stem)));
}

interface Preference {
  readonly kinds: boolean;
  readonly standard: boolean;
}

function gainOf(profile: Profile, concept: Concept, preference: Preference): number {
  const standard = preference.standard && concept.targets.some((target) => isExactTarget(target) && holds(profile, target));
  const kind = preference.kinds && concept.prefer !== "" && holds(profile, concept.prefer);
  return concept.weight + (standard ? STANDARD_BONUS : 0) + (kind ? PRIOR_BONUS : 0);
}

function conceptScore(profile: Profile, hits: ReadonlyArray<ConceptHit>, preference: Preference): number {
  let score = 0;
  for (const { concept, negated } of hits) {
    const held = concept.targets.filter((target) => holds(profile, target));
    if (held.length === 0) continue;
    if (negated) return EXCLUDED;
    score += gainOf(profile, concept, preference) * (held.some((target) => namedBy(profile, target)) ? 1 : GROUP_ONLY);
  }
  return score > 0 && profile.display.includes("master") ? score + MASTER_BONUS : score;
}

function namesExactly(stem: string, profile: Profile): boolean {
  return [...profile.display, ...profile.extra].includes(stem);
}

function isBare(reading: Reading, profiles: ReadonlyArray<Profile>): boolean {
  return reading.stems.length > 0 && profiles.some((profile) => reading.stems.every((stem) => namesExactly(stem, profile)));
}

function insideHeld(hit: ConceptHit, hits: ReadonlyArray<ConceptHit>, profiles: ReadonlyArray<Profile>): boolean {
  return hits.some((other) => !other.negated && other.phrase.length > hit.phrase.length && other.phrase.includes(hit.phrase) && other.concept.targets.some((target) => heldByAny(profiles, target)));
}

function unmetStrict(reading: Reading, profiles: ReadonlyArray<Profile>, from: number): boolean {
  const strong = reading.hits.filter(({ concept, negated }) => !negated && from > 0 && concept.weight >= from && !concept.targets.every(isExactTarget));
  return strong.some((hit) => !hit.concept.targets.some((target) => heldByAny(profiles, target)) && !insideHeld(hit, reading.hits, profiles));
}

/** A candidate and how well the request fits it: its score, and whether the request names it by a word or a concept at all. */
export interface Scored {
  readonly profile: Profile;
  readonly score: number;
  readonly anchored: boolean;
}

function deniedPenalty(profile: Profile, reading: Reading, tuning: Tuning): number {
  if (!tuning.denyNames) return 0;
  return [...reading.denied].some((stem) => bestMatch(stem, profile.display) === EXACT_WEIGHT) ? EXCLUDED : 0;
}

function namesStem(profile: Profile, reading: Reading): boolean {
  return reading.stems.some((stem) => bestMatch(stem, [...profile.display, ...profile.extra]) > 0);
}

function looseOnly(reading: Reading): boolean {
  const live = reading.hits.filter((hit) => !hit.negated);
  const loose = new Set(live.flatMap(looseStems));
  return live.length > 0 && live.every((hit) => hit.concept.weight < LOOSE_WEIGHT) && reading.stems.every((stem) => loose.has(stem));
}

function heldByAny(profiles: ReadonlyArray<Profile>, target: string): boolean {
  return profiles.some((profile) => holds(profile, target));
}

function relaxedTarget(target: string, profiles: ReadonlyArray<Profile>, context: ReadonlySet<string>): string {
  const [lead = "", ...rest] = target.split(BOTH_MARK);
  return rest.length > 0 && (context.has(lead) || !heldByAny(profiles, lead)) ? rest.join(BOTH_MARK) : target;
}

function relaxed(reading: Reading, profiles: ReadonlyArray<Profile>): Reading {
  const hits = reading.hits.map((hit) => ({ ...hit, concept: { ...hit.concept, targets: hit.concept.targets.map((target) => relaxedTarget(target, profiles, reading.context)) } }));
  return { ...reading, hits };
}

function settleHit(hit: ConceptHit, profiles: ReadonlyArray<Profile>): ConceptHit {
  const exact = hit.concept.targets.filter(isExactTarget);
  const fallback = exact.length > 0 && exact.length < hit.concept.targets.length;
  if (hit.negated || !fallback || exact.some((target) => heldByAny(profiles, target))) return hit;
  return { ...hit, concept: { ...hit.concept, targets: exact } };
}

function silencedStems(hits: ReadonlyArray<ConceptHit>, profiles: ReadonlyArray<Profile>): ReadonlySet<string> {
  const unmet = hits.filter((hit) => !hit.negated && !hit.phrase.includes(" ") && !hasCjk(hit.phrase) && !hit.concept.targets.some((target) => heldByAny(profiles, target)));
  return new Set(unmet.map((hit) => stemWord(hit.phrase)));
}

function settled(reading: Reading, profiles: ReadonlyArray<Profile>): Reading {
  const hits = reading.hits.map((hit) => settleHit(hit, profiles));
  const silenced = silencedStems(hits, profiles);
  return { ...reading, hits, stems: reading.stems.filter((stem) => !silenced.has(stem)) };
}

/** The candidates scored against the request, best first; empty when the request names something strict that no candidate is. */
export function scoreCandidates(unrelaxed: Reading, candidates: ReadonlyArray<Candidate>, tuning: Tuning, habit: Readonly<Record<string, number>>): ReadonlyArray<Scored> {
  const profiles = markTwins(candidates.map(profileOf));
  const raw = relaxed(unrelaxed, profiles);
  if (unmetStrict(raw, profiles, tuning.strict)) return [];
  const reading = settled(raw, profiles);
  const bare = isBare(raw, profiles);
  const preference: Preference = { kinds: (!bare || reading.framed) && reading.hits.filter((hit) => !hit.negated).length === 1, standard: !bare };
  const weakOnly = !tuning.attribute && looseOnly(reading);
  const scored = profiles.map((profile): Scored => {
    const concept = conceptScore(profile, reading.hits, preference);
    const base = directScore(profile, reading) + concept + deniedPenalty(profile, reading, tuning);
    const bonus = base > 0 ? Math.min(habit[profile.key] ?? 0, HABIT_CAP) * HABIT_FACTOR + (profile.native ? NATIVE_BONUS : 0) : 0;
    const firm = !weakOnly || (habit[profile.key] ?? 0) > 0;
    return { profile, score: base + bonus, anchored: firm && (concept > 0 || namesStem(profile, reading)) };
  });
  const said = (token: string): boolean => reading.stems.some((stem) => nameMatch(stem, token) > 0) || reachedBy(reading, token);
  return [...penaliseQualifiers(scored, said)].sort((left, right) => right.score - left.score);
}

function marginOf(first: Scored, second: Scored | undefined): number {
  return second !== undefined && first.profile.native && !second.profile.native ? MIN_NATIVE_MARGIN : MIN_MARGIN;
}

/** The key of the clear winner, or "none" when nothing fits well enough, nothing in the request anchors it, or the runner-up is too close. */
export function winnerOf(scored: ReadonlyArray<Scored>): string {
  const [first, second] = scored;
  if (first === undefined || !first.anchored || first.score < MIN_SCORE) return NO_KEY;
  const tooClose = second !== undefined && first.score - second.score < marginOf(first, second);
  return tooClose ? NO_KEY : first.profile.key;
}

function coveredBy(profile: Profile, stem: string, reading: Reading): boolean {
  if (bestMatch(stem, [...profile.display, ...profile.extra]) > 0 || profile.group.includes(stem)) return true;
  return reading.hits.some(({ concept, negated }) => !negated && concept.targets.some((target) => holds(profile, target)) && concept.triggers.some((trigger) => trigger.includes(stem)));
}

/** How a scored list stands: the best and second-best scores, whether the best is anchored in the request, whether the list is empty because the request names something no candidate is, how many distinct content words the request has, how many of them it denies and how many the best candidate explains. */
export interface Standing {
  readonly top: number;
  readonly second: number;
  readonly anchored: boolean;
  readonly empty: boolean;
  readonly key: string;
  readonly content: number;
  readonly denied: number;
  readonly covered: number;
  readonly tied: boolean;
  readonly sameFamily: boolean;
}

function sharesFamily(first: Scored, second: Scored): boolean {
  return second.profile.group.some((stem) => first.profile.group.includes(stem));
}

function coveredCount(reading: Reading, first: Scored | undefined): number {
  if (first === undefined) return 0;
  return [...new Set(reading.stems)].filter((stem) => coveredBy(first.profile, stem, reading)).length;
}

function isTied(first: Scored | undefined, second: Scored | undefined): boolean {
  return first !== undefined && second !== undefined && first.score - second.score < marginOf(first, second);
}

function isSameFamily(first: Scored | undefined, second: Scored | undefined): boolean {
  return first !== undefined && second !== undefined && sharesFamily(first, second);
}

/** The standing of a scored list for a request. */
export function standingOf(reading: Reading, scored: ReadonlyArray<Scored>): Standing {
  const [first, second] = scored;
  return {
    top: first?.score ?? 0, second: second?.score ?? 0, anchored: first?.anchored ?? false, empty: first === undefined, key: winnerOf(scored),
    content: new Set(reading.stems).size, denied: reading.denied.size, covered: coveredCount(reading, first),
    tied: isTied(first, second), sameFamily: isSameFamily(first, second),
  };
}

/** The standing of a request that sweeps over every candidate, which is a decisive nothing. */
export const SWEEP_STANDING: Standing = {
  top: 0, second: 0, anchored: false, empty: true, key: NO_KEY, content: 0, denied: 0, covered: 0, tied: false, sameFamily: false,
};
