/**
 * Panel contract: the Memory section speaks the interface language. Its static words are painted from the catalogue,
 * its counts take the plural form of the language, and an open Memory view repaints at once when the language changes,
 * without reading the sidecar again. A note's own text is never translated.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { element } from "./contract-helpers.js";

const choose = (harness: ReturnType<typeof world>["harness"], value: string): void => {
  const select = element(harness, "interface-language");
  select.value = value;
  select.dispatch("change");
};
import { callsTo, openSettings, pressTwice, status, text, world } from "./contract-memory-fixtures.js";

const LEARNED = { effects: 3, fonts: 1, presets: 0, animationSeconds: 0.6 };

test("the Memory words are painted in German at open, with the plural forms of the language", () => {
  const w = world({ learned: LEARNED });
  choose(w.harness, "de");
  openSettings(w);
  assert.equal(text(w, "memory-state"), "Lernen aktiv · 3 Effekte, 1 Schrift, Animationen ~0.6 s");
  assert.equal(element(w.harness, "memory-forget").textContent, "Gelerntes vergessen");
  assert.equal(text(w, "memory-learned"), "Bisher gelernt: 3 Effekte, 1 Schrift, Animationen ~0.6 s");
});

test("an open Memory view repaints when the language changes, and does not read the sidecar again", () => {
  const w = world({ learned: LEARNED });
  openSettings(w);
  assert.equal(text(w, "memory-learned"), "Learned so far: 3 effects, 1 font, animations ~0.6 s");
  choose(w.harness, "ja");
  assert.equal(text(w, "memory-learned"), "これまでの学習：3 エフェクト、1 フォント、アニメーション約0.6秒");
  assert.equal(element(w.harness, "memory-forget").textContent, "学習内容を消去");
  assert.equal(text(w, "memory-state"), "学習オン · 3 エフェクト、1 フォント、アニメーション約0.6秒");
  assert.equal(callsTo(w, "/v1/notes/settings").length, 1, "repainted from what is held, not read again");
  choose(w.harness, "en");
  assert.equal(text(w, "memory-learned"), "Learned so far: 3 effects, 1 font, animations ~0.6 s");
});

test("a count of one takes the singular form in English and the same form in Japanese", () => {
  const w = world({ learned: { effects: 1, fonts: 0, presets: 0, animationSeconds: null } });
  openSettings(w);
  assert.equal(text(w, "memory-learned"), "Learned so far: 1 effect");
  choose(w.harness, "ja");
  assert.equal(text(w, "memory-learned"), "これまでの学習：1 エフェクト");
});

test("the forget press reports its count in Japanese, and the static placeholders are painted too", () => {
  const w = world();
  openSettings(w);
  choose(w.harness, "ja");
  assert.equal(element(w.harness, "notes-effect").getAttribute("placeholder"), "エフェクト名または一致名");
  pressTwice(w, element(w.harness, "memory-forget"));
  assert.equal(status(w), "extynt が作業から学習した内容を削除しました（4 件）。");
  assert.equal(callsTo(w, "/v1/notes/usage/forget").length, 1);
});
