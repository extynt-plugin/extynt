// Numbered and lettered controls: a request that names "colour B" or "the second colour" means that one, and when no candidate carries the letter or number the request names nothing here.
import type { Candidate } from "./candidate-search.js";
import { normaliseText, stemWord, wordsOf } from "./resolution-text.js";

const ORDINALS: ReadonlyMap<string, number> = new Map([
  ["first", 1], ["1st", 1], ["second", 2], ["2nd", 2], ["third", 3], ["3rd", 3], ["fourth", 4], ["4th", 4], ["fifth", 5], ["5th", 5],
]);

const ARTICLE_LETTERS: ReadonlySet<string> = new Set(["a", "i"]);

const FIRST_LETTER = 96;

interface Designator {
  readonly nouns: ReadonlyArray<string>;
  readonly index: number;
}

function wordsWithCase(phrase: string): ReadonlyArray<string> {
  return phrase.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
}

function stemOf(word: string): string {
  return stemWord(normaliseText(word));
}

function letterIndex(word: string): number {
  const named = /^\p{L}$/u.test(word) && (word === word.toUpperCase() || !ARTICLE_LETTERS.has(word));
  return named ? normaliseText(word).charCodeAt(0) - FIRST_LETTER : 0;
}

function designatorAt(words: ReadonlyArray<string>, at: number, numbered: boolean): Designator | null {
  const word = words[at] ?? "";
  const ordinal = ORDINALS.get(word.toLowerCase());
  const before = words[at - 1];
  const after = words[at + 1];
  if (ordinal !== undefined && after !== undefined) return { nouns: words.slice(at + 1, at + 3).map(stemOf), index: ordinal };
  if (before === undefined) return null;
  const index = /^[1-9]$/u.test(word) && numbered ? Number(word) : letterIndex(word);
  return index > 0 ? { nouns: [stemOf(before)], index } : null;
}

function carries(candidate: Candidate, designator: Designator): boolean {
  const tokens = wordsOf(normaliseText(candidate.title));
  const marks = [String.fromCharCode(FIRST_LETTER + designator.index), String(designator.index), ...[...ORDINALS].filter(([, place]) => place === designator.index).map(([word]) => word)];
  return tokens.some((token, at) => designator.nouns.includes(stemWord(token)) && [tokens[at - 1], tokens[at + 1]].some((next) => next !== undefined && marks.includes(next)));
}

function namesNoun(candidates: ReadonlyArray<Candidate>, designator: Designator): boolean {
  return candidates.some((candidate) => wordsOf(normaliseText(candidate.title)).some((token) => designator.nouns.includes(stemWord(token))));
}

/** The candidates a request that names a lettered or numbered member of a series ("colour B", "the second colour") can mean: those that carry the letter or number, all of them when it names none, and none at all when it names one no candidate carries. */
export function designatedCandidates(phrase: string, candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> {
  const words = wordsWithCase(phrase);
  const numbered = candidates.some((candidate) => /\b\d\b/u.test(candidate.title));
  const found = words.flatMap((_, at) => designatorAt(words, at, numbered) ?? []).filter((designator) => namesNoun(candidates, designator));
  if (found.length === 0) return candidates;
  return candidates.filter((candidate) => found.some((designator) => carries(candidate, designator)));
}
