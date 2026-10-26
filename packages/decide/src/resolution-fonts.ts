// The offline font pick: a family named outright (with typos, run-together spelling or katakana), else the family whose style tags best fit a described look, else none.
import type { Candidate } from "./candidate-search.js";
import { CONTEXT_WORDS } from "./resolution-font-context.js";
import { FILLER_WORDS, KATAKANA_FILLERS } from "./resolution-font-fillers.js";
import { withLatinFamilies } from "./resolution-font-aliases.js";
import { TAG_FIT, lookFit, meetsClasses, readLooks, tagsOf, weightOnly } from "./resolution-font-looks.js";
import type { LookDemand } from "./resolution-font-looks.js";
import { misspeltFamily } from "./resolution-font-misspell.js";
import { sequenceOf } from "./resolution-font-attach.js";
import { nameLikeWord, spellsFamilyStart } from "./resolution-font-residual.js";
import { STYLE_WORDS, extensionsTie, nameHits, namesFamily, rankScore, settleBaseTies, typoIsAmbiguous } from "./resolution-font-names.js";
import type { NameHit, NameQuery } from "./resolution-font-names.js";
import { clausesOf, katakanaWords, requestText, stemWord } from "./resolution-text.js";
import type { Clause } from "./resolution-text.js";

const FONT_STOP_WORDS = new Set((
  "a an the this that these those it its i me my we you your to of in on at for from by with as is are be was or and but if so some any one something " +
  "font fonts typeface typefaces type style styled look looks looking lettering letters letter text kind sort like similar resembling alike copy " +
  "make use used using change set want need please let lets give put " +
  "un una el la los las de del al con y que lo es mas muy fuente fuentes tipografia tipografias letra usa usar quiero " +
  "ein eine einer einen einem der die das den dem und mit fur zu es ist schrift schriftart schriften mach bitte " +
  "le les des du au aux et ou pour avec police fonto para por como"
).split(" "));

const NO_MATCH = "none";

const STOP_OR_FILLER = (word: string): boolean => FONT_STOP_WORDS.has(word) || FILLER_WORDS.has(word);

const TAG_MARGIN = 0.02;

const FIRM_LOOK = 1;

function romajiTokens(text: string, consumed: ReadonlySet<string>): ReadonlyArray<string> {
  const rest = [...consumed, ...KATAKANA_FILLERS].reduce((left, word) => left.split(word).join(" "), text);
  const runs = (rest.match(/[ァ-ヴー]+/gu) ?? []).filter((run) => ![...consumed].some((word) => word.includes(run)));
  return runs.flatMap((run) => katakanaWords(run));
}

function nameTokens(clauses: ReadonlyArray<Clause>, text: string, consumed: ReadonlySet<string>): ReadonlyArray<string> {
  const latin = clauses.flatMap((clause) => clause.words).filter((word) => !STOP_OR_FILLER(word) && !/^\d+$/u.test(word));
  return [...new Set([...latin, ...romajiTokens(text, consumed).filter((word) => !STOP_OR_FILLER(word))])];
}

const STYLE_MARKERS: ReadonlySet<string> = new Set(["style", "styled"]);

function carriesName(word: string): boolean {
  return !STOP_OR_FILLER(word) && !CONTEXT_WORDS.has(word) && !/^\d+$/u.test(word);
}

function usageAfterStyle(clause: Clause): ReadonlyArray<string> {
  const marker = clause.words.findIndex((word) => STYLE_MARKERS.has(word));
  return marker > 0 && clause.words.slice(0, marker).some(carriesName) ? clause.words.slice(marker + 1) : [];
}

function contextOf(tokens: ReadonlyArray<string>, clauses: ReadonlyArray<Clause>): ReadonlySet<string> {
  const usage = new Set(clauses.flatMap(usageAfterStyle));
  return new Set(tokens.filter((token) => CONTEXT_WORDS.has(token) || usage.has(token)));
}

function wordCount(query: NameQuery): number {
  return query.tokens.filter((token) => !query.context.has(token)).length;
}

function explained(token: string, consumed: ReadonlySet<string>): boolean {
  return [...consumed].some((word) => word.length >= 4 && token.length >= 4 && (token.startsWith(word) || word.startsWith(token)));
}

const SANS_SERIF = /sans[ -]?serif|serifenlos|sin serifa|sans empattement|(?<=\b(?:an?|the|any|some|bold|heavy|light|thin|clean|plain|basic|simple|modern|neutral|geometric|humanist|friendly|classic|rounded|condensed|wide|standard) )sans\b/giu;

function spelled(phrase: string): string {
  return withLatinFamilies(requestText(phrase).replace(/(\p{L})-(\p{L})/gu, "$1 $2")).replace(SANS_SERIF, "sansserif");
}

function byHabit(habit: Readonly<Record<string, number>>, left: NameHit, right: NameHit): number {
  return rankScore(right) - rankScore(left) || right.matched.size - left.matched.size || (habit[right.key] ?? 0) - (habit[left.key] ?? 0) || left.key.length - right.key.length || (left.key < right.key ? -1 : 1);
}

/** How a font request stood: the key picked, how it was reached (a name, a look or not at all), the strength of the best fit, its lead over the runner-up, how many name words the request carried, and how well the picked family's style tags meet the look the request describes (look). */
export interface FontStanding {
  readonly key: string;
  readonly via: "name" | "look" | "none";
  readonly strength: number;
  readonly margin: number;
  readonly tokens: number;
  readonly look: number;
}

function candidateNamed(candidates: ReadonlyArray<Candidate>, key: string): Candidate | undefined {
  return candidates.find((candidate) => candidate.key === key);
}

