// The choices a settings save can make: reasoning effort set and cleared, what the model itself reports, one-field updates, fixed and typed addresses, and the rule on sending a key over plain http.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { loadLlmEnvFile } from "../src/llm-env-file.js";
import type { ModelSettingsStore, SaveOutcome } from "../src/llm-config.js";
import type { JsonValue } from "@extynt/decode";
import { fieldOf, flagOf, listOf, maybeTextOf, textOf } from "./http-json.js";
import { serveSettings, storeIn } from "./settings-fixture.js";

const SETTINGS = "/v1/settings/model";
const OK: SaveOutcome = { ok: true };
const KEY_RULE = "Use an https://";

function refusalOf(outcome: SaveOutcome): string {
  return outcome.ok ? "" : outcome.error;
}

function customSave(store: ModelSettingsStore, baseUrl: string, apiKey?: string): SaveOutcome {
  return store.save({ primary: { service: "custom", model: "m", baseUrl, ...(apiKey ? { apiKey } : {}) } });
}

function deepseekWithEffort(level: string): JsonValue {
  return { primary: { service: "deepseek", model: "deepseek-flash", apiKey: "sk-effort", reasoningEffort: level } };
}

test("a reasoning effort that is set reaches the settings view", async (t) => {
  const server = await serveSettings(t);
  assert.equal((await server.call("POST", SETTINGS, deepseekWithEffort("high"))).status, 200);
  assert.equal(maybeTextOf((await server.call("GET", SETTINGS)).json(), "slots.primary.reasoningEffort"), "high");
});

test("a reasoning effort that is set reaches the file the providers are built from", async (t) => {
  const server = await serveSettings(t);
  await server.call("POST", SETTINGS, deepseekWithEffort("high"));
  assert.equal(loadLlmEnvFile(server.filePath).AE_LLM_REASONING_EFFORT, "high");
});

test("clearing the reasoning effort is a choice, and the provider default carries no level", async (t) => {
  const server = await serveSettings(t);
  await server.call("POST", SETTINGS, deepseekWithEffort("high"));
  assert.equal((await server.call("POST", SETTINGS, { primary: { service: "deepseek", reasoningEffort: "" } })).status, 200);
  const cleared = (await server.call("GET", SETTINGS)).json();
  assert.deepEqual([maybeTextOf(cleared, "slots.primary.reasoningEffort"), fieldOf(cleared, "active.primary.reasoningEffort"), fieldOf(cleared, "active.primary.effectiveEffort")], [undefined, null, null]);
});

test("clearing the reasoning effort leaves the rest of the slot alone and removes the variable", async (t) => {
  const server = await serveSettings(t);
  await server.call("POST", SETTINGS, deepseekWithEffort("high"));
  await server.call("POST", SETTINGS, { primary: { service: "deepseek", reasoningEffort: "" } });
  assert.equal(textOf((await server.call("GET", SETTINGS)).json(), "slots.primary.model"), "deepseek-flash");
  assert.equal("AE_LLM_REASONING_EFFORT" in loadLlmEnvFile(server.filePath), false);
});

test("a reasoning effort no provider accepts is refused", async (t) => {
  const server = await serveSettings(t);
  await server.call("POST", SETTINGS, deepseekWithEffort("high"));
  assert.equal((await server.call("POST", SETTINGS, { primary: { service: "deepseek", reasoningEffort: "turbo" } })).status, 422);
});

const MODEL_URL = "https://api.anthropic.com/v1/models/claude-model";

