// Matching a request against family names: word by word with typos, run together ("OpenSans"), and katakana spellings, scored by how much of the name and how much of the request each other explain.
import type { Candidate } from "./candidate-search.js";
import { detachedWords } from "./resolution-font-attach.js";
import { tagsOf } from "./resolution-font-looks.js";
import { editDistance, isTypoOf, normaliseText, stemWord, wordsOf } from "./resolution-text.js";

const GENERIC = new Set(["ui", "mt", "ms", "pro", "std", "itc", "let", "lt", "regular", "bold", "light", "medium", "italic", "oblique", "com", "ot", "tt", "bt", "premier", "variable"]);

const COMPARATIVE_WORDS: ReadonlySet<string> = new Set(["thinner", "lighter", "bolder", "thicker", "heavier", "slimmer", "narrower", "wider"]);

/** Request words that ask for a weight or slant of a family, never for another family. */
export const STYLE_WORDS = new Set([
  "bold", "heavy", "light", "thin", "italic", "regular", "oblique", "medium", "semibold", "demi", "extrabold", "ultra", "fett", "negrita", "gras",
  ...COMPARATIVE_WORDS,
]);

const SUFFIX_TAGS: Readonly<Record<string, string>> = {
  jp: "jp", sc: "sc", tc: "tc", kr: "kr", hk: "hk", cn: "cn", tw: "tw", gb: "gb", cns: "cns", cjk: "cjk", mono: "mono", monospace: "mono", condensed: "condensed", compressed: "condensed",
  narrow: "condensed", extended: "wide", expanded: "wide", rounded: "rounded", serif: "serif", sans: "sans", slab: "slab", display: "display", script: "script",
};

const MIN_TYPO_LENGTH = 6;

const TYPO_MARGIN = 0.1;

const COMPACT_LENGTH = 6;

/** The name words of a request, which of them a look word already explains, which are context words that may name a family but need not, the request's words in order (name words only, small words as breaks), and whether a word could be part of a family name. */
export interface NameQuery {
  readonly tokens: ReadonlyArray<string>;
  readonly looks: ReadonlySet<string>;
  readonly context: ReadonlySet<string>;
  readonly sequence: ReadonlyArray<string>;
  readonly nameLike: (token: string) => boolean;
}

/** How well a family name answers a request: the share of the name and of the request that match, their product, whether a distinctive word matched, whether a match came through a typo only, and whether the request carries a word that changes the family (a script, region, width or class suffix) which the family lacks. */
export interface NameHit {
  readonly key: string;
  readonly score: number;
  readonly coverage: number;
  readonly precision: number;
  readonly distinct: boolean;
  readonly unsaid: number;
  readonly lead: boolean;
  readonly typo: boolean;
  readonly clash: boolean;
  readonly matched: ReadonlySet<string>;
}

function exactWord(query: string, part: string): boolean {
  return query === part || stemWord(query) === stemWord(part);
}

function typoWord(query: string, part: string): boolean {
  if (part.length >= MIN_TYPO_LENGTH && editDistance(query, part) <= 1) return true;
  return query.length >= MIN_TYPO_LENGTH - 1 && part.length >= MIN_TYPO_LENGTH - 1 && Math.abs(query.length - part.length) <= 2 && isTypoOf(query, part);
}

function sameWord(query: string, part: string): boolean {
  return exactWord(query, part) || typoWord(query, part);
}

function partWeight(part: string): number {
  return GENERIC.has(part) || /^\d+$/u.test(part) ? 0.3 : 1;
}

function compactScore(query: NameQuery, parts: ReadonlyArray<string>): number {
  const named = query.tokens.filter((token) => !STYLE_WORDS.has(token));
  const joined = (named.length === 0 ? query.tokens : named).join("");
  const name = parts.join("");
  if (joined.length < COMPACT_LENGTH || Math.abs(joined.length - name.length) > 2 || joined[0] !== name[0]) return 0;
  const distance = editDistance(joined, name);
  if (distance === 0) return 1;
  return distance <= (joined.length >= 9 ? 2 : 1) ? 0.95 : 0;
}

function unmatchedWeight(token: string, query: NameQuery, detached: ReadonlySet<string>): number {
  if (COMPARATIVE_WORDS.has(token)) return 0.5;
  if (STYLE_WORDS.has(token) || GENERIC.has(token) || query.context.has(token)) return 0;
  if (query.looks.has(token)) return 0.5;
  return detached.has(token) && !query.nameLike(token) ? 0 : 1;
}

function matchedTokens(query: NameQuery, parts: ReadonlyArray<string>): { readonly matched: ReadonlySet<string>; readonly coverage: number; readonly typo: boolean; readonly unsaid: number } {
  const matched = new Set<string>();
  let covered = 0;
  let typo = false;
  let unsaid = 0;
  for (const part of parts) {
    const token = query.tokens.find((word) => sameWord(word, part));
    if (token === undefined) {
      unsaid += partWeight(part) === 1 ? 1 : 0;
      continue;
    }
    covered += partWeight(part);
    matched.add(token);
    typo = typo || !exactWord(token, part);
  }
  return { matched, coverage: covered / parts.reduce((sum, part) => sum + partWeight(part), 0), typo, unsaid };
}

const PART_CACHE = new Map<string, ReadonlyArray<string>>();

