// Whether a request asks to see the design first, or to wait for a go-ahead, before anything is built, and in which of the six languages it asks.
import { APPROVAL_FIRST_WORDS, type RequestLanguage } from "./request-approval-words.js";
import { asksFor, foldRequest, phraseRegex } from "./request-text.js";
import { REQUEST_LEXICON } from "./request-vocabulary.js";

const LANGUAGES: ReadonlyArray<RequestLanguage> = ["en", "es", "de", "fr", "ja", "zh-Hans"];
const PATTERNS: ReadonlyArray<readonly [RequestLanguage, RegExp]> = LANGUAGES.map((language) => [language, phraseRegex(APPROVAL_FIRST_WORDS[language])]);

/** The language of the words by which the request asks to see the design first or to wait for its go-ahead; undefined when it asks for neither, or refuses it ("no need to wait for my approval"). */
export function approvalFirstLanguage(request: string): RequestLanguage | undefined {
  const text = foldRequest(request);
  return PATTERNS.find(([, pattern]) => asksFor(text, pattern, REQUEST_LEXICON))?.[0];
}
