/** Panel contract: the chrome text (top bar, composer, page titles, chats and plurals) is painted in the chosen language, and a sticky page repaints at once. */
import assert from "node:assert/strict";
import test from "node:test";
import { translatorFor } from "@extynt/ui-text";
import { createPanelHarness } from "./contract.test.js";
import { element } from "./contract-helpers.js";

const CHOOSE_KEY_ELEMENT = "interface-language";

function choose(harness: ReturnType<typeof createPanelHarness>, value: string): void {
  const select = element(harness, CHOOSE_KEY_ELEMENT);
  select.value = value;
  select.dispatch("change");
}

test("German chrome: the top bar and composer are painted in German", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "de"; } });
  assert.equal(element(harness, "open-settings").getAttribute("title"), "Einstellungen");
  assert.equal(element(harness, "chat-message").getAttribute("placeholder"), "Frag etwas oder beschreibe eine Änderung…");
  assert.equal(element(harness, "chat").textContent, "Senden");
});

test("Japanese chrome: the composer hint and search are painted in Japanese", () => {
  const harness = createPanelHarness({ sidecar: (sidecar) => { sidecar.automaticLanguage = "ja"; } });
  assert.equal(element(harness, "chat").textContent, "送信");
  assert.equal(element(harness, "sessions-search").getAttribute("placeholder"), "チャットを検索");
});

test("an open settings page repaints its title at once when the language changes", () => {
  const harness = createPanelHarness();
  element(harness, "open-settings").dispatch("click");
  assert.equal(element(harness, "page-title").textContent, "Settings");
  choose(harness, "fr");
  assert.equal(element(harness, "page-title").textContent, "Réglages");
  assert.equal(element(harness, "open-settings").getAttribute("title"), "Réglages");
});

test("plural chrome picks the singular for one and the plural otherwise", () => {
  const en = translatorFor("en");
  const de = translatorFor("de");
  assert.equal(en("chrome.sessions.messages", { count: 1 }), "1 message");
  assert.equal(en("chrome.sessions.messages", { count: 3 }), "3 messages");
  assert.equal(de("chrome.sessions.messages", { count: 1 }), "1 Nachricht");
  assert.equal(de("chrome.sessions.messages", { count: 3 }), "3 Nachrichten");
  assert.equal(translatorFor("ja")("chrome.sessions.messages", { count: 3 }), "3 件のメッセージ");
});

test("placeholders in chrome text are filled from the named parameters", () => {
  assert.equal(translatorFor("en")("chrome.empty.selected", { count: 1, composition: "Main" }), "You have 1 layer selected in “Main”.");
  assert.equal(translatorFor("de")("chrome.refs.tooMany", { max: 6, count: 2 }), "Einer Nachricht können höchstens 6 Bilder angehängt werden; 2 wurden nicht hinzugefügt.");
});
