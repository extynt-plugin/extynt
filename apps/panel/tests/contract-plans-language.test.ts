/**
 * Panel contract: plan words follow the interface language. A plan's thread line and its sheet detail are written in the
 * language the panel shows, and a language change repaints both at once, with no reload, even when they were already drawn.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { element, folds, harnessWithPlanCard, nth, openSheet, planCard, required } from "./contract-helpers.js";
import { type PanelHarness, type StubElement } from "./contract.test.js";

const LANGUAGE_SELECT = "interface-language";

const choose = (harness: PanelHarness, value: string): void => {
  const select = element(harness, LANGUAGE_SELECT);
  select.value = value;
  select.dispatch("change");
};

const foldText = (harness: PanelHarness): string => nth(folds(harness), 0).textContent;

const waitingItem = (harness: PanelHarness): StubElement => required(openSheet(harness).find((node) => node.classList.has("sheet-item")));

test("a plan's thread line is written in German when the panel opens in German", () => {
  const harness = harnessWithPlanCard(planCard("p1", { title: "Fade in the title" }), undefined, {
    sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; },
  });
  assert.match(foldText(harness), /Fade in the title · 1 Operation · wartet auf Anwenden/);
});

test("a plan's thread line is written in Japanese after a language change, with no reload", () => {
  const harness = harnessWithPlanCard(planCard("p1", { title: "Fade in the title" }));
  assert.match(foldText(harness), /1 op · waiting for Apply/);
  choose(harness, "ja");
  assert.match(foldText(harness), /Fade in the title · 1 操作 · 適用待ち/);
  assert.equal(harness.reloads(), 0);
});

test("an open plan detail in the sheet repaints in the new language when the language changes", () => {
  const harness = harnessWithPlanCard(planCard("p1", { title: "Fade in the title" }));
  assert.match(waitingItem(harness).textContent, /What will change/);
  choose(harness, "ja");
  assert.match(waitingItem(harness).textContent, /変更内容/);
  assert.doesNotMatch(waitingItem(harness).textContent, /What will change/);
});
