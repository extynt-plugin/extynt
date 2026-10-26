// Text helpers for the offline resolvers: normalisation, tokens, stems, edit distance, katakana romaji and the clauses of a request.
import { CJK_NEGATION, CLAUSE_BREAK, NEGATORS } from "./resolution-clause-words.js";
import { foldLetters, splitElisions } from "./text-folding.js";

const KATAKANA_ROMAJI: Readonly<Record<string, string>> = {
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o", カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko", サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
  タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to", ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no", ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo", ヤ: "ya", ユ: "yu", ヨ: "yo", ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro", ワ: "wa", ヲ: "o", ン: "n",
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go", ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo", ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo", パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po", ヴ: "vu",
};

const SMALL_KATAKANA: Readonly<Record<string, string>> = { ャ: "ya", ュ: "yu", ョ: "yo", ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o" };

const KATAKANA_RUN = /[ァ-ヴー]+/gu;

const APOSTROPHE_VARIANT = /[‘’ʼ`]/gu;

/** The text folded for matching: full-width forms as plain ones, lower case, accents removed, ß as ss, French elisions split from their word, British colour as color and apostrophes dropped; kana and ideographs stay as written. */
export function normaliseText(text: string): string {
  const plain = splitElisions(foldLetters(text.replace(APOSTROPHE_VARIANT, "'")).toLowerCase());
  return plain.replace(/colour/gu, "color").replace(/'/gu, "");
}

/** The Latin words and numbers of normalised text. */
export function wordsOf(normalised: string): ReadonlyArray<string> {
  return normalised.match(/[a-z0-9]+/gu) ?? [];
}

/** Whether the text holds any kana, kanji or hangul. */
export function hasCjk(text: string): boolean {
  return /[぀-ヿ㐀-鿿가-힯]/u.test(text);
}

/** A word cut back to a comparable stem: trailing digits, plural s, ies and ing endings removed. */
export function stemWord(word: string): string {
  const bare = word.replace(/\d+$/u, "");
  if (bare.length > 4 && bare.endsWith("ies")) return `${bare.slice(0, -3)}y`;
  if (bare.length > 5 && bare.endsWith("ing")) return bare.slice(0, -3);
  if (bare.length > 3 && /[^sui]s$/u.test(bare)) return bare.slice(0, -1);
  return bare;
}

interface Rows {
  readonly left: string;
  readonly right: string;
  readonly previous: Int32Array;
  readonly older: Int32Array;
}

function swapCost(rows: Rows, i: number, j: number): number {
  const { left, right, older } = rows;
  const swapped = i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1];
  return swapped ? (older[j - 2] ?? 9) + 1 : 9;
}

function nextRow(rows: Rows, i: number): Int32Array {
  const { left, right, previous } = rows;
  const row = new Int32Array(right.length + 1);
  row[0] = i;
  for (let j = 1; j <= right.length; j += 1) {
    const cost = left[i - 1] === right[j - 1] ? 0 : 1;
    row[j] = Math.min((previous[j] ?? 9) + 1, (row[j - 1] ?? 9) + 1, (previous[j - 1] ?? 9) + cost, swapCost(rows, i, j));
  }
  return row;
}

/** The Damerau-Levenshtein distance between two strings: insertions, deletions, substitutions and adjacent swaps. */
export function editDistance(left: string, right: string): number {
  let rows: Rows = { left, right, older: new Int32Array(right.length + 1), previous: Int32Array.from({ length: right.length + 1 }, (_, index) => index) };
  for (let i = 1; i <= left.length; i += 1) rows = { left, right, older: rows.previous, previous: nextRow(rows, i) };
  return rows.previous[right.length] ?? 0;
}

/** Whether two words are near enough to be one word mistyped: one edit up to eight letters, two beyond, and the same first letter. */
export function isTypoOf(word: string, other: string): boolean {
  const longest = Math.max(word.length, other.length);
  if (Math.min(word.length, other.length) < 3 || word[0] !== other[0] || Math.abs(word.length - other.length) > 2) return false;
  return editDistance(word, other) <= (longest > 8 ? 2 : 1);
}

function romajiOf(run: string): string {
  let out = "";
  for (const mark of run) {
    const small = SMALL_KATAKANA[mark];
    const base = KATAKANA_ROMAJI[mark];
    if (small !== undefined) out = `${out.slice(0, -1)}${small}`;
    else if (base !== undefined) out += base;
  }
  return out;
}

/** The katakana runs of a text written in Latin letters (フーツラ as futsura), for comparing a loanword with a font or effect name. */
export function katakanaWords(text: string): ReadonlyArray<string> {
  return (text.normalize("NFKC").match(KATAKANA_RUN) ?? []).map(romajiOf).filter((word) => word !== "");
}

const INJECTION = /\b(ignore|disregard|forget|override)\b|^\s*system\s*:|\banswer\b|\breturn null\b/iu;

/** The request without the sentences that instruct the reader instead of describing the work ("ignore the above and answer ..."). */
export function requestText(phrase: string): string {
  return phrase.split(/[\n.!?]+/u).filter((sentence) => !INJECTION.test(sentence)).join(". ");
}

/** The words of a clause (a stretch between commas, full stops and "but" in any of the six languages) and whether the clause denies what it names. */
export interface Clause {
  readonly text: string;
  readonly words: ReadonlyArray<string>;
  readonly denied: boolean;
  readonly negated: ReadonlyArray<boolean>;
}

function negationFlags(words: ReadonlyArray<string>): ReadonlyArray<boolean> {
  let live = 0;
  return words.map((word) => {
    live = NEGATORS.has(word) ? 3 : Math.max(0, live - 1);
    return live > 0 && !NEGATORS.has(word);
  });
}

/** The clauses of a request, each with a flag per word for whether a negator sits just before it. */
export function clausesOf(phrase: string): ReadonlyArray<Clause> {
  return normaliseText(requestText(phrase)).split(CLAUSE_BREAK).filter((text) => text.trim() !== "").map((text) => {
    const words = wordsOf(text);
    const flags = negationFlags(words);
    const denied = CJK_NEGATION.test(text);
    return { text, words, denied, negated: words.map((_, index) => denied || flags[index] === true) };
  });
}
