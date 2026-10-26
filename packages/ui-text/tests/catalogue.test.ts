// Tests the catalogue as a whole: every language has every key, with the same placeholders and a plural wherever English has one, and no key is defined twice.
import test from "node:test";
import assert from "node:assert/strict";
import { CATALOGUES, LANGUAGES, groupTables, placeholdersOf, translatorFor, type Entry, type Language } from "../src/index.js";

const OTHERS = LANGUAGES.filter((language) => language !== "en");

function textsOf(entry: Entry): ReadonlyArray<string> {
  return typeof entry === "string" ? [entry] : [entry.one ?? entry.other, entry.other];
}

function placeholdersIn(entry: Entry): ReadonlyArray<string> {
  return [...new Set(textsOf(entry).flatMap(placeholdersOf))].sort();
}

function entryOf(language: Language, key: string): Entry {
  const found = Object.entries(CATALOGUES[language]).find(([name]) => name === key);
  assert.ok(found, `${language} lacks ${key}`);
  return found[1];
}

function pluralCategories(language: Language): ReadonlyArray<string> {
  return new Intl.PluralRules(language).resolvedOptions().pluralCategories;
}

test("every language has exactly the English keys", () => {
  const english = Object.keys(CATALOGUES.en).sort();
  for (const language of OTHERS) assert.deepEqual(Object.keys(CATALOGUES[language]).sort(), english, language);
});

test("no key is defined in two groups", () => {
  for (const language of LANGUAGES) {
    const keys = groupTables(language).flatMap((table) => Object.keys(table));
    assert.equal(new Set(keys).size, keys.length, language);
  }
});

test("every translation names the same placeholders as the English", () => {
  for (const [key, source] of Object.entries(CATALOGUES.en)) {
    for (const language of OTHERS) {
      const translated = entryOf(language, key);
      assert.deepEqual(placeholdersIn(translated), placeholdersIn(source), `${language} ${key}`);
    }
  }
});

test("a plural in English is a plural in every language, with a singular where the language has one", () => {
  for (const [key, source] of Object.entries(CATALOGUES.en)) {
    if (typeof source === "string") continue;
    for (const language of OTHERS) {
      const translated = entryOf(language, key);
      assert.notEqual(typeof translated, "string", `${language} ${key} must be plural`);
      if (typeof translated !== "string" && pluralCategories(language).includes("one")) assert.ok(translated.one, `${language} ${key} needs a singular`);
    }
  }
});

test("a plain message stays plain in every language", () => {
  for (const [key, source] of Object.entries(CATALOGUES.en)) {
    if (typeof source !== "string") continue;
    for (const language of OTHERS) assert.equal(typeof entryOf(language, key), "string", `${language} ${key}`);
  }
});

test("no translation is empty and the product name stays lowercase", () => {
  for (const language of LANGUAGES) {
    for (const [key, entry] of Object.entries(CATALOGUES[language])) {
      for (const text of textsOf(entry)) {
        assert.notEqual(text.trim(), "", `${language} ${key}`);
        assert.doesNotMatch(text, /Extynt|EXTYNT/, `${language} ${key}`);
      }
    }
  }
});

test("the language setting reads naturally in each language", () => {
  const titles = LANGUAGES.map((language) => translatorFor(language)("settings.language.title"));
  assert.deepEqual(titles, ["Language", "Idioma", "Sprache", "Langue", "言語", "语言"]);
});
