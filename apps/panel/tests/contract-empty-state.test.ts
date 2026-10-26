/** Panel contract: what an empty chat shows: prompt chips that follow the selection, or the one first-run card (connect a model, try a prompt). */
import assert from "node:assert/strict";
import test from "node:test";
import { StubElement } from "./contract-dom.js";
import { bar, chatBodies, chatResponder, element, nth, output, required, rowsOf, textsOf } from "./contract-helpers.js";
import { createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { readJson, recordAt, fieldOf } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

type Focus = { selected: number; kinds: string[]; names: string[] };

const NO_SELECTION: Focus = { selected: 0, kinds: [], names: [] };
const focusOf = (focus: Focus): JsonObject => ({
  project: "Fixture.aep",
  compositionId: "comp-1",
  compositionName: "Main",
  selected: focus.selected,
  layerNames: focus.names,
  kinds: focus.kinds,
  selectionFingerprint: "fp-" + focus.selected + focus.kinds.join(),
  at: 1,
});
const withFocus = (focus: Focus | null, extra: Parameters<typeof createPanelHarness>[0] = {}): PanelHarness =>
  createPanelHarness({
    ...extra,
    sidecar: (sidecar) => {
      sidecar.focus = focus ? focusOf(focus) : null;
      extra.sidecar?.(sidecar);
    },
  });
const chipTexts = (harness: PanelHarness): string[] =>
  (output(harness).find((node) => node.classList.has("chips")) ?? new StubElement("div"))
    .all((node) => node.tagName === "BUTTON")
    .map((node) => node.textContent);
const json = (value: JsonValue, status = 200): StubResponse => ({ status, text: JSON.stringify(value) });

test("an empty chat with a composition open asks what we are making and offers four prompts", () => {
  const harness = withFocus(NO_SELECTION);
  assert.equal(output(harness).find((node) => node.tagName === "H2")?.textContent, "What are we making?");
  assert.deepEqual(chipTexts(harness), ["What's in this comp?", "Find slow layers", "Add a title", "Add a background"]);
  assert.match(output(harness).textContent, /Select layers, then describe the change\./);
});

test("the prompts follow the live selection as After Effects reports it", () => {
  const harness = withFocus(NO_SELECTION);
  const select = (focus: Focus): string[] => {
    harness.sse("focus", { focus: focusOf(focus) });
    return chipTexts(harness);
  };
  assert.deepEqual(select({ selected: 1, kinds: ["shape"], names: ["Badge"] }), [
    "Pop in with bounce",
    "Add a drop shadow",
    "Blur in quickly",
    "Fade in over 1s",
  ]);
  assert.deepEqual(select({ selected: 1, kinds: ["text"], names: ["Title"] }), [
    "Type on by letter",
    "Slide up, ease out",
    "Tighten tracking",
    "Add a drop shadow",
  ]);
  assert.deepEqual(select({ selected: 3, kinds: ["shape", "shape", "text"], names: ["A", "B", "C"] }), [
    "Stagger by 4 frames",
    "Parent to a null",
    "Fade out at the end",
    "Align to center",
  ]);
  assert.deepEqual(select(NO_SELECTION), ["What's in this comp?", "Find slow layers", "Add a title", "Add a background"]);
});

test("pressing a prompt fills the message box and focuses it, and sends nothing", () => {
  const harness = withFocus({ selected: 1, kinds: ["text"], names: ["Title"] });
  const composer = element(harness, "chat-message"),
    before = composer.focused;
  const chip = nth(
    output(harness).all((node) => node.tagName === "BUTTON"),
    0,
  );
  chip.click();
  assert.equal(composer.value, "Type on by letter");
  assert.ok(composer.focused > before);
  assert.equal(chatBodies(harness).length, 0);
  assert.equal(harness.requests.filter((record) => record.method === "POST" && record.url.includes("/v1/chat")).length, 0);
});

test("with no composition open there are four prompts and a sentence that says to open one", () => {
  const harness = withFocus(null);
  assert.deepEqual(chipTexts(harness), ["What can you do?", "Make a 1080p comp", "Check my project", "List my comps"]);
  assert.match(output(harness).textContent, /Open a composition in After Effects to get started\./);
  harness.sse("focus", { focus: focusOf(NO_SELECTION) });
  assert.doesNotMatch(output(harness).textContent, /Open a composition in After Effects to get started\./);
  harness.sse("focus", { focus: null });
  assert.deepEqual(chipTexts(harness), ["What can you do?", "Make a 1080p comp", "Check my project", "List my comps"]);
});

test("the prompts give way to the conversation once there is one, and return with a new chat", () => {
  const harness = withFocus(NO_SELECTION, { respond: chatResponder(() => ({ answer: "Done." })) });
  harness.send("hello");
  assert.equal(chipTexts(harness).length, 0);
  assert.equal(
    output(harness).find((node) => node.tagName === "H2"),
    null,
  );
  assert.equal(rowsOf(harness, "user").length, 1);
  harness.click("chat-clear");
  assert.equal(chipTexts(harness).length, 4);
});

const unconfigured = (extra: Parameters<typeof createPanelHarness>[0] = {}): PanelHarness =>
  withFocus(NO_SELECTION, {
    ...extra,
    sidecar: (sidecar) => {
      sidecar.modelConfigured = false;
      extra.sidecar?.(sidecar);
    },
  });
const card = (harness: PanelHarness): StubElement => required(output(harness).find((node) => node.classList.has("setup-card")));
const providers = (harness: PanelHarness): StubElement[] => card(harness).all((node) => node.classList.has("setup-provider"));
const keyField = (harness: PanelHarness): StubElement => required(card(harness).find((node) => node.tagName === "INPUT"));
const saveButton = (harness: PanelHarness): StubElement =>
  nth(
    card(harness).all((node) => node.tagName === "BUTTON" && node.textContent === "Test & save"),
    0,
  );
const typeKey = (harness: PanelHarness, key: string): void => {
  const field = keyField(harness);
  field.value = key;
  field.dispatch("input");
};
const statusOf = (harness: PanelHarness): string => textsOf(card(harness), "setup-status")[0] ?? "";

test("with no model the empty chat is the two-step first-run card, with provider buttons and a key field", () => {
  const harness = unconfigured();
  assert.deepEqual(textsOf(card(harness), "setup-provider"), ["DeepSeek", "Anthropic", "Ollama (local)"]);
  assert.equal(card(harness).find((node) => node.tagName === "H2")?.textContent, "Set up extynt");
  assert.deepEqual(textsOf(card(harness), "setup-step-title"), ["Connect a model", "Try a prompt for your selection"]);
  assert.deepEqual(textsOf(card(harness), "setup-num"), ["1", "2"]);
  assert.deepEqual(
    providers(harness).map((node) => node.getAttribute("aria-pressed")),
    ["true", "false", "false"],
    "the recommended provider starts chosen",
  );
  assert.equal(keyField(harness).type, "password");
  assert.equal(saveButton(harness).textContent, "Test & save");
  assert.ok(
    nth(
      card(harness).all((node) => node.classList.has("chips")),
      0,
    )
      .all((node) => node.tagName === "BUTTON")
      .every((node) => node.disabled),
    "step two waits: its prompts cannot be used until a model is connected",
  );
  assert.match(bar(harness).text, /Set up a model to start\./, "the bar only points at the card");
  assert.deepEqual(bar(harness).actions, ["Set up"]);
});

test("the setup copy never mentions Diagnostics", () => {
  const harness = unconfigured();
  assert.doesNotMatch(output(harness).textContent + element(harness, "status-bar").textContent, /Diagnostics/i);
});

test("choosing a provider moves the pressed state and keeps what was typed", () => {
  const harness = unconfigured();
  typeKey(harness, "sk-typed");
  nth(providers(harness), 1).click();
  assert.deepEqual(
    providers(harness).map((node) => node.getAttribute("aria-pressed")),
    ["false", "true", "false"],
  );
  assert.equal(keyField(harness).value, "sk-typed");
});

test("a live update while the key is typed keeps the field focused, with the caret where it was", () => {
  const harness = unconfigured();
  typeKey(harness, "sk-par");
  const before = keyField(harness);
  before.selectionStart = 6;
  before.selectionEnd = 6;
  harness.document.activeElement = before;
  harness.sse("focus", { focus: focusOf({ selected: 1, kinds: ["text"], names: ["Title"] }) });
  const after = keyField(harness);
  assert.notEqual(after, before, "the card was rebuilt");
  assert.ok(after.focused > 0, "focus moved to the new field, not to After Effects");
  assert.deepEqual([after.value, after.selection], ["sk-par", [6, 6]]);
});

test("a live update does not pull focus into the card when the user is elsewhere", () => {
  const harness = unconfigured();
  harness.document.activeElement = harness.el("chat-message");
  harness.sse("focus", { focus: focusOf({ selected: 1, kinds: ["text"], names: ["Title"] }) });
  assert.equal(keyField(harness).focused, 0);
});

const tick = (harness: PanelHarness): void => {
  const box = card(harness).all((node) => node.tagName === "INPUT" && node.type === "checkbox")[0];
  required(box).checked = true;
};

test("an empty key says to paste one and saves nothing", () => {
  const harness = unconfigured();
  saveButton(harness).click();
  assert.equal(statusOf(harness), "Paste an API key first.");
  assert.equal(
    harness.requests.filter((record) => record.method === "POST" && /\/v1\/settings\/model(\/test)?$/.test(record.url)).length,
    0,
  );
});

test("Save and test posts the chosen provider and key, tests the primary slot, then the chat shows the prompts", () => {
  let released = false;
  const holdReload = (record: StubRequestRecord): StubResponse | undefined => {
    if (record.url.endsWith("/v1/settings/model/test")) released = true;
    return released && record.method === "GET" && record.url.endsWith("/v1/settings/model") ? { hold: true } : undefined;
  };
  const harness = unconfigured({ respond: holdReload });
  nth(providers(harness), 1).click();
  typeKey(harness, "sk-secret");
  saveButton(harness).click();
  const [save] = harness.requests.filter((record) => record.method === "POST" && record.url.endsWith("/v1/settings/model"));
  assert.deepEqual(recordAt(readJson(required(save).body), "primary"), {
    service: "anthropic",
    model: "claude",
    apiKey: "sk-secret",
  });
  const [test] = harness.requestsTo("/v1/settings/model/test");
  assert.deepEqual(readJson(required(test).body), { slot: "primary" });
  assert.equal(statusOf(harness), "DeepSeek · deepseek-v4 answered.");
  const reload = required(harness.held().find((xhr) => xhr.url.endsWith("/v1/settings/model")));
  const slot = { service: "deepseek", model: "deepseek-v4", displayName: "DeepSeek", keyConfigured: true, acceptsImages: true };
  reload.respond(
    200,
    JSON.stringify({
      ok: true,
      slots: { primary: slot, fallback: null },
      active: { primary: slot, fallback: null },
      services: [],
      formats: {},
    }),
  );
  assert.equal(
    output(harness).find((node) => node.classList.has("setup-card")),
    null,
    "the card is gone",
  );
  assert.equal(chipTexts(harness).length, 4);
  assert.equal(bar(harness).state, "idle", "the setup state goes away");
});

test("a key the model refuses shows the sidecar's own message and leaves the card to try again", () => {
  const refused = (record: StubRequestRecord): StubResponse | undefined =>
    record.url.endsWith("/v1/settings/model/test") ? json({ ok: false, error: { message: "The key was rejected." } }) : undefined;
  const harness = unconfigured({ respond: refused });
  typeKey(harness, "sk-bad");
  tick(harness);
  saveButton(harness).click();
  assert.equal(statusOf(harness), "The key was rejected.");
  assert.equal(saveButton(harness).disabled, false);
});

test("a save the sidecar refuses shows why", () => {
  const refused = (record: StubRequestRecord): StubResponse | undefined =>
    record.method === "POST" && record.url.endsWith("/v1/settings/model")
      ? json({ ok: false, error: { message: "Could not store the key." } }, 400)
      : undefined;
  const harness = unconfigured({ respond: refused });
  typeKey(harness, "sk-x");
  tick(harness);
  saveButton(harness).click();
  assert.equal(statusOf(harness), "Could not store the key.");
  assert.equal(harness.requestsTo("/v1/settings/model/test").length, 0, "nothing to test when nothing was saved");
});

const setField = (harness: PanelHarness, id: string, value: string): void => {
  const field = element(harness, id);
  field.value = value;
  field.dispatch("input");
};
const saveRequests = (harness: PanelHarness): StubRequestRecord[] =>
  harness.requests.filter((record) => record.method === "POST" && /\/v1\/settings\/model(\/test)?$/.test(record.url));

test("for a local server the card asks for its address and a model, and no key", () => {
  const harness = unconfigured();
  nth(providers(harness), 2).click();
  assert.equal(element(harness, "setup-address").value, "http://127.0.0.1:11434/v1");
  assert.ok(harness.el("setup-model"), "no default model, so a model name is asked for");
  assert.ok(harness.el("setup-key"), "a local server may still be behind a key, so the field stays");
  assert.match(card(harness).textContent, /API key \(optional\)/);
  assert.match(card(harness).textContent, /Doesn't train on your work\./);
  assert.match(card(harness).textContent, /Ollama listens on port 11434 unless you changed it\./);
});

test("Test & save for a local server posts the typed address and model, with no key", () => {
  const harness = unconfigured();
  nth(providers(harness), 2).click();
  setField(harness, "setup-address", "http://127.0.0.1:11500/v1");
  setField(harness, "setup-model", "llama3.1");
  saveButton(harness).click();
  const [save] = harness.requests.filter((record) => record.method === "POST" && record.url.endsWith("/v1/settings/model"));
  assert.deepEqual(recordAt(readJson(required(save).body), "primary"), {
    service: "ollama",
    model: "llama3.1",
    baseUrl: "http://127.0.0.1:11500/v1",
  });
});

test("a local server with no model name posts nothing and says to type one", () => {
  const harness = unconfigured();
  nth(providers(harness), 2).click();
  saveButton(harness).click();
  assert.equal(statusOf(harness), "Type a model name first.");
  assert.equal(saveRequests(harness).length, 0);
});

test("a provider that may train on prompts blocks the save until the box is ticked, then sends the tick", () => {
  const harness = unconfigured();
  typeKey(harness, "sk-secret");
  assert.match(card(harness).textContent, /DeepSeek's terms allow it to use your prompts to train its models/);
  saveButton(harness).click();
  assert.equal(statusOf(harness), "Tick the box to accept that first.");
  assert.equal(saveRequests(harness).length, 0);
  tick(harness);
  saveButton(harness).click();
  const [save] = harness.requests.filter((record) => record.method === "POST" && record.url.endsWith("/v1/settings/model"));
  assert.equal(fieldOf(recordAt(readJson(required(save).body), "primary"), "acknowledgeTrainingRisk"), true);
});
