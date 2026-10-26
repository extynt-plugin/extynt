// Web search: which endpoint each configured slot searches through, how a provider's reply is read, and what the model is handed.
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow } from "@extynt/decode";
import { toMcpToolResult } from "@extynt/mcp-server";
import type { JsonValue } from "@extynt/decode";
import { formatWebSearch, parseSearchQueries, searchBackendFor, searchWeb, webSearchToolSpec, type SearchSlot, type WebSearchOutcome } from "../src/web-search.js";
import { searchReplyDecoder } from "../src/web-search-payloads.js";
import { parseJson, textOf } from "./http-json.js";
import { storeIn } from "./settings-fixture.js";
import { sidecarFor, token } from "./sidecar-fixture.js";

const CG_CHANNEL = "https://www.cgchannel.com/2025/11/ae-25-6/";
const QUERIES = ["latest After Effects version"];
const DEEPSEEK: SearchSlot = { format: "openai-chat", baseUrl: "https://api.deepseek.com", apiKey: "k", model: "deepseek-v4-pro", service: { id: "deepseek" } };
const ANTHROPIC_REPLY: JsonValue = { content: [{ type: "text", text: "The latest is 25.6." }, { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "CG Channel", url: CG_CHANNEL, page_age: "November 2025" }] }], usage: { server_tool_use: { web_search_requests: 2 } } };
const OPENAI_REPLY: JsonValue = { output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: "The latest is 25.6.", annotations: [{ type: "url_citation", url: "https://example.com/y", title: "Example" }] }] }] };
const SILENT_REPLY: JsonValue = { output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "I think it is 26.4." }] }] };

interface SeenRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function answering(reply: JsonValue, seen: SeenRequest[] = []): typeof globalThis.fetch {
  return async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers)), body: String(init?.body ?? "") });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
}

async function searchedOnDeepseek(): Promise<{ outcome: WebSearchOutcome; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const outcome = await searchWeb({ backend: searchBackendFor({ ...DEEPSEEK, apiKey: "sk-derived" }), queries: QUERIES }, answering(ANTHROPIC_REPLY, seen));
  return { outcome, seen };
}

async function handedToTheModel(t: test.TestContext): Promise<string> {
  const { store } = storeIn(t);
  store.save({ primary: { service: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-search", acknowledgeTrainingRisk: true } });
  const sidecar = sidecarFor({ port: 0, token, modelSettings: store, quietAgentLog: true, fetch: answering(ANTHROPIC_REPLY) });
  const result = await sidecar.runAgentTool("web_search", { queries: QUERIES }, { requestId: "search", message: "What is the latest AE?", history: [], autoApply: false }, {});
  assert.equal(result.ok, true, JSON.stringify(result));
  return JSON.stringify(toMcpToolResult(result));
}

test("DeepSeek searches on its Anthropic-compatible surface, not its chat base", () => {
  assert.deepEqual(searchBackendFor(DEEPSEEK), { dialect: "anthropic", endpoint: "https://api.deepseek.com/anthropic/v1/messages", apiKey: "k", model: "deepseek-v4-pro" });
});

test("a slot that already speaks the Messages API searches there", () => {
  const slot: SearchSlot = { format: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "k", model: "claude-sonnet-5", service: { id: "anthropic" } };
  assert.deepEqual(searchBackendFor(slot), { dialect: "anthropic", endpoint: "https://api.anthropic.com/v1/messages", apiKey: "k", model: "claude-sonnet-5" });
});

test("OpenAI searches through its Responses API", () => {
  const slot: SearchSlot = { format: "openai-chat", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-5", service: { id: "openai" } };
  assert.deepEqual(searchBackendFor(slot), { dialect: "openai", endpoint: "https://api.openai.com/v1/responses", apiKey: "k", model: "gpt-5" });
});

test("a local runtime offers no search, so the tool is not offered at all", () => {
  assert.equal(searchBackendFor({ format: "openai-chat", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "k", model: "llama3", service: { id: "ollama" } }), undefined);
});

test("no key means no search", () => {
  assert.equal(searchBackendFor({ ...DEEPSEEK, apiKey: undefined }), undefined);
});

test("the web_search tool is named web_search and requires queries", () => {
  assert.deepEqual([webSearchToolSpec().name, webSearchToolSpec().parameters.required], ["web_search", ["queries"]]);
});

test("duplicate queries collapse", () => {
  assert.deepEqual(parseSearchQueries(["a", "a", "b"]), ["a", "b"]);
});

test("an empty list of queries is refused", () => {
  assert.throws(() => parseSearchQueries([]), /at least one query/);
});

test("an Anthropic reply is read into the sources it cited", () => {
  assert.deepEqual(decodeOrThrow(searchReplyDecoder("anthropic", 8), ANTHROPIC_REPLY).sources, [{ title: "CG Channel", url: CG_CHANNEL, pageAge: "November 2025" }]);
});

test("an Anthropic reply counts the searches the provider says it ran", () => {
  assert.equal(decodeOrThrow(searchReplyDecoder("anthropic", 8), ANTHROPIC_REPLY).searched, 2);
});

test("an OpenAI reply is read into the sources its citations name", () => {
  assert.deepEqual(decodeOrThrow(searchReplyDecoder("openai", 8), OPENAI_REPLY).sources, [{ title: "Example", url: "https://example.com/y" }]);
});

test("an OpenAI reply counts its search calls", () => {
  assert.equal(decodeOrThrow(searchReplyDecoder("openai", 8), OPENAI_REPLY).searched, 1);
});

test("the search goes where the configured base says, not to a pinned host", async () => {
  assert.equal((await searchedOnDeepseek()).seen[0]?.url, "https://api.deepseek.com/anthropic/v1/messages");
});

test("the search is sent with the configured key", async () => {
  assert.equal((await searchedOnDeepseek()).seen[0]?.headers["x-api-key"], "sk-derived");
});

test("the search runs on the model the reader chose", async () => {
  assert.equal(textOf(parseJson((await searchedOnDeepseek()).seen[0]?.body ?? ""), "model"), "deepseek-v4-pro");
});

test("the model is handed the url to cite", async () => {
  const { outcome } = await searchedOnDeepseek();
  assert.ok(outcome.ok);
  assert.match(formatWebSearch(outcome), /https:\/\/www\.cgchannel\.com\/2025\/11\/ae-25-6/);
});

test("a search that names no source fails loudly instead of passing the provider's guess on", async () => {
  const backend = { dialect: "openai", endpoint: "https://api.openai.com/v1/responses", apiKey: "k", model: "gpt-5" } as const;
  const silent = await searchWeb({ backend, queries: QUERIES }, answering(SILENT_REPLY));
  assert.deepEqual(silent, { ok: false, code: "SEARCH_NO_RESULTS", message: "The search provider returned no sources for that query." });
});

test("an in-panel web_search hands the model the url it may cite", async (t) => {
  assert.match(await handedToTheModel(t), /https:\/\/www\.cgchannel\.com\/2025\/11\/ae-25-6\//);
});

test("an in-panel web_search hands the model the provider's summary marked as its wording", async (t) => {
  assert.match(await handedToTheModel(t), /Provider summary/);
});
