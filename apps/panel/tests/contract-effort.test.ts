/**
 * Panel contract: the one model popover by Send. It lists the current provider's models and the effort levels of the chosen
 * model, shows the level a request sends, treats Default as a real choice, saves a pick through the settings route, and reads
 * the level list again after a while. Provider and keys stay in Settings, which has no model choice and no effort pill.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { StubElement } from "./contract-dom.js";
import { createPanelHarness, type PanelHarness, type StubRequestRecord, type StubResponse } from "./contract.test.js";
import { fieldOf, readJson, recordAt } from "./json-narrow.js";
import { element, nth, required } from "./contract-helpers.js";
import { type JsonObject } from "@extynt/decode";

interface Setup {
  stored?: string;
  effective?: string | null;
  efforts?: string[] | undefined;
  refreshed?: { efforts: string[]; effectiveEffort: string | null };
  models?: Array<{ id: string; name?: string }>;
}

const ok = (body: JsonObject): StubResponse => ({ status: 200, text: JSON.stringify({ ok: true, ...body }) });
const MODELS = [
  { id: "deepseek-flash", name: "DeepSeek Flash" },
  { id: "deepseek-pro", name: "DeepSeek Pro" },
];

function modelPayload(setup: Setup, model = "deepseek-flash"): StubResponse {
  const slot = {
    service: "deepseek",
    model: model,
    baseUrl: "https://api.deepseek.com",
    displayName: "DeepSeek",
    keyConfigured: true,
    acceptsImages: true,
    ...(setup.stored ? { reasoningEffort: setup.stored } : {}),
  };
  const active = {
    ...slot,
    efforts: setup.efforts ?? null,
    effectiveEffort: setup.effective ?? null,
    reasoningEffort: setup.stored ?? null,
  };
  return ok({
    slots: { primary: slot, fallback: null },
    active: { primary: active, fallback: null },
    services: [
      { id: "deepseek", label: "DeepSeek", model: "deepseek-flash", keyRequired: true, trainingPolicy: "may-train" },
      { id: "anthropic", label: "Anthropic", model: "claude", keyRequired: true, trainingPolicy: "no-training" },
    ],
    formats: {},
  });
}

function effortsAnswer(setup: Setup, effortReads: StubRequestRecord[], record: StubRequestRecord): StubResponse {
  effortReads.push(record);
  const report =
    effortReads.length > 1 && setup.refreshed
      ? setup.refreshed
      : { efforts: setup.efforts ?? [], effectiveEffort: setup.effective ?? null };
  return ok({ slot: "primary", model: "deepseek-flash", ...report });
}

function responder(setup: Setup, effortReads: StubRequestRecord[]): (record: StubRequestRecord) => StubResponse | undefined {
  return (record) => {
    if (record.url.includes("/v1/settings/model/efforts")) return effortsAnswer(setup, effortReads, record);
    if (record.url.includes("/v1/settings/model/catalog")) return ok({ models: setup.models ?? MODELS });
    if (record.url.endsWith("/v1/settings/model") && record.method === "GET") return modelPayload(setup);
    return undefined;
  };
}

const popover = (harness: PanelHarness): StubElement => required(harness.body().find((node) => node.classList.has("menu")));
const modelRows = (harness: PanelHarness): StubElement[] =>
  popover(harness).all(
    (node) =>
      node.classList.has("menu-row") && node.getAttribute("role") === "menuitemradio" && !node.textContent.startsWith("Image input"),
  );
const efforts = (harness: PanelHarness): StubElement[] =>
  popover(harness).all((node) => node.tagName === "BUTTON" && node.getAttribute("role") === "radio");
const checkedEfforts = (harness: PanelHarness): string[] =>
  efforts(harness)
    .filter((row) => row.getAttribute("aria-checked") === "true")
    .map((row) => row.textContent);
const effortNames = (harness: PanelHarness): string[] => efforts(harness).map((row) => row.textContent);
const modelNames = (harness: PanelHarness): string[] =>
  modelRows(harness).map(
    (row) =>
      nth(
        row.all((node) => node.classList.has("menu-row-name")),
        0,
      ).textContent,
  );
const pill = (harness: PanelHarness): string => required(element(harness, "model-picker").querySelector(".effort-label")).textContent;
const tooltip = (harness: PanelHarness): string => element(harness, "model-picker").title;

test("one popover holds the current provider's models and the effort levels, with the footnote and the pointer to Settings", () => {
  const harness = createPanelHarness({
    respond: responder({ stored: "high", effective: "high", efforts: ["low", "medium", "high", "max"] }, []),
  });
  harness.click("model-picker");
  assert.equal(harness.body().all((node) => node.classList.has("menu")).length, 1, "one popover, not two pills");
  assert.deepEqual(modelNames(harness), ["DeepSeek Flash", "DeepSeek Pro"]);
  assert.deepEqual(
    modelRows(harness)
      .filter((row) => row.getAttribute("aria-checked") === "true")
      .map((row) => row.textContent.slice(0, 14)),
    ["DeepSeek Flash"],
  );
  assert.deepEqual(effortNames(harness), ["Default", "Low", "Med", "High", "Max"]);
  const text = popover(harness).textContent;
  assert.match(text, /DeepSeek models/);
  assert.doesNotMatch(text, /Anthropic/, "only the current provider's models; switching provider is Settings");
  assert.match(text, /Applies from the next step of a running job\./);
  assert.match(text, /Provider and keys: Settings/);
});

test("picking a model saves it as a primary-slot pref and keeps the popover open for its levels", () => {
  const saved: StubRequestRecord[] = [];
  const setup: Setup = { stored: "high", effective: "high", efforts: ["low", "high"] };
  const respond = responder(setup, []);
  const harness = createPanelHarness({
    respond: (record) => {
      if (record.method === "POST" && record.url.endsWith("/v1/settings/model")) {
        saved.push(record);
        return modelPayload(setup, "deepseek-pro");
      }
      return respond(record);
    },
  });
  harness.click("model-picker");
  required(modelRows(harness).find((row) => row.textContent.startsWith("DeepSeek Pro"))).click();
  assert.equal(saved.length, 1);
  assert.deepEqual(recordAt(fieldOf(readJson(nth(saved, 0).body), "primary")), { model: "deepseek-pro" });
  assert.equal(harness.body().all((node) => node.classList.has("menu")).length, 1, "still open: the new model offers its own levels");
  assert.ok(harness.requestsTo("/v1/settings/model/efforts").length >= 1);
});

test("a stored level the model does not offer: the pill and the checked level show the level that is sent", () => {
  const setup: Setup = { stored: "medium", effective: "high", efforts: ["low", "high", "max"] };
  const harness = createPanelHarness({ respond: responder(setup, []) });
  assert.match(pill(harness), /High$/, "the pill paints the level sent, not the stored one");
  assert.match(tooltip(harness), /high \(medium is not offered by this model\)/);
  harness.click("model-picker");
  assert.deepEqual(effortNames(harness), ["Default", "Low", "High", "Max"]);
  assert.deepEqual(checkedEfforts(harness), ["High"], "exactly one level is checked, and it is the level sent");
  assert.ok(efforts(harness).some((row) => /sent in place of medium/.test(row.title)));
});

test("Default is checked when nothing is chosen, shows no level, and saves an empty choice", () => {
  const setup: Setup = { efforts: ["low", "high", "max"] };
  const saved: StubRequestRecord[] = [];
  const respond = responder(setup, []);
  const harness = createPanelHarness({
    respond: (record) => {
      if (record.method === "POST" && record.url.endsWith("/v1/settings/model")) {
        saved.push(record);
        return modelPayload({ stored: "low", effective: "low", efforts: setup.efforts });
      }
      return respond(record);
    },
  });
  assert.doesNotMatch(pill(harness), /Low|Medium|High|Max/);
  assert.match(tooltip(harness), /Model and reasoning effort: .*Default/);
  harness.click("model-picker");
  assert.deepEqual(checkedEfforts(harness), ["Default"]);
  required(efforts(harness).find((row) => row.textContent === "Low")).click();
  assert.equal(fieldOf(recordAt(fieldOf(readJson(nth(saved, 0).body), "primary")), "reasoningEffort"), "low");
  harness.click("model-picker");
  required(efforts(harness).find((row) => row.textContent === "Default")).click();
  assert.equal(
    fieldOf(recordAt(fieldOf(readJson(nth(saved, 1).body), "primary")), "reasoningEffort"),
    "",
    "Default is sent as an empty choice, not as a level",
  );
});

test("the level list is kept for a few minutes, then read again with a refresh and the report repaints the pill", () => {
  const setup: Setup = {
    stored: "medium",
    effective: "high",
    efforts: ["low", "high", "max"],
    refreshed: { efforts: ["low", "medium", "high"], effectiveEffort: "medium" },
  };
  const reads: StubRequestRecord[] = [];
  const harness = createPanelHarness({ respond: responder(setup, reads) });
  harness.click("model-picker");
  assert.equal(reads.length, 1);
  assert.equal(nth(reads, 0).url.includes("refresh=1"), false, "the first read is an ordinary one");
  harness.click("model-picker");
  harness.advance(60_000);
  harness.click("model-picker");
  assert.equal(reads.length, 1, "inside the period the list is not asked for again");
  harness.click("model-picker");
  harness.advance(6 * 60_000);
  harness.click("model-picker");
  assert.equal(reads.length, 2);
  assert.ok(nth(reads, 1).url.includes("refresh=1"), "an old list is read again from the provider");
  assert.deepEqual(effortNames(harness), ["Default", "Low", "Med", "High"], "the new list replaces the old one");
  assert.deepEqual(checkedEfforts(harness), ["Med"]);
  assert.match(pill(harness), /Medium$/);
});

test("Settings no longer chooses a model or an effort: provider, key and fallback stay, and the pill is the one picker", () => {
  const html = readFileSync("apps/panel/index.html", "utf8");
  assert.match(html, /Provider &amp; keys/);
  assert.match(html, /Which model and effort to use is chosen next to the message box, not here\./);
  assert.doesNotMatch(html, /aria-label="Reasoning effort"/, "no effort-only pill");
  const harness = createPanelHarness({ respond: responder({ stored: "high", effective: "high", efforts: ["low", "high"] }, []) });
  harness.click("open-settings");
  const primary = element(harness, "model-primary");
  const labels = primary.all((node) => node.tagName === "LABEL" && !node.hidden).map((node) => node.textContent);
  assert.deepEqual(
    labels.filter((label) => /Find model|^Model|Custom model/.test(label)),
    [],
    "the primary form has no model selector",
  );
  assert.ok(labels.some((label) => /Service/.test(label)) && labels.some((label) => /API key/.test(label)));
});
