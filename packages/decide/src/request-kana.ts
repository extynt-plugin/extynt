// Katakana in a raw request pattern also matches its hiragana twin, as the folding phrase lists do; the reverse is never done.

const KATAKANA = /[ァ-ヶ]/gu;
const KATAKANA_TO_HIRAGANA = 0x60;

/** The pattern with every katakana letter widened to a class of the letter and its hiragana twin, so a loanword written in hiragana (ぐろー for グロー) still matches. */
export function withKana(pattern: RegExp): RegExp {
  const source = pattern.source.replace(KATAKANA, (kana) => `[${kana}${String.fromCharCode(kana.charCodeAt(0) - KATAKANA_TO_HIRAGANA)}]`);
  return new RegExp(source, pattern.flags);
}