async function viewOfReportingModel(t: TestContext): Promise<{ view: JsonValue; asked: string[] }> {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.anthropic.com/")) return realFetch(input, init);
    asked.push(url);
    const effort = { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: false }, max: { supported: false } };
    const capabilities = { image_input: { supported: false }, effort, thinking: { supported: true, types: { adaptive: { supported: true } } } };
    return new Response(JSON.stringify({ id: "claude-model", max_tokens: 64_000, capabilities }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const env = { AE_LLM_PROVIDER: "anthropic", AE_LLM_MODEL: "claude-model", ANTHROPIC_API_KEY: "sk-ant-test" };
  const server = await serveSettings(t, { env, discoverCapabilities: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { view: (await server.call("GET", SETTINGS)).json(), asked };
}

test("the model is asked about its capabilities once, by its own id", async (t) => {
  assert.deepEqual((await viewOfReportingModel(t)).asked, [MODEL_URL]);
});

test("the settings view carries the effort levels the model itself reported", async (t) => {
  assert.deepEqual(listOf((await viewOfReportingModel(t)).view, "active.primary.efforts"), ["low", "medium", "high"]);
});

test("the settings view carries whether the model takes images and who said so", async (t) => {
  const { view } = await viewOfReportingModel(t);
  assert.deepEqual([flagOf(view, "active.primary.acceptsImages"), textOf(view, "active.primary.imagesReportedBy")], [false, "model"]);
});

test("a one-choice effort update carries no service and keeps the model and key", (t) => {
  const { store, filePath } = storeIn(t);
  store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-partial-0123" } });
  assert.deepEqual(store.save({ primary: { reasoningEffort: "high" } }), OK);
  assert.deepEqual(loadLlmEnvFile(filePath), { AE_LLM_API_KEY: "sk-partial-0123", AE_LLM_MODEL: "deepseek-v4-pro", AE_LLM_PROVIDER: "deepseek", AE_LLM_REASONING_EFFORT: "high" });
});

test("saying whether the model takes images stores the answer", (t) => {
  const { store, filePath } = storeIn(t);
  store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro" } });
  store.save({ primary: { acceptsImages: false } });
  assert.equal(loadLlmEnvFile(filePath).AE_LLM_ACCEPTS_IMAGES, "false");
});

test("null hands the answer about images back to the model", (t) => {
  const { store, filePath } = storeIn(t);
  store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro", acceptsImages: false } });
  store.save({ primary: { acceptsImages: null } });
  assert.equal("AE_LLM_ACCEPTS_IMAGES" in loadLlmEnvFile(filePath), false);
});

test("naming another service starts the slot over", (t) => {
  const { store, filePath } = storeIn(t);
  store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-partial-0123", reasoningEffort: "high" } });
  store.save({ primary: { service: "xai", model: "grok-model", apiKey: "xai-key-0123" } });
  const stored = loadLlmEnvFile(filePath);
  assert.deepEqual([stored.AE_LLM_PROVIDER, stored.AE_LLM_API_KEY, stored.DEEPSEEK_API_KEY, stored.AE_LLM_REASONING_EFFORT], ["xai", "xai-key-0123", "sk-partial-0123", undefined]);
  assert.equal(store.resolve("primary")?.baseUrl, "https://api.x.ai/v1");
});

test("returning to a service restores its own key", (t) => {
  const { store } = storeIn(t);
  store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-partial-0123" } });
  store.save({ primary: { service: "xai", model: "grok-model", apiKey: "xai-key-0123" } });
  assert.deepEqual(store.save({ primary: { service: "deepseek" } }), OK);
  assert.equal(store.resolve("primary")?.apiKey, "sk-partial-0123");
});

test("a named service keeps its own address whatever address is sent", (t) => {
  const { store, filePath } = storeIn(t);
  assert.deepEqual(store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro", baseUrl: "https://evil.example/v1" } }), OK);
  assert.equal("AE_LLM_BASE_URL" in loadLlmEnvFile(filePath), false);
  assert.equal(store.resolve("primary")?.baseUrl, "https://api.deepseek.com");
});

test("a local server's address is stored because its port can change", (t) => {
  const { store, filePath } = storeIn(t);
  assert.deepEqual(store.save({ primary: { service: "ollama", model: "llama3.1", baseUrl: "http://127.0.0.1:11500/v1" } }), OK);
  assert.equal(loadLlmEnvFile(filePath).AE_LLM_BASE_URL, "http://127.0.0.1:11500/v1");
});

test("an api key over plain http to a LAN host is refused with the rule and never echoed", (t) => {
  const refused = refusalOf(customSave(storeIn(t).store, "http://10.0.0.5:8080/v1", "sk-lan-0123"));
  assert.match(refused, /Use an https:\/\/ address to send an API key, or remove the key for a local server\./);
  assert.equal(refused.includes("sk-lan-0123"), false);
});

test("a refused save writes nothing", (t) => {
  const { store, filePath } = storeIn(t);
  customSave(store, "http://10.0.0.5:8080/v1", "sk-lan-0123");
  assert.equal(loadLlmEnvFile(filePath).AE_LLM_API_KEY, undefined);
});

test("a keyless address is not refused by the key rule", (t) => {
  assert.equal(refusalOf(customSave(storeIn(t).store, "http://10.0.0.5:8080/v1")).includes(KEY_RULE), false);
});

test("an api key over https always passes", (t) => {
  assert.deepEqual(customSave(storeIn(t).store, "https://10.0.0.5/v1", "sk-https-0123"), OK);
});

for (const baseUrl of ["http://127.0.0.1:8080/v1", "http://localhost:8080/v1", "http://[::1]:8080/v1", "http://api.localhost:8080/v1"]) {
  test(`${baseUrl} is loopback for the key rule`, (t) => {
    assert.equal(refusalOf(customSave(storeIn(t).store, baseUrl, "sk-local-0123")).includes(KEY_RULE), false);
  });
}

test("the fallback slot is checked by the key rule too", (t) => {
  const refused = storeIn(t).store.save({ primary: { service: "ollama", model: "llama3.1" }, fallback: { service: "custom", model: "m", baseUrl: "http://192.168.1.20/v1", apiKey: "sk-fb-0123" } });
  assert.equal(refused.ok, false);
});
