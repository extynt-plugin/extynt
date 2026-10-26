// Request text as the deterministic request deciders read it: folded to plain letters with directives aimed at the classifier removed, and each mention read as asked or refused by the words before it.
import { stripMetaInstructions } from "./request-injection.js";
import { foldLetters } from "./text-folding.js";

/** The words a request is read by: cues that refuse what follows, verbs that start an edit, clause breaks, and conjunctions that join two edits. */
export type Lexicon = {
  readonly cue: RegExp;
  readonly act: RegExp;
  readonly brk: RegExp;
  readonly conj: RegExp;
};

type MarkKind = "cue" | "act" | "brk" | "conj";
type Mark = { readonly at: number; readonly kind: MarkKind };
type Reading = { readonly refused: boolean; readonly last: MarkKind | "start" };

const START: Reading = { refused: false, last: "start" };
const CURLY_APOSTROPHE = /[‘’ʼ]/gu;
const NOT_CONTRACTION = /n't\b/giu;
const LINE_BREAK = /[\r\n]+/gu;
const WHITESPACE = /\s+/gu;
const ASCII_WORD = /^[a-z0-9']+$/iu;
const KATAKANA_LETTER = /[ァ-ヶ]/u;
const KATAKANA_TO_HIRAGANA = 0x60;
const WORD_EDGE = "(?<![\\p{L}\\p{N}])";

/** The text as the deciders read it: NFKC (full-width and half-width forms as plain ones), Latin letters without accents, ß as ss and œ as oe, n't as not, line breaks as sentence breaks, and meta-instructions aimed at the classifier removed. */
export function foldRequest(text: string): string {
  const folded = foldLetters(text)
    .replace(CURLY_APOSTROPHE, "'")
    .replace(NOT_CONTRACTION, " not")
    .replace(LINE_BREAK, ". ");
  return stripMetaInstructions(folded).replace(WHITESPACE, " ").trim();
}

const escapeText = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function kanaClass(letter: string): string {
  if (!KATAKANA_LETTER.test(letter)) return escapeText(letter);
  return `[${letter}${String.fromCharCode(letter.charCodeAt(0) - KATAKANA_TO_HIRAGANA)}]`;
}

function unsegmentedPattern(words: ReadonlyArray<string>): string {
  return words.map((word) => [...word].map(kanaClass).join("")).join("");
}

function phrasePattern(phrase: string): string {
  const substring = phrase.startsWith("~");
  const exact = phrase.startsWith("=");
  const body = foldLetters(substring || exact ? phrase.slice(1) : phrase);
  const words = body.split(" ");
  if (!words.every((word) => ASCII_WORD.test(word))) return unsegmentedPattern(words);
  const joined = words.map(escapeText).join("[^\\p{L}\\p{N}]+");
  if (substring) return `${joined}[\\p{L}\\p{N}]*`;
  if (exact) return `${WORD_EDGE}${joined}(?![\\p{L}\\p{N}])`;
  return `${WORD_EDGE}${joined}[\\p{L}\\p{N}]*`;
}

/** One global pattern that finds any of the phrases in folded text: a word start, a whole word for a leading =, or a fragment for a leading ~. A phrase is folded as the text is, so it may be written with accents; one with Japanese or Chinese letters matches as a substring with no word edges, and a katakana letter also matches its hiragana twin (never the reverse). Longer phrases win. */
export function phraseRegex(phrases: ReadonlyArray<string>): RegExp {
  const longestFirst = [...phrases].sort((first, second) => second.length - first.length);
  return new RegExp(longestFirst.map(phrasePattern).join("|"), "giu");
}

/** One global pattern that finds a match of any of the given patterns. */
export function unionRegex(parts: ReadonlyArray<RegExp>): RegExp {
  return new RegExp(parts.map((part) => `(?:${part.source})`).join("|"), "giu");
}

/** Whether the folded text contains a match of the pattern at all. */
export function containsWord(text: string, pattern: RegExp): boolean {
  return text.search(pattern) >= 0;
}

function blankSpans(text: string, pattern: RegExp): string {
  return text.replace(pattern, (span) => " ".repeat(span.length));
}

function marksOf(text: string, lexicon: Lexicon): ReadonlyArray<Mark> {
  const kinds: ReadonlyArray<readonly [MarkKind, RegExp]> = [["cue", lexicon.cue], ["act", lexicon.act], ["brk", lexicon.brk], ["conj", lexicon.conj]];
  return kinds.flatMap(([kind, pattern]) => [...text.matchAll(pattern)].map((match) => ({ at: match.index ?? 0, kind })))
    .sort((first, second) => first.at - second.at);
}

function advance(reading: Reading, mark: Mark): Reading {
  if (mark.kind === "cue") return { refused: true, last: "cue" };
  if (mark.kind === "brk") return { refused: false, last: "brk" };
  if (mark.kind === "conj") return { refused: reading.refused, last: "conj" };
  return { refused: reading.refused && reading.last !== "conj", last: "act" };
}

/** The refusal state at each position of folded text: a cue refuses what follows until a clause break, or until an action verb that a conjunction introduces. */
export function refusedAt(text: string, lexicon: Lexicon): (at: number) => boolean {
  const marks = marksOf(text, lexicon);
  return (at) => marks.filter((mark) => mark.at < at).reduce<Reading>(advance, START).refused;
}

/** Whether a folded request asks for something the pattern finds, at a place no refusal reaches; an ignored span such as motion blur is blanked first. */
export function asksFor(text: string, mention: RegExp, lexicon: Lexicon, ignore?: RegExp): boolean {
  const read = ignore === undefined ? text : blankSpans(text, ignore);
  const refused = refusedAt(read, lexicon);
  return [...read.matchAll(mention)].some((match) => !refused(match.index ?? 0));
}
