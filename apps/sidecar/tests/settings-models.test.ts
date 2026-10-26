// The model settings the panel edits: how workflow settings are layered, what a save writes to llm.env, what the view returns and what a saved choice changes at once.
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { withoutApplyInstructions } from "../src/agent.js";
import { createModelSettingsStore } from "../src/llm-config.js";
import { loadLlmEnvFile } from "../src/llm-env-file.js";
import { findModelService } from "../src/llm-model-services.js";
import { createSlotProvider } from "../src/llm-slot-provider.js";
import { resolveWorkflowRuntimeSettings } from "../src/runtime-config.js";
import { jsonOf } from "@extynt/mcp-server";
import { errorCodeOf, fieldOf, flagOf, listOf, recordOf, textOf } from "./http-json.js";
import { serveSettings, settingsFolder, type SettingsAnswer, type SettingsServer } from "./settings-fixture.js";
import { mutableSnapshot } from "./sidecar-fixture.js";

const SECRET = "sk-test-0123456789abcdef";
const SETTINGS = "/v1/settings/model";

function workflowFiles(t: TestContext): { filePath: string; dotEnvPath: string } {
  const root = settingsFolder(t, "runtime-settings");
  const filePath = join(root, "llm.env"), dotEnvPath = join(root, ".env");
  writeFileSync(filePath, "AE_WORKFLOW_ENGINE=workflow-v1\nAE_WORKFLOW_MAX_CYCLES=4\nAE_LLM_PROVIDER=mock\n");
  writeFileSync(dotEnvPath, "AE_WORKFLOW_MAX_CYCLES=6\n");
  return { filePath, dotEnvPath };
}

async function savedPanel(t: TestContext): Promise<{ server: SettingsServer; saved: SettingsAnswer }> {
  const server = await serveSettings(t, { env: { AE_LLM_FALLBACK_MODEL: "from-environment" } });
  const saved = await server.call("POST", SETTINGS, { primary: { service: "deepseek", model: "deepseek-v4-pro", apiKey: SECRET }, fallback: { service: "mock" } });
  return { server, saved };
}

test("the process environment overrides workflow settings in the files", (t) => {
  const { filePath, dotEnvPath } = workflowFiles(t);
  assert.deepEqual(resolveWorkflowRuntimeSettings({ filePath, dotEnvPath, processEnv: { AE_WORKFLOW_MAX_CYCLES: "8" } }), { workflowMaxCycles: 8 });
});

test("a development .env overrides workflow settings in llm.env", (t) => {
  const { filePath, dotEnvPath } = workflowFiles(t);
  assert.deepEqual(resolveWorkflowRuntimeSettings({ filePath, dotEnvPath, processEnv: {} }), { workflowMaxCycles: 6 });
});

test("a hand-set retired engine choice is reported and never stops startup", (t) => {
  const { filePath } = workflowFiles(t);
  assert.deepEqual(resolveWorkflowRuntimeSettings({ filePath, processEnv: { AE_WORKFLOW_ENGINE: "legacy" } }), { workflowMaxCycles: 4, retiredEngineSetting: "legacy" });
});

test("saving a model choice preserves the workflow settings in the shared settings file", (t) => {
  const { filePath } = workflowFiles(t);
  assert.deepEqual(createModelSettingsStore({ filePath, processEnv: {} }).save({ primary: { service: "mock" } }), { ok: true });
  assert.equal(loadLlmEnvFile(filePath).AE_WORKFLOW_MAX_CYCLES, "4");
});

test("a fresh install has no configured slot and no running model", async (t) => {
  const view = (await (await serveSettings(t)).call("GET", SETTINGS)).json();
  assert.equal(fieldOf(view, "slots.primary"), null);
  assert.equal(fieldOf(view, "active.primary"), null);
});

test("the settings view lists each service with its api format", async (t) => {
  const view = (await (await serveSettings(t)).call("GET", SETTINGS)).json();
  const deepseek = listOf(view, "services").find((service) => textOf(service, "id") === "deepseek");
  assert.equal(fieldOf(deepseek, "format"), "openai-chat");
});

test("testing a model that is not configured reports it as not configured", async (t) => {
  const answer = await (await serveSettings(t)).call("POST", `${SETTINGS}/test`, { slot: "primary" });
  assert.equal(errorCodeOf(recordOf(answer.json(), "")), "LLM_NOT_CONFIGURED");
});

test("the effort levels of a model that is not configured are refused", async (t) => {
  assert.equal((await (await serveSettings(t)).call("GET", `${SETTINGS}/efforts?slot=primary`)).status, 422);
});

test("a base url that is not a url is refused and nothing is written", async (t) => {
  const server = await serveSettings(t);
  const refused = await server.call("POST", SETTINGS, { primary: { service: "custom", baseUrl: "not a url", model: "x", apiKey: "sk-should-not-persist" } });
  assert.equal(refused.status, 422);
  assert.throws(() => statSync(server.filePath));
});

test("a saved key is never returned", async (t) => {
  const { saved } = await savedPanel(t);
  assert.equal(saved.status, 200);
  assert.equal(saved.text.includes(SECRET), false);
});

test("a saved slot is shown as its resolved settings with only a hint of the key", async (t) => {
  const { saved } = await savedPanel(t);
  assert.deepEqual(recordOf(saved.json(), "slots.primary"), { service: "deepseek", format: "openai-chat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", keyConfigured: true, keyHint: "…cdef", keySource: "llm.env", trainingPolicy: "may-train", trainingRiskAcknowledged: false, overriddenBy: [], contextWindow: 1_000_000, contextWindowSource: "service default" });
});

