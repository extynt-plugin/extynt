/**
 * Panel contract: the model surfaces speak the interface language. The first-run card, the composer pill, the model popover
 * and the Settings forms are painted in German or Japanese, and each one repaints at once when the Language list changes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { StubElement } from "./contract-dom.js";
import { element, output, required, textsOf } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { type JsonObject } from "@extynt/decode";

const ok = (body: JsonObject): StubResponse => ({ status: 200, text: JSON.stringify({ ok: true, ...body }) });
const LANGUAGE_LIST = "interface-language";

function catalogModels(count: number): Array<{ id: string; name: string }> {
  return Array.from({ length: count }, (_, index) => ({ id: "model-" + index, name: "Model " + index }));
}

function answerModelRoute(record: StubRequestRecord, count: number): StubResponse | undefined {
  if (record.url.includes("/v1/settings/model/efforts")) return ok({ slot: "primary", model: "deepseek-v4", efforts: ["low", "medium", "high"], effectiveEffort: "high" });
  if (record.url.includes("/v1/settings/model/catalog")) return ok({ models: catalogModels(count) });
  return undefined;
}

const choose = (harness: PanelHarness, value: string): void => {
  const select = element(harness, LANGUAGE_LIST);
  select.value = value;
  select.dispatch("change");
};

const popover = (harness: PanelHarness): StubElement => required(harness.body().find((node) => node.classList.has("menu")));
const card = (harness: PanelHarness): StubElement => required(output(harness).find((node) => node.classList.has("setup-card")));
const headingOf = (root: StubElement): string => required(root.find((node) => node.tagName === "H2")).textContent;

test("the first-run card is painted in German and repaints in Japanese at once, keeping a pending problem message in step", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => {
      sidecar.automaticLanguage = "de";
      sidecar.modelConfigured = false;
    },
  });
  assert.equal(headingOf(card(harness)), "extynt einrichten");
  assert.deepEqual(textsOf(card(harness), "setup-step-title"), ["Modell verbinden", "Einen Prompt für deine Auswahl testen"]);
  assert.deepEqual(textsOf(card(harness), "setup-status"), ["Noch nicht getestet."]);
  const save = required(card(harness).find((node) => node.tagName === "BUTTON" && node.textContent === "Testen und speichern"));
  save.dispatch("click");
  assert.deepEqual(textsOf(card(harness), "setup-status"), ["Füge zuerst einen API-Schlüssel ein."]);
  choose(harness, "ja");
  assert.equal(headingOf(card(harness)), "extynt をセットアップ");
  assert.deepEqual(textsOf(card(harness), "setup-step-title"), ["モデルを接続", "選択範囲でプロンプトを試す"]);
  assert.deepEqual(textsOf(card(harness), "setup-status"), ["先に API キーを貼り付けてください。"]);
});

test("the composer pill and its tooltip follow the language", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; } });
  assert.equal(element(harness, "model-picker").title, "Modell und Denkaufwand: DeepSeek · high");
  choose(harness, "en");
  assert.equal(element(harness, "model-picker").title, "Model and reasoning effort: DeepSeek · high");
  choose(harness, "ja");
  assert.equal(element(harness, "model-picker").getAttribute("aria-label"), "モデルと推論の強度：DeepSeek · high");
});

test("the model popover reads in Japanese and repaints in English while open, keeping what was typed in its filter", () => {
  const harness = createPanelHarness({
    sidecar: (sidecar) => { sidecar.automaticLanguage = "ja"; },
    respond: (record) => answerModelRoute(record, 41),
  });
  harness.click("model-picker");
  assert.deepEqual(textsOf(popover(harness), "menu-group-title"), ["DeepSeek のモデル", "推論の強度"]);
  assert.deepEqual(popover(harness).all((node) => node.getAttribute("role") === "radio").map((node) => node.textContent), ["デフォルト", "低", "中", "高"]);
  const filter = required(popover(harness).find((node) => node.classList.has("menu-filter")));
  assert.equal(filter.getAttribute("placeholder"), "41 件のモデルを絞り込む…");
  filter.value = "Model 1";
  filter.dispatch("input");
  choose(harness, "en");
  const repainted = required(popover(harness).find((node) => node.classList.has("menu-filter")));
  assert.equal(repainted.getAttribute("placeholder"), "Filter 41 models…");
  assert.equal(repainted.value, "Model 1");
  assert.deepEqual(textsOf(popover(harness), "menu-group-title"), ["DeepSeek models", "Reasoning effort"]);
  assert.equal(popover(harness).getAttribute("aria-label"), "Model and reasoning effort");
});

test("the Settings provider forms take the language of the interface, labels included", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; } });
  const formText = (): string => element(harness, "model-primary").textContent;
  assert.ok(formText().includes("Anbieter"), formText());
  assert.ok(formText().includes("Adresse"), formText());
  choose(harness, "ja");
  assert.ok(formText().includes("サービス"), formText());
  assert.ok(!formText().includes("Anbieter"), formText());
});
