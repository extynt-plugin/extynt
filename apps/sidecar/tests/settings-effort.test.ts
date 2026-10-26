// Reasoning effort end to end: Default sends nothing, a level the model lacks is resolved once and reported, and the level list follows the model.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { supportsTools } from "@extynt/llm";
import { fieldOf, listOf, parseJson, recordOf, textOf, type JsonObject } from "./http-json.js";
import { serveSettings, type SettingsServer } from "./settings-fixture.js";

type Levels = Record<string, readonly string[]>;

const SETTINGS = "/v1/settings/model";
const EFFORTS = `${SETTINGS}/efforts?slot=primary`;
const FLASH_LEVELS = ["low", "high", "max"];
const PRO_LEVELS = ["low", "medium", "high"];

function modelLists(): Levels {
  return { "deepseek-flash": FLASH_LEVELS, "deepseek-v4-pro": PRO_LEVELS };
}

function stubProvider(t: TestContext, lists: Levels): { listReads: string[]; chatBodies: JsonObject[] } {
  const realFetch = globalThis.fetch;
  const listReads: string[] = [];
  const chatBodies: JsonObject[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://api.deepseek.com/")) return realFetch(input, init);
    if (url.endsWith("/chat/completions")) {
      chatBodies.push(recordOf(parseJson(String(init?.body)), ""));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }), { status: 200 });
    }
    listReads.push(url);
    return new Response(JSON.stringify({ data: Object.entries(lists).map(([id, levels]) => ({ id, effort: { supported_levels: levels } })) }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return { listReads, chatBodies };
}

async function settle(done: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100 && !(await done()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

async function viewOf(server: SettingsServer, path: string): Promise<string | undefined> {
  return JSON.stringify(fieldOf((await server.call("GET", SETTINGS)).json(), path));
}

async function activeEfforts(server: SettingsServer): Promise<string | undefined> {
  return viewOf(server, "active.primary.efforts");
}

async function flashServer(t: TestContext, primary: { apiKey: string; reasoningEffort?: string }): Promise<SettingsServer> {
  const server = await serveSettings(t, { discoverCapabilities: true });
  await server.call("POST", SETTINGS, { primary: { service: "deepseek", model: "deepseek-flash", acknowledgeTrainingRisk: true, ...primary } });
  await settle(async () => (await activeEfforts(server)) !== "null");
  return server;
}

test("Default stores no level and the view invents none", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-default" });
  assert.equal(await viewOf(server, "slots.primary.reasoningEffort"), undefined);
});

test("Default reports no level for the running model", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-default" });
  assert.deepEqual([await viewOf(server, "active.primary.reasoningEffort"), await viewOf(server, "active.primary.effectiveEffort")], ["null", "null"]);
});

test("Default sends no effort or thinking parameter", async (t) => {
  const seen = stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-default" });
  const provider = server.store.providers().primary;
  assert.ok(supportsTools(provider));
  await provider.step({ requestId: "default", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [] });
  const sent = seen.chatBodies[0] ?? {};
  assert.deepEqual(["reasoning_effort" in sent, "thinking" in sent], [false, false]);
});

test("a stored level the model does not offer is kept as chosen", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-level", reasoningEffort: "medium" });
  assert.equal(textOf((await server.call("GET", SETTINGS)).json(), "slots.primary.reasoningEffort"), "medium");
});

test("a stored level the model does not offer is reported as the next level up", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-level", reasoningEffort: "medium" });
  assert.equal(textOf((await server.call("GET", SETTINGS)).json(), "active.primary.effectiveEffort"), "high");
});

test("the level route answers with the model's levels and the level that is sent", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-level", reasoningEffort: "medium" });
  const answer = (await server.call("GET", EFFORTS)).json();
  assert.deepEqual([listOf(answer, "efforts"), textOf(answer, "effectiveEffort")], [FLASH_LEVELS, "high"]);
});