function lookMeeting(demand: LookDemand, candidates: ReadonlyArray<Candidate>, key: string): number {
  if (demand.total === 0) return 1;
  const candidate = candidateNamed(candidates, key);
  return candidate === undefined ? 0 : Math.min(1, Math.max(0, lookFit(demand, tagsOf(candidate))));
}

function bestName(query: NameQuery, demand: LookDemand, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>): FontStanding | undefined {
  const titles = new Map(candidates.map((candidate) => [candidate.key, candidate.title]));
  const belongs = (hit: NameHit): boolean => meetsClasses(demand, tagsOf(candidateNamed(candidates, hit.key) ?? { key: hit.key, names: [], group: "", title: "" }), hit.matched);
  const hits = settleBaseTies(nameHits(query, candidates).filter(namesFamily).filter(belongs).sort((left, right) => byHabit(habit, left, right)), titles);
  const [best, next] = hits;
  if (best === undefined || typoIsAmbiguous(best, next) || extensionsTie(best, next)) return undefined;
  return {
    key: best.key, via: "name", strength: best.score, margin: next === undefined ? 1 : Math.max(0, rankScore(best) - rankScore(next)), tokens: wordCount(query),
    look: lookMeeting(demand, candidates, best.key),
  };
}

interface Fit {
  readonly key: string;
  readonly fit: number;
  readonly matched: ReadonlySet<string>;
}

interface Fitted {
  readonly top: Fit;
  readonly margin: number;
}

function bestFit(demand: LookDemand, query: NameQuery, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>): Fitted | undefined {
  if (demand.total === 0 || weightOnly(demand)) return undefined;
  const named = new Map(nameHits(query, candidates).map((hit) => [hit.key, hit]));
  const fits = candidates.filter((candidate) => meetsClasses(demand, tagsOf(candidate))).map((candidate): Fit => {
    const hit = named.get(candidate.key);
    return { key: candidate.key, fit: lookFit(demand, tagsOf(candidate)) + (hit?.distinct === true ? 0.5 * hit.coverage : 0), matched: hit === undefined || hit.typo ? new Set<string>() : hit.matched };
  });
  fits.sort((left, right) => right.fit - left.fit || (habit[right.key] ?? 0) - (habit[left.key] ?? 0) || (left.key < right.key ? -1 : 1));
  const [top, second] = fits;
  const margin = second === undefined ? 1 : top === undefined ? 0 : top.fit - second.fit;
  return top !== undefined && top.fit >= TAG_FIT && margin >= -TAG_MARGIN ? { top, margin } : undefined;
}

function residualOf(query: NameQuery, consumed: ReadonlySet<string>): ReadonlyArray<string> {
  return query.tokens.filter((token) => !STYLE_WORDS.has(token) && !query.context.has(token) && !query.looks.has(token) && !consumed.has(stemWord(token)) && !explained(token, consumed));
}

function lookStanding(fitted: Fitted, query: NameQuery, demand: LookDemand, nameLike: (token: string) => boolean): FontStanding {
  const vetoes = demand.total >= FIRM_LOOK ? nameLike : (): boolean => true;
  const left = residualOf(query, demand.consumed).filter((token) => !fitted.top.matched.has(token) && vetoes(token));
  const key = left.length === 0 ? fitted.top.key : NO_MATCH;
  return { key, via: key === NO_MATCH ? "none" : "look", strength: fitted.top.fit, margin: Math.max(0, fitted.margin), tokens: wordCount(query), look: Math.min(1, Math.max(0, fitted.top.fit)) };
}

function noStanding(query: NameQuery): FontStanding {
  return { key: NO_MATCH, via: "none", strength: 0, margin: 0, tokens: wordCount(query), look: 0 };
}

function namesMissingVariant(query: NameQuery, candidates: ReadonlyArray<Candidate>): boolean {
  return nameHits(query, candidates).some((hit) => hit.clash && hit.coverage === 1 && hit.distinct);
}

function spellsAbsentFamily(query: NameQuery): boolean {
  const words = query.tokens.filter((token) => !STYLE_WORDS.has(token) && !query.context.has(token));
  return spellsFamilyStart(words) || words.some(misspeltFamily);
}

function standOnce(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>>): FontStanding {
  const text = spelled(phrase);
  const clauses = clausesOf(text);
  const demand = readLooks(clauses);
  const tokens = nameTokens(clauses, text, demand.consumed);
  const nameLike = nameLikeWord(text, clauses, candidates);
  const query: NameQuery = { tokens, looks: demand.consumed, context: contextOf(tokens, clauses), sequence: sequenceOf(clauses, new Set(tokens)), nameLike };
  const named = bestName(query, demand, candidates, habit);
  if (named !== undefined) return named;
  const fitted = namesMissingVariant(query, candidates) || spellsAbsentFamily(query) ? undefined : bestFit(demand, query, candidates, habit);
  return fitted === undefined ? noStanding(query) : lookStanding(fitted, query, demand, nameLike);
}

const JOINED_CAPITALS = /\p{Ll}\p{Lu}/u;

function splitJoined(phrase: string): string {
  return phrase.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
}

/** How a font request stands: the family it means (a family it names, else the best fit for the look it describes, else "none") and the signals behind that pick; a run-together PostScript style name ("NotoSansJP-Bold") is read again split at its capitals when read whole it names nothing. */
export function standFont(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): FontStanding {
  const whole = standOnce(phrase, candidates, habit);
  if (whole.via !== "none" || !JOINED_CAPITALS.test(phrase)) return whole;
  const split = standOnce(splitJoined(phrase), candidates, habit);
  return split.via === "name" ? split : whole;
}

/** The family a font request means: the family it names, else the best fit for the look it describes, else "none". */
export function pickFont(phrase: string, candidates: ReadonlyArray<Candidate>, habit: Readonly<Record<string, number>> = {}): string {
  return standFont(phrase, candidates, habit).key;
}
