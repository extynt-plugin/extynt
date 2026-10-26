/** Panel contract: the chat composer speaks the panel's language at start, and a live switch repaints its controls at once. */
import assert from "node:assert/strict";
import test from "node:test";
import { createPanelHarness } from "./contract.test.js";
import { element } from "./contract-helpers.js";

const choose = (harness: ReturnType<typeof createPanelHarness>, value: string): void => {
  const select = element(harness, "interface-language");
  select.value = value;
  select.dispatch("change");
};

test("the composer opens in German when the sidecar resolves German", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; } });
  assert.equal(element(harness, "chat-message").placeholder, "Frage stellen oder eine Änderung beschreiben…");
  assert.equal(element(harness, "chat").textContent, "Senden");
});

test("choosing Japanese repaints the composer placeholder and Send button at once, with no reload", () => {
  const harness = createPanelHarness();
  choose(harness, "ja");
  assert.equal(element(harness, "chat-message").placeholder, "質問するか、変更内容を書いてください…");
  assert.equal(element(harness, "chat").textContent, "送信");
  assert.equal(harness.reloads(), 0);
});

test("switching back to English restores the English composer text", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; } });
  choose(harness, "en");
  assert.equal(element(harness, "chat-message").placeholder, "Ask, or describe a change…");
  assert.equal(element(harness, "chat").textContent, "Send");
});