test("nothing is assumed about the running model: its images are offered until it says no, and its effort levels are unknown until it names them", async (t) => {
  const { saved } = await savedPanel(t);
  assert.deepEqual(recordOf(saved.json(), "active.primary"), { displayName: "DeepSeek", model: "deepseek-v4-pro", keyConfigured: true, contextWindow: 1_000_000, reasoningEffort: null, acceptsImages: true, imagesReportedBy: "unreported", efforts: null, effectiveEffort: null });
});

test("a setting from the environment is shown as overriding the file", async (t) => {
  const { saved } = await savedPanel(t);
  assert.deepEqual(listOf(saved.json(), "slots.fallback.overriddenBy"), ["environment"]);
  assert.equal(textOf(saved.json(), "slots.fallback.model"), "from-environment");
});

test("the settings file is owner-only and holds exactly the choices made", async (t) => {
  const { server } = await savedPanel(t);
  assert.equal(statSync(server.filePath).mode & 0o777, 0o600);
  assert.deepEqual(loadLlmEnvFile(server.filePath), { AE_LLM_API_KEY: SECRET, AE_LLM_FALLBACK_PROVIDER: "mock", AE_LLM_MODEL: "deepseek-v4-pro", AE_LLM_PROVIDER: "deepseek" });
});

test("the settings file starts with the extynt header", async (t) => {
  const { server } = await savedPanel(t);
  assert.match(readFileSync(server.filePath, "utf8"), /^# extynt model settings/);
});

test("a saved switch of service takes effect without a restart", async (t) => {
  const { server } = await savedPanel(t);
  const switched = await server.call("POST", SETTINGS, { primary: { service: "mock" } });
  assert.equal(textOf(switched.json(), "active.primary.displayName"), "Mock provider");
});

test("switching service stops the old key being sent to the new provider and keeps it for a switch back", async (t) => {
  const { server } = await savedPanel(t);
  await server.call("POST", SETTINGS, { primary: { service: "mock" } });
  const stored = loadLlmEnvFile(server.filePath);
  assert.equal(stored.AE_LLM_API_KEY, undefined);
  assert.equal(stored.DEEPSEEK_API_KEY, SECRET);
});

test("a newer key replaces the stored one, so switching back never revives a stale key", async (t) => {
  const { server } = await savedPanel(t);
  await server.call("POST", SETTINGS, { primary: { service: "mock" } });
  await server.call("POST", SETTINGS, { primary: { service: "deepseek", apiKey: "sk-test-fedcba9876543210" } });
  await server.call("POST", SETTINGS, { primary: { service: "mock" } });
  assert.equal(loadLlmEnvFile(server.filePath).DEEPSEEK_API_KEY, "sk-test-fedcba9876543210");
});

test("a configured mock model passes its connection test", async (t) => {
  const server = await serveSettings(t);
  await server.call("POST", SETTINGS, { primary: { service: "mock" } });
  assert.equal(flagOf((await server.call("POST", `${SETTINGS}/test`, { slot: "primary" })).json(), "ok"), true);
});

test("chat answers from the model just saved", async (t) => {
  const server = await serveSettings(t);
  await server.call("POST", SETTINGS, { primary: { service: "mock" } });
  await server.call("POST", "/v1/snapshots", jsonOf(mutableSnapshot("probe-settings")));
  const chat = (await server.call("POST", "/v1/chat", { requestId: "chat-settings", message: "hello" })).json();
  assert.deepEqual([textOf(chat, "mode"), textOf(chat, "model")], ["agent", "mock-v1"]);
});

test("clearing the key leaves the slot configured without one", async (t) => {
  const { server } = await savedPanel(t);
  const cleared = await server.call("POST", SETTINGS, { primary: { service: "deepseek", clearKey: true } });
  assert.equal(flagOf(cleared.json(), "slots.primary.keyConfigured"), false);
});

test("setting the fallback to null removes it", async (t) => {
  const { server } = await savedPanel(t);
  await server.call("POST", SETTINGS, { fallback: null });
  assert.equal(loadLlmEnvFile(server.filePath).AE_LLM_FALLBACK_PROVIDER, undefined);
});

test("the settings route requires the session token", async (t) => {
  const server = await serveSettings(t);
  assert.equal((await fetch(`${server.base}${SETTINGS}`)).status, 401);
});

test("a reply that points at the Apply button loses that instruction when changes are applied automatically", () => {
  assert.equal(withoutApplyInstructions("The plan adds opacity keyframes at 9s and 10s. Apply it with the button on the card."), "The plan adds opacity keyframes at 9s and 10s.");
});

test("a reply that asks for a click on Apply loses that instruction", () => {
  assert.equal(withoutApplyInstructions("It fades the title out. Click Apply on the card to run it."), "It fades the title out.");
});

test("a sentence that merely uses the word applies is kept", () => {
  assert.equal(withoutApplyInstructions("It applies a blur of 20 to Background."), "It applies a blur of 20 to Background.");
});

test("a provider is refused with a sentence that names the base url when the url is not valid", () => {
  const service = findModelService("custom");
  assert.ok(service);
  const created = createSlotProvider({ service, format: "openai-chat", baseUrl: "not a url", model: "x", apiKey: undefined, keyVariable: "AE_LLM_API_KEY", keySource: undefined, contextWindow: 0, contextWindowSource: "fixture", stream: false, trainingPolicy: "may-train", trainingRiskAcknowledged: false });
  assert.equal(created.error, 'Base URL "not a url" is not a valid URL.');
});