const CACHE_LIMIT = 20000;

function partsOf(title: string): ReadonlyArray<string> {
  const known = PART_CACHE.get(title);
  if (known !== undefined) return known;
  if (PART_CACHE.size >= CACHE_LIMIT) PART_CACHE.clear();
  const parts = wordsOf(normaliseText(title));
  PART_CACHE.set(title, parts);
  return parts;
}

function clashes(query: NameQuery, candidate: Candidate, matched: ReadonlySet<string>): boolean {
  const tags = tagsOf(candidate);
  return query.tokens.some((token) => {
    const tag = SUFFIX_TAGS[token];
    return tag !== undefined && !matched.has(token) && !tags.includes(stemWord(tag));
  });
}

function hitOf(query: NameQuery, candidate: Candidate): NameHit | undefined {
  const parts = partsOf(candidate.title);
  if (parts.length === 0) return undefined;
  const { matched, coverage, typo, unsaid } = matchedTokens(query, parts);
  const compact = compactScore(query, parts);
  if (matched.size === 0 && compact === 0) return undefined;
  const detached = detachedWords(query.sequence, matched);
  const unmatched = query.tokens.filter((token) => !matched.has(token)).reduce((sum, token) => sum + unmatchedWeight(token, query, detached), 0);
  const precision = matched.size / Math.max(1, matched.size + unmatched);
  const distinct = [...matched].some((token) => !query.looks.has(token) && !query.context.has(token) && token.length >= 4 && !GENERIC.has(token));
  const head = parts.find((part) => partWeight(part) === 1) ?? parts[0];
  const lead = head !== undefined && query.tokens.some((token) => sameWord(token, head));
  return { key: candidate.key, score: Math.max(coverage * precision, compact), coverage, precision, distinct, unsaid, lead, typo, clash: clashes(query, candidate, matched), matched };
}

/** The families whose names share a word with the request, each scored. */
export function nameHits(query: NameQuery, candidates: ReadonlyArray<Candidate>): ReadonlyArray<NameHit> {
  if (query.tokens.length === 0) return [];
  return candidates.flatMap((candidate) => hitOf(query, candidate) ?? []);
}

const LEAD_BONUS = 0.25;

/** The score a hit ranks by: its score, and a little more when the request's word is the family name's first word. */
export function rankScore(hit: NameHit): number {
  return hit.score + (hit.lead ? LEAD_BONUS : 0);
}

const NAME_SCORE = 0.6;

function rejectedPartial(hit: NameHit): boolean {
  return hit.coverage < 1 && (hit.typo || !hit.lead);
}

const DISTINCT_COVERAGE = 0.3;

/** Whether a name hit is good enough to name the family outright: a score of 0.6, or every request word matched through a distinctive word that begins a longer name (any number of its words unsaid, so "bebas" names Bebas Neue); a typed-wrong name must match the whole family name, and a name only partly said must begin with its first distinctive word ("grande" is not Lucida Grande). Two different extensions of the same partial name are told apart by `extensionsTie`. */
export function namesFamily(hit: NameHit): boolean {
  if (hit.clash || rejectedPartial(hit)) return false;
  return hit.score >= NAME_SCORE || (hit.distinct && hit.precision === 1 && hit.coverage >= DISTINCT_COVERAGE);
}

/** Whether a typo-only best hit is too close to a runner-up to name a family: two typo matches that score nearly alike mean the typed name is not unique. */
export function typoIsAmbiguous(best: NameHit, next: NameHit | undefined): boolean {
  return best.typo && next !== undefined && next.typo && rankScore(best) - rankScore(next) < TYPO_MARGIN;
}

/** Whether the best two hits are different extensions of one partial name that tie ("Roboto Mono" and "Roboto Slab" for "roboto" when plain Roboto is missing): the request does not say which, so no family is named. */
export function extensionsTie(best: NameHit, next: NameHit | undefined): boolean {
  return next !== undefined && best.unsaid > 0 && next.unsaid > 0 && rankScore(best) - rankScore(next) < TYPO_MARGIN;
}

function familyWords(title: string | undefined): ReadonlyArray<string> {
  return title === undefined ? [] : wordsOf(normaliseText(title)).map(stemWord);
}

function extendsFamily(base: string | undefined, other: string | undefined): boolean {
  const baseWords = familyWords(base);
  const otherWords = familyWords(other);
  return baseWords.length > 0 && otherWords.length > baseWords.length && baseWords.every((word, index) => word === otherWords[index]);
}

/** The hits with a tie between a base family and families that extend its name settled: the base family leads and the extensions it tied with step aside. */
export function settleBaseTies(hits: ReadonlyArray<NameHit>, titles: ReadonlyMap<string, string>): ReadonlyArray<NameHit> {
  const [top] = hits;
  if (top === undefined) return hits;
  const tied = hits.filter((hit) => rankScore(top) - rankScore(hit) < TYPO_MARGIN);
  const base = tied.find((hit) => tied.every((other) => other === hit || (extendsFamily(titles.get(hit.key), titles.get(other.key)) && other.matched.size <= hit.matched.size)));
  if (base === undefined) return hits;
  return [base, ...hits.filter((hit) => hit !== base && !(tied.includes(hit) && extendsFamily(titles.get(base.key), titles.get(hit.key))))];
}
