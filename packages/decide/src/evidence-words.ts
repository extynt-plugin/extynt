// Word matching shared by the evidence, checklist and continuation readings: folds case, width, accents and punctuation, then matches word roots and word families in English, Spanish, German, French, Japanese and Chinese.
import { CJK_NEGATION, CLAUSE_BREAK } from "./resolution-clause-words.js";
import { foldLetters, includesKana } from "./text-folding.js";

const NEGATORS: ReadonlySet<string> = new Set([
  "not", "no", "without", "never", "don", "sin", "nunca", "ohne", "nicht", "kein", "keine", "keinen", "keinem", "keiner", "keines", "nie", "sans", "pas", "jamais", "aucun", "aucune",
]);

const NEGATION_WINDOW = 2;

const LATIN_WORD = /^[a-z0-9]+$/;

/** The text folded for matching: width and accent folding as foldLetters does, lower case, and every run of punctuation or spacing as one space. */
export function foldText(text: string): string {
  return foldLetters(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The folded words of a text, in order; empty when the text has none. */
export function wordsOf(text: string): ReadonlyArray<string> {
  const folded = foldText(text);
  return folded === "" ? [] : folded.split(" ");
}

function negatedAt(words: ReadonlyArray<string>, index: number): boolean {
  return words.slice(Math.max(0, index - NEGATION_WINDOW), index).some((word) => NEGATORS.has(word));
}

function usesRoot(words: ReadonlyArray<string>, folded: string, root: string): boolean {
  const compound = root.startsWith("~");
  const stem = foldText(root);
  if (LATIN_WORD.test(stem)) return words.some((word, index) => (compound ? word.includes(stem) : word.startsWith(stem)) && !negatedAt(words, index));
  return stem !== "" && foundUnDenied(folded, stem);
}

function foundUnDenied(folded: string, stem: string): boolean {
  if (stem.includes(" ")) return includesKana(folded, stem);
  const ownDenial = CJK_NEGATION.test(stem);
  return folded.split(" ").flatMap((chunk) => chunk.split(CLAUSE_BREAK)).some((clause) => includesKana(clause, stem) && (ownDenial || !CJK_NEGATION.test(clause)));
}

/** Whether the text uses any root: a Latin word starting with the root (anywhere in a word for a root written with a leading ~, as in a German compound), or a phrase or non-Latin root found in the folded text, a katakana root also matched in hiragana; a word right after a negator does not count. */
export function mentions(text: string, roots: ReadonlyArray<string>): boolean {
  const words = wordsOf(text);
  const folded = words.join(" ");
  return roots.some((root) => usesRoot(words, folded, root));
}

/** Whether the text has any of the whole words, folded and not negated; a word right after a negator does not count. */
export function hasWord(text: string, words: ReadonlyArray<string>): boolean {
  const folded = wordsOf(text);
  return words.some((word) => {
    const stem = foldText(word);
    return stem !== "" && folded.some((item, index) => item === stem && !negatedAt(folded, index));
  });
}

const MIN_TYPO_LENGTH = 5;

/** Whether a word is one typo away from a target of at least five letters: one wrong, missing or extra letter, or two letters swapped. */
export function oneTypoFrom(word: string, target: string): boolean {
  if (target.length < MIN_TYPO_LENGTH || word === target) return false;
  const [wordMiddle, targetMiddle] = differingMiddles(word, target);
  return isSingleEdit(wordMiddle, targetMiddle) || isSwap(wordMiddle, targetMiddle);
}

function differingMiddles(word: string, target: string): [string, string] {
  const shorter = Math.min(word.length, target.length);
  let start = 0;
  while (start < shorter && word[start] === target[start]) start += 1;
  let end = 0;
  while (end < shorter - start && word[word.length - 1 - end] === target[target.length - 1 - end]) end += 1;
  return [word.slice(start, word.length - end), target.slice(start, target.length - end)];
}

function isSingleEdit(wordMiddle: string, targetMiddle: string): boolean {
  return (wordMiddle.length === 1 && targetMiddle.length === 1) || wordMiddle.length + targetMiddle.length === 1;
}

function isSwap(wordMiddle: string, targetMiddle: string): boolean {
  return wordMiddle.length === 2 && targetMiddle.length === 2 && wordMiddle === [...targetMiddle].reverse().join("");
}
