// The model list a provider publishes: asked for with the right key in the provider's own shape, sorted, and never carrying the key back.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { flagOf, listOf, maybeTextOf, numberOf, textOf } from "./http-json.js";
import { serveSettings, type SettingsServer } from "./settings-fixture.js";

type CatalogShape = "openai" | "anthropic" | "openrouter";

interface AskedOf {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const SETTINGS = "/v1/settings/model";
const CATALOG = `${SETTINGS}/catalog`;
const SECRET = "sk-catalog-secret";
const BODIES: Readonly<Record<CatalogShape, JsonObject>> = {
  anthropic: { data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5" }, { id: "claude-opus-4" }] },
  openrouter: { data: [{ id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", context_length: 200000 }, { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", context_length: 1048576 }] },
  openai: { object: "list", data: [{ id: "deepseek-v4-pro", object: "model" }, { id: "deepseek-v4-flash", object: "model" }] },
};

async function catalogServer(t: TestContext, shape: CatalogShape): Promise<{ server: SettingsServer; asked: AskedOf[] }> {
  const asked: AskedOf[] = [];
  const fetchCatalog = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    asked.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers)) });
    return new Response(JSON.stringify(BODIES[shape]), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { server: await serveSettings(t, { fetch: fetchCatalog }), asked };
}

async function deepseekCatalog(t: TestContext): Promise<{ catalog: JsonValue; asked: AskedOf[] }> {
  const { server, asked } = await catalogServer(t, "openai");
  await server.call("POST", SETTINGS, { primary: { service: "deepseek", model: "deepseek-v4-flash", apiKey: SECRET } });
  return { catalog: (await server.call("GET", `${CATALOG}?slot=primary`)).json(), asked };
}

test("no provider configured yet means nothing to ask for", async (t) => {
  const { server } = await catalogServer(t, "openai");
  assert.equal((await server.call("GET", CATALOG)).status, 422);
});

test("a provider's list can be previewed before any settings are saved", async (t) => {
  const { server, asked } = await catalogServer(t, "openrouter");
  const preview = (await server.call("POST", CATALOG, { service: "openrouter" })).json();
  assert.deepEqual([textOf(preview, "service"), asked.at(-1)?.url], ["openrouter", "https://openrouter.ai/api/v1/models"]);
});

test("the saved provider's list is sorted and offers the models the provider lists", async (t) => {
  const { catalog } = await deepseekCatalog(t);
  assert.equal(flagOf(catalog, "ok"), true);
  assert.deepEqual(listOf(catalog, "models").map((model) => textOf(model, "id")), ["deepseek-v4-flash", "deepseek-v4-pro"]);
});

test("the window known for the service rides along with its list", async (t) => {
  const { catalog } = await deepseekCatalog(t);
  assert.deepEqual([textOf(catalog, "service"), numberOf(catalog, "contextWindow")], ["deepseek", 1_000_000]);
});

test("the list is fetched from the service's address with the saved key", async (t) => {
  const { asked } = await deepseekCatalog(t);
  assert.deepEqual([asked.at(-1)?.url, asked.at(-1)?.headers.authorization], ["https://api.deepseek.com/models", `Bearer ${SECRET}`]);
});

test("the key never comes back in the answer", async (t) => {
  const { catalog } = await deepseekCatalog(t);
  assert.doesNotMatch(JSON.stringify(catalog), new RegExp(SECRET));
});

test("an Anthropic list keeps the display name when the provider gives one", async (t) => {
  const { server } = await catalogServer(t, "anthropic");
  await server.call("POST", SETTINGS, { primary: { service: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-secret" } });
  assert.deepEqual(listOf((await server.call("GET", CATALOG)).json(), "models"), [{ id: "claude-opus-4" }, { id: "claude-sonnet-5", name: "Claude Sonnet 5" }]);
});

test("Anthropic is asked with its own key header and no bearer token", async (t) => {
  const { server, asked } = await catalogServer(t, "anthropic");
  await server.call("POST", SETTINGS, { primary: { service: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-secret" } });
  await server.call("GET", CATALOG);
  assert.deepEqual([asked.at(-1)?.headers["x-api-key"], "authorization" in (asked.at(-1)?.headers ?? {})], ["sk-ant-secret", false]);
});

test("previewing another provider uses that provider's own saved key", async (t) => {
  const { server, asked } = await catalogServer(t, "openai");
  await server.call("POST", SETTINGS, { primary: { service: "deepseek", model: "deepseek-v4-flash", apiKey: SECRET } });
  await server.call("POST", SETTINGS, { primary: { service: "anthropic", model: "claude-sonnet-5", apiKey: "sk-ant-secret" } });
  const preview = (await server.call("POST", CATALOG, { service: "deepseek" })).json();
  assert.deepEqual([textOf(preview, "service"), asked.at(-1)?.headers.authorization], ["deepseek", `Bearer ${SECRET}`]);
});

test("a name and a per-model window come through for a provider that publishes them", async (t) => {
  const { server } = await catalogServer(t, "openrouter");
  await server.call("POST", SETTINGS, { primary: { service: "openrouter", model: "deepseek/deepseek-v4-pro", apiKey: "sk-or" } });
  assert.deepEqual(listOf((await server.call("GET", CATALOG)).json(), "models"), [
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", contextWindow: 200000 },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1048576 },
  ]);
});

test("an open catalogue is fetched without a key from the configured base url", async (t) => {
  const { server, asked } = await catalogServer(t, "openrouter");
  await server.call("POST", SETTINGS, { primary: { service: "openrouter", model: "x", apiKey: "" } });
  const answer = await server.call("GET", CATALOG);
  assert.deepEqual([answer.status, flagOf(answer.json(), "ok"), asked.at(-1)?.url], [200, true, "https://openrouter.ai/api/v1/models"]);
});

test("a provider that answers with an error is reported as unreachable with its status", async (t) => {
  const failing = async (): Promise<Response> => new Response("nope", { status: 500 });
  const server = await serveSettings(t, { fetch: failing });
  await server.call("POST", SETTINGS, { primary: { service: "deepseek", model: "deepseek-v4-flash", apiKey: SECRET } });
  const answer = await server.call("GET", CATALOG);
  assert.deepEqual([answer.status, maybeTextOf(answer.json(), "error.code")], [502, "CATALOG_HTTP_500"]);
});
