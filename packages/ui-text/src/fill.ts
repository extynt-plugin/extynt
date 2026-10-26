/** Fills a message: picks the plural form for a count and replaces each {name} with its value. */
import type { Language } from "./languages.js";
import type { Entry, FillValues } from "./message.js";

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const rulesByLanguage = new Map<Language, Intl.PluralRules>();

function rulesOf(language: Language): Intl.PluralRules {
  const known = rulesByLanguage.get(language);
  if (known) return known;
  const made = new Intl.PluralRules(language);
  rulesByLanguage.set(language, made);
  return made;
}

/** The names of the placeholders in a text, in order of first appearance. */
export function placeholdersOf(text: string): ReadonlyArray<string> {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""))];
}

function formOf(message: Entry, language: Language, values: FillValues): string {
  if (typeof message === "string") return message;
  const count = values.count;
  const singular = typeof count === "number" && rulesOf(language).select(count) === "one";
  return singular ? (message.one ?? message.other) : message.other;
}

/** The message in this language with every placeholder replaced; a placeholder with no value stays visible as written. */
export function fill(message: Entry, language: Language, values: FillValues): string {
  return formOf(message, language, values).replace(PLACEHOLDER, (written, name: string) => {
    const value = values[name];
    return value === undefined ? written : String(value);
  });
}
