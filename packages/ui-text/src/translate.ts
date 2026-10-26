/** The translator: `t(key, params)` for one language, with the key and the parameters checked against the English source. */
import { CATALOGUES, type SourceCatalogue, type UiKey } from "./catalogue.js";
import { fill } from "./fill.js";
import type { Language } from "./languages.js";
import type { FillValues, ParamsOf } from "./message.js";

const NO_VALUES: FillValues = {};

/** Says one catalogue key in the translator's language; text with placeholders takes one object naming each of them. */
export type Translate = <Key extends UiKey>(key: Key, ...params: ParamsOf<SourceCatalogue[Key]>) => string;

/** A translator for the language; a key a language lacks is said in English, so a gap shows as English and never as a blank. */
export function translatorFor(language: Language): Translate {
  const table = CATALOGUES[language];
  const english = CATALOGUES.en;
  return (key, ...params) => fill(table[key] ?? english[key], language, params.at(0) ?? NO_VALUES);
}

/** True when the text names a key of the catalogue; for a key that arrives as a string, such as an attribute of the page. */
export function isUiKey(text: string): text is UiKey {
  return Object.hasOwn(CATALOGUES.en, text);
}

/** The text of a key that has no placeholders, in the language; for a key chosen at run time from data rather than written in code. */
export function plainTextOf(language: Language, key: UiKey): string {
  return fill(CATALOGUES[language][key] ?? CATALOGUES.en[key], language, NO_VALUES);
}
