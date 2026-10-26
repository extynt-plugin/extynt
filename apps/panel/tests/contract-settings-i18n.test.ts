/** Panel contract: the Settings and Developer pages speak German and Japanese as the catalogue says, plurals and placeholders fill in, and a switch of language repaints the open views at once. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { element } from "./contract-helpers.js";
import { type JsonValue } from "@extynt/decode";

const text = (harness: PanelHarness, id: string): string => element(harness, id).textContent;
const choose = (harness: PanelHarness, value: string): void => {
  const select = element(harness, "interface-language");
  select.value = value;
  select.dispatch("change");
};
const json = (value: JsonValue): StubResponse => ({ status: 200, text: JSON.stringify(value) });
const catalogueStart = (progress: JsonValue) => (record: StubRequestRecord): StubResponse | undefined =>
  record.url.endsWith("/v1/catalogue/start") ? json({ ok: true, progress }) : undefined;

test("German: the Approvals heading, its pill, the copy button and the Preferences count are in German", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; Object.assign(sidecar.prefs, { suggestPrompts: false, rateLimit: false }); } });
  assert.equal(text(harness, "ask-heading"), "Wann soll extynt vor Änderungen am Projekt nachfragen?");
  assert.equal(text(harness, "approvals-state"), "Riskante Änderungen");
  assert.equal(text(harness, "frames-state"), "2 aus");
  assert.equal(text(harness, "mcp-copy-prompt"), "Prompt kopieren");
});

test("German: a plural picks its one-form for a single effect and its other-form for many", () => {
  const single = createPanelHarness({
    sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; },
    respond: catalogueStart({ state: "running", collected: 1, installed: 1, pending: 0, failed: 0 }),
  });
  single.click("catalogue-build");
  assert.equal(text(single, "catalogue-progress"), "Effektkatalog: 1 von 1 Effekt erfasst, 0 ausstehend, 0 übersprungen.");
  const many = createPanelHarness({
    sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; },
    respond: catalogueStart({ state: "running", collected: 12, installed: 40, pending: 27, failed: 1 }),
  });
  many.click("catalogue-build");
  assert.equal(text(many, "catalogue-progress"), "Effektkatalog: 12 von 40 Effekten erfasst, 27 ausstehend, 1 übersprungen.");
});

test("Japanese: the Approvals heading and the Preferences count come from the Japanese catalogue", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "ja"; Object.assign(sidecar.prefs, { suggestPrompts: false }); } });
  assert.equal(text(harness, "ask-heading"), "プロジェクトを変更する前に、extynt はいつ確認すべきですか？");
  assert.equal(text(harness, "approvals-state"), "リスクのある変更");
  assert.equal(text(harness, "frames-state"), "1 件オフ");
});

test("choosing a language repaints the open Approvals and the Developer progress at once, with no reload", () => {
  const harness = createPanelHarness({ respond: catalogueStart({ state: "running", collected: 12, installed: 40, pending: 27, failed: 1 }) });
  assert.equal(text(harness, "approvals-state"), "Risky changes");
  harness.click("catalogue-build");
  choose(harness, "ja");
  assert.equal(text(harness, "approvals-state"), "リスクのある変更");
  assert.equal(text(harness, "ask-heading"), "プロジェクトを変更する前に、extynt はいつ確認すべきですか？");
  assert.equal(text(harness, "catalogue-progress"), "エフェクトカタログ: 40 件中 12 件のエフェクトを収集、27 件保留、1 件スキップ。");
  assert.equal(harness.reloads(), 0);
});
