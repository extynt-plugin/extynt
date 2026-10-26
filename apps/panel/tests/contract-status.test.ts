/** Panel contract: the status bar repaints at once on a language change, and the status words and plural forms are right in each language. */
import assert from "node:assert/strict";
import test from "node:test";
import { translatorFor } from "@extynt/ui-text";
import { createPanelHarness } from "./contract.test.js";
import { element } from "./contract-helpers.js";

const LANGUAGE_SELECT = "interface-language";

type Harness = ReturnType<typeof createPanelHarness>;

function choose(harness: Harness, value: string): void {
  const select = element(harness, LANGUAGE_SELECT);
  select.value = value;
  select.dispatch("change");
}

function barText(harness: Harness): string {
  return element(harness, "status-bar").textContent;
}

test("the status bar repaints in the new language at once and returns to English unchanged", () => {
  const harness = createPanelHarness();
  const english = barText(harness);
  choose(harness, "de");
  const german = barText(harness);
  assert.notEqual(german, english);
  choose(harness, "ja");
  assert.notEqual(barText(harness), german);
  choose(harness, "en");
  assert.equal(barText(harness), english);
  assert.equal(harness.reloads(), 0);
});

test("the idle and bar words are written in each language the panel speaks", () => {
  assert.equal(translatorFor("en")("status.bar.ready"), "Ready");
  assert.equal(translatorFor("de")("status.bar.ready"), "Bereit");
  assert.equal(translatorFor("ja")("status.bar.ready"), "準備完了");
  assert.equal(translatorFor("zh-Hans")("status.bar.ready"), "就绪");
});

test("an ETA range is written with its minutes in English, German and Chinese", () => {
  const range = { low: 45, high: 70 };
  assert.equal(translatorFor("en")("status.eta.minutesRange", range), "≈ 45–70 min left");
  assert.equal(translatorFor("de")("status.eta.minutesRange", range), "≈ 45–70 Min. übrig");
  assert.equal(translatorFor("zh-Hans")("status.eta.minutesRange", range), "剩余约45–70分钟");
});

test("the plural form follows the count: one minute and many minutes", () => {
  assert.equal(translatorFor("en")("status.eta.minutesLeft", { count: 1 }), "≈ 1 min left");
  assert.equal(translatorFor("en")("status.time.minutes", { count: 41 }), "41 min");
  assert.equal(translatorFor("de")("status.time.minutes", { count: 1 }), "1 Min.");
  assert.equal(translatorFor("de")("status.time.minutes", { count: 41 }), "41 Min.");
  assert.equal(translatorFor("ja")("status.time.minutes", { count: 41 }), "41 分");
});
