// Spotting a typed word as a slip of a known family name (a doubled letter, a dropped letter, two letters swapped), so a request that misspells a family does not fall back to the genre the family is known for.
import { NAME_TAGS } from "./resolution-font-looks.js";
import { FAMILY_TAGS } from "./resolution-font-tags.js";
import { normaliseText, wordsOf } from "./resolution-text.js";

const MIN_LENGTH = 5;

const FAMILY_WORDS: ReadonlyArray<string> = [...new Set([...FAMILY_TAGS.keys()].flatMap((family) => wordsOf(normaliseText(family)).slice(0, 1)).filter((word) => word.length >= MIN_LENGTH && NAME_TAGS[word] === undefined))];

function swapped(word: string, family: string): boolean {
  const at = [...word].findIndex((letter, index) => letter !== family[index]);
  return at >= 0 && word[at] === family[at + 1] && word[at + 1] === family[at] && word.slice(at + 2) === family.slice(at + 2);
}

function withoutLetter(word: string, at: number): string {
  return word.slice(0, at) + word.slice(at + 1);
}

function doubled(word: string, family: string): boolean {
  return [...word].some((letter, at) => letter === word[at - 1] && withoutLetter(word, at) === family);
}

function dropped(word: string, family: string): boolean {
  return [...family].some((_, at) => withoutLetter(family, at) === word);
}

function slipOf(word: string, family: string): boolean {
  if (word.length === family.length) return swapped(word, family);
  return word.length === family.length + 1 ? doubled(word, family) : word.length + 1 === family.length && dropped(word, family);
}

/** Whether a word is a slip of a known family name (not the name itself): two letters swapped, one letter doubled or one dropped. */
export function misspeltFamily(word: string): boolean {
  return word.length >= MIN_LENGTH && !FAMILY_WORDS.includes(word) && FAMILY_WORDS.some((family) => slipOf(word, family));
}
