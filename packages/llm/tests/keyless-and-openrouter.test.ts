/** A server that needs no key is sent no credential header, and every OpenRouter request denies data collection. */
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { createLocalSecretInput, type SecretSource } from "../src/index.js";
import { AnthropicProvider } from "../src/anthropic.js";
import { OpenAICompatibleProvider } from "../src/openai.js";
import { isOpenRouterEndpoint, withOpenRouterDeny } from "../src/openai-compatible-capabilities.js";
import { captureJson } from "./wire-fixtures.js";

interface Seen { url: string; headers: Record<string, string>; body: JsonObject }

function recorder(seen: Seen[], reply: JsonValue): typeof fetch {
  const handler: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => { headers[name] = value; });
    seen.push({ url: String(input), headers, body: captureJson(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return handler;
}

function seenAt(seen: Seen[], index: number): Seen {
  const request = seen[index];
  if (!request) throw new Error(`No request was recorded at position ${index}.`);
  return request;
}

const keyless: SecretSource = { authSource: "server-environment", resolve: () => undefined, keyless: true };
const chatReply = { choices: [{ message: { role: "assistant", content: "pong" }, finish_reason: "stop" }] };
const input = { requestId: "r", system: "Brief.", messages: [{ role: "user" as const, content: "ping" }], tools: [{ name: "ae_status", description: "Read status", parameters: { type: "object" } }] };

test("a keyless OpenAI-compatible server is sent no Authorization header on any request", async () => {
  const seen: Seen[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: keyless,
    config: { id: "ollama-chat", endpoint: "http://127.0.0.1:11434/v1", model: "qwen2.5:1.5b", authSource: "server-environment" },
    fetch: recorder(seen, chatReply),
  });
  await provider.step(input);
  await provider.discoverCapabilities();
  assert.ok(seen.length >= 2);
  for (const request of seen) assert.equal("authorization" in request.headers, false, `${request.url} carried an Authorization header`);
  assert.equal(provider.displayMetadata.keyConfigured, true, "a keyless server is ready to use");
});

test("a keyless Anthropic-compatible server is sent no x-api-key header", async () => {
  const seen: Seen[] = [];
  const provider = new AnthropicProvider({
    secretSource: keyless,
    endpoint: "http://127.0.0.1:4310/v1",
    model: "local-model",
    config: { id: "custom-anthropic-messages", displayName: "local", contextWindow: 100_000 },
    fetch: recorder(seen, { content: [{ type: "text", text: "pong" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  await provider.step({ ...input, tools: [] });
  assert.equal(seen.length, 1);
  assert.equal("x-api-key" in seenAt(seen, 0).headers, false);
});

test("a provider that needs a key still refuses to send without one", async () => {
  const provider = new OpenAICompatibleProvider({
    secretSource: { authSource: "server-environment", resolve: () => undefined },
    config: { id: "openai-chat", endpoint: "http://127.0.0.1:4310", model: "m", authSource: "server-environment" },
    fetch: recorder([], chatReply),
  });
  await assert.rejects(provider.step(input), /secret is unavailable/);
});

test("OpenRouter requests carry provider.data_collection deny, on the Auto path and on a plain model", async () => {
  for (const model of ["openrouter/auto", "vendor/model"]) {
    const seen: Seen[] = [];
    const provider = new OpenAICompatibleProvider({
      secretSource: createLocalSecretInput("router-secret"),
      config: { id: "openrouter-chat", endpoint: "http://127.0.0.1:4310", model, authSource: "local-secret-input" },
      fetch: recorder(seen, chatReply),
    });
    await provider.step(input);
    await provider.step({ ...input, tools: [] });
    assert.deepEqual(seen.map((request) => request.body.provider), [{ data_collection: "deny" }, { data_collection: "deny" }], model);
  }
});

test("a provider that is not OpenRouter is sent no provider field", async () => {
  const seen: Seen[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config: { id: "openai-chat", endpoint: "http://127.0.0.1:4310", model: "gpt-5", authSource: "local-secret-input" },
    fetch: recorder(seen, chatReply),
  });
  await provider.step(input);
  assert.equal("provider" in seenAt(seen, 0).body, false);
});

test("the deny setting is merged into an existing provider object and never replaces its other fields", () => {
  const merged = withOpenRouterDeny(true, { model: "m", provider: { order: ["anthropic"], allow_fallbacks: false, data_collection: "allow" } });
  assert.deepEqual(merged.provider, { order: ["anthropic"], allow_fallbacks: false, data_collection: "deny" });
  const untouched = { model: "m", provider: { order: ["x"] } };
  assert.equal(withOpenRouterDeny(false, untouched), untouched);
});

test("an openrouter.ai address counts as OpenRouter even behind a custom service", () => {
  assert.equal(isOpenRouterEndpoint("custom-chat", "https://openrouter.ai/api/v1"), true);
  assert.equal(isOpenRouterEndpoint("custom-chat", "https://example.com/v1"), false);
  assert.equal(isOpenRouterEndpoint("custom-chat", "not a url"), false);
});