test("without a refresh the first answer for the levels stands", async (t) => {
  const lists = modelLists();
  stubProvider(t, lists);
  const server = await flashServer(t, { apiKey: "sk-level", reasoningEffort: "medium" });
  await server.call("GET", EFFORTS);
  lists["deepseek-flash"] = PRO_LEVELS;
  assert.deepEqual(listOf((await server.call("GET", EFFORTS)).json(), "efforts"), FLASH_LEVELS);
});

test("a refresh reads the provider's new levels and the stored level is sent as it is", async (t) => {
  const lists = modelLists();
  stubProvider(t, lists);
  const server = await flashServer(t, { apiKey: "sk-level", reasoningEffort: "medium" });
  await server.call("GET", EFFORTS);
  lists["deepseek-flash"] = PRO_LEVELS;
  const refreshed = (await server.call("GET", `${EFFORTS}&refresh=1`)).json();
  assert.deepEqual([listOf(refreshed, "efforts"), textOf(refreshed, "effectiveEffort")], [PRO_LEVELS, "medium"]);
});

test("the view follows a refresh", async (t) => {
  const lists = modelLists();
  stubProvider(t, lists);
  const server = await flashServer(t, { apiKey: "sk-level", reasoningEffort: "medium" });
  await server.call("GET", EFFORTS);
  lists["deepseek-flash"] = PRO_LEVELS;
  await server.call("GET", `${EFFORTS}&refresh=1`);
  assert.equal(textOf((await server.call("GET", SETTINGS)).json(), "active.primary.effectiveEffort"), "medium");
});

test("moving the slot to another model shows that model's own levels", async (t) => {
  const lists = modelLists();
  stubProvider(t, lists);
  const server = await flashServer(t, { apiKey: "sk-switch", reasoningEffort: "medium" });
  await server.call("POST", SETTINGS, { primary: { model: "deepseek-v4-pro" } });
  await settle(async () => (await activeEfforts(server)) === JSON.stringify(PRO_LEVELS));
  assert.equal(await activeEfforts(server), JSON.stringify(PRO_LEVELS));
});

test("moving back to a model heard from before asks the provider again", async (t) => {
  const lists = modelLists();
  const seen = stubProvider(t, lists);
  const server = await flashServer(t, { apiKey: "sk-switch", reasoningEffort: "medium" });
  await server.call("POST", SETTINGS, { primary: { model: "deepseek-v4-pro" } });
  await settle(async () => (await activeEfforts(server)) === JSON.stringify(PRO_LEVELS));
  lists["deepseek-flash"] = ["low", "high"];
  const reads = seen.listReads.length;
  await server.call("POST", SETTINGS, { primary: { model: "deepseek-flash" } });
  await settle(async () => (await activeEfforts(server)) === JSON.stringify(["low", "high"]));
  assert.deepEqual([await activeEfforts(server), seen.listReads.length > reads], [JSON.stringify(["low", "high"]), true]);
});

test("saving only the effort keeps the model's levels", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-keep" });
  await server.call("POST", SETTINGS, { primary: { reasoningEffort: "max" } });
  assert.deepEqual(listOf((await server.call("GET", SETTINGS)).json(), "active.primary.efforts"), FLASH_LEVELS);
});

test("saving only the effort sends that level", async (t) => {
  stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-keep" });
  await server.call("POST", SETTINGS, { primary: { reasoningEffort: "max" } });
  assert.equal(textOf((await server.call("GET", SETTINGS)).json(), "active.primary.effectiveEffort"), "max");
});

test("saving only the effort does not ask the provider again", async (t) => {
  const seen = stubProvider(t, modelLists());
  const server = await flashServer(t, { apiKey: "sk-keep" });
  const reads = seen.listReads.length;
  await server.call("POST", SETTINGS, { primary: { reasoningEffort: "max" } });
  assert.equal(seen.listReads.length, reads);
});
