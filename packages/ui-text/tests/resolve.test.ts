// Tests the language rule: the user's choice, then the installer's, then After Effects', then English, and how locale tags map onto the six languages.
import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, languageFromTag, resolveLanguage } from "../src/index.js";

test("an explicit choice beats the installer and After Effects", () => {
  assert.equal(resolveLanguage({ choice: "ja", installerTag: "de", hostTag: "fr_FR" }), "ja");
});

test("automatic follows the installer before After Effects", () => {
  assert.equal(resolveLanguage({ choice: "auto", installerTag: "de", hostTag: "fr_FR" }), "de");
});

test("automatic follows After Effects when the installer wrote nothing usable", () => {
  assert.equal(resolveLanguage({ choice: "auto", installerTag: null, hostTag: "fr_FR" }), "fr");
  assert.equal(resolveLanguage({ choice: "auto", installerTag: "it", hostTag: "es_ES" }), "es");
});

test("automatic falls back to English when nothing names one of the six", () => {
  assert.equal(resolveLanguage({ choice: "auto", installerTag: null, hostTag: null }), "en");
  assert.equal(resolveLanguage({ choice: "auto", installerTag: "ko", hostTag: "ru_RU" }), "en");
});

test("locale tags map onto the six languages and Traditional Chinese maps to none", () => {
  assert.equal(languageFromTag("zh_CN"), "zh-Hans");
  assert.equal(languageFromTag("zh-Hans-CN"), "zh-Hans");
  assert.equal(languageFromTag("zh-TW"), null);
  assert.equal(languageFromTag("zh-Hant"), null);
  assert.equal(languageFromTag("ja_JP"), "ja");
  assert.equal(languageFromTag(" DE-de "), "de");
  assert.equal(languageFromTag("pt_BR"), null);
});

test("every language code maps to itself", () => {
  for (const language of LANGUAGES) assert.equal(languageFromTag(language), language);
});
