// Letter folding shared by every deterministic matcher: width and compatibility forms, accents and ligatures, katakana as hiragana and French elisions, so one spelling of a word matches however a request writes it.

const LATIN_LETTER = /[À-ɏḀ-ỿ]/gu;
const COMBINING_MARK = /\p{M}/gu;
const SPECIAL_LETTER = /[ßẞœŒæÆøØłŁđĐı]/gu;
const KATAKANA = /[ァ-ヶ]/gu;
const KATAKANA_TEST = /[ァ-ヶ]/u;
const ELISION = /(?<![\p{L}\p{N}'])(qu|jusqu|lorsqu|puisqu|[cdjlmnst])'(?=[aeiouyh])/gu;
const KATAKANA_TO_HIRAGANA = 0x60;

const SPECIAL_LETTERS: ReadonlyMap<string, string> = new Map([
  ["ß", "ss"], ["ẞ", "ss"], ["œ", "oe"], ["Œ", "oe"], ["æ", "ae"], ["Æ", "ae"], ["ø", "o"], ["Ø", "o"], ["ł", "l"], ["Ł", "l"], ["đ", "d"], ["Đ", "d"], ["ı", "i"],
]);

/** The text in NFKC (full-width letters, digits and punctuation as plain ones, half-width katakana as full-width), with Latin letters stripped of accents and ß, œ, æ, ø, ł and đ spelled out; case is kept and other scripts are untouched. */
export function foldLetters(text: string): string {
  return text.normalize("NFKC")
    .replace(LATIN_LETTER, (letter) => letter.normalize("NFD").replace(COMBINING_MARK, ""))
    .replace(SPECIAL_LETTER, (letter) => SPECIAL_LETTERS.get(letter) ?? letter);
}

function foldKana(text: string): string {
  return text.replace(KATAKANA, (kana) => String.fromCharCode(kana.charCodeAt(0) - KATAKANA_TO_HIRAGANA));
}

/** Whether the text holds the needle. A needle with katakana (a loanword such as ボケ) also matches the text written in hiragana (ぼけ); a needle in hiragana or ideographs matches as written, so a katakana loanword never matches a hiragana particle inside it (どう in シャドウ). */
export function includesKana(text: string, needle: string): boolean {
  return KATAKANA_TEST.test(needle) ? foldKana(text).includes(foldKana(needle)) : text.includes(needle);
}

/** Lower-case folded text with a French elision split from its word (l'ombre as "l ombre", qu'il as "qu il"); other apostrophes are left alone. */
export function splitElisions(text: string): string {
  return text.replace(ELISION, "$1 ");
}
