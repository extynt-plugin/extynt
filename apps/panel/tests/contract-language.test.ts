/** Panel contract: the interface speaks the language the sidecar resolved, the Language setting switches it at once without a reload, and the choice is saved. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness, type PanelHarness } from "./contract.test.js";
import { element } from "./contract-helpers.js";
import { fieldOf, readJson } from "./json-narrow.js";

const TITLE_KEY_ELEMENT = "interface-language";
const optionsOf = (harness: PanelHarness): string[] => element(harness, TITLE_KEY_ELEMENT).childNodes.map((node) => node.textContent);
const choose = (harness: PanelHarness, value: string): void => {
  const select = element(harness, TITLE_KEY_ELEMENT);
  select.value = value;
  select.dispatch("change");
};
const headingText = (harness: PanelHarness): string => element(harness, "interface-language-title").textContent;

test("the Language list names the six languages in their own names after Automatic", () => {
  const harness = createPanelHarness();
  assert.deepEqual(optionsOf(harness), ["Automatic", "English", "Español", "Deutsch", "Français", "日本語", "简体中文"]);
  assert.equal(element(harness, TITLE_KEY_ELEMENT).value, "auto");
});

test("the panel opens in the language the sidecar resolved", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; } });
  assert.equal(optionsOf(harness)[0], "Automatisch");
  assert.equal(element(harness, TITLE_KEY_ELEMENT).getAttribute("aria-label"), "Sprache");
  assert.equal(harness.document.documentElement.getAttribute("lang"), "de");
});

test("choosing a language repaints the page at once, with no reload, and saves the choice", () => {
  const harness = createPanelHarness();
  choose(harness, "ja");
  assert.equal(optionsOf(harness)[0], "自動");
  assert.equal(element(harness, TITLE_KEY_ELEMENT).getAttribute("aria-label"), "言語");
  assert.equal(harness.document.documentElement.getAttribute("lang"), "ja");
  assert.equal(harness.reloads(), 0);
  const saved = harness.requests.filter((record) => record.method === "PATCH" && record.url.endsWith("/v1/ui/prefs"));
  assert.deepEqual(saved.map((record) => fieldOf(readJson(record.body), "language")), ["ja"]);
  assert.equal(harness.sidecar.prefs.language, "ja");
});

test("a saved choice wins over the automatic language, and going back to Automatic returns to it", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.prefs.language = "fr"; sidecar.automaticLanguage = "es"; } });
  assert.equal(element(harness, TITLE_KEY_ELEMENT).value, "fr");
  assert.equal(optionsOf(harness)[0], "Automatique");
  choose(harness, "auto");
  assert.equal(optionsOf(harness)[0], "Automático");
});

test("the static headings carry their catalogue key and are painted in the current language", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "zh-Hans"; } });
  assert.equal(headingText(harness), "语言");
  choose(harness, "en");
  assert.equal(headingText(harness), "Language");
});
