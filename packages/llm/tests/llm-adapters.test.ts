// Native request and response mapping of each adapter through complete(), and the credentials each one keeps out of the body.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot } from "@extynt/project-graph";
import { createLocalSecretInput, selectProjectContext } from "../src/index.js";
import { createAnthropicProvider } from "../src/anthropic.js";
import { createDeepSeekFlashProvider, createOpenAIResponsesProvider } from "../src/openai.js";
import { captureRequest, recordingResponder, serverSecret, type CapturedRequest } from "./wire-fixtures.js";

const context = selectProjectContext(representativeSnapshot).context;

function ask(requestId: string) {
  return { requestId, systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context };
}

test("OpenAI Responses adapter uses a server secret source and never puts the key in JSON", async () => {
  let capturedInit: RequestInit | undefined;
  const provider = createOpenAIResponsesProvider({
    model: "test-model",
    environment: { OPENAI_API_KEY: "server-secret" },
    fetch: async (_input, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ id: "resp_1", output_text: "Hello from test adapter." }), { status: 200, headers: { "x-request-id": "req_1" } });
    },
  });
  const completion = await provider.complete(ask("openai-1"));
  assert.equal(completion.answer, "Hello from test adapter.");
  assert.equal(completion.providerRequestId, "req_1");
  assert.equal(new Headers(capturedInit?.headers).get("Authorization"), "Bearer server-secret");
  assert.equal(String(capturedInit?.body).includes("server-secret"), false);
});

test("Anthropic adapter maps native Messages request and response", async () => {
  let capturedBody = "";
  const provider = createAnthropicProvider({
    environment: { ANTHROPIC_API_KEY: "anthropic-secret" },
    fetch: async (_input, init) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ id: "msg_1", content: [{ type: "text", text: "Claude fixture answer." }] }), { status: 200, headers: { "request-id": "req_2" } });
    },
  });
  const completion = await provider.complete(ask("anthropic-1"));
  assert.equal(completion.answer, "Claude fixture answer.");
  assert.equal(completion.providerRequestId, "req_2");
  assert.equal(capturedBody.includes('"max_tokens"'), true);
  assert.equal(capturedBody.includes("anthropic-secret"), false);
});

test("DeepSeek Flash profile maps to configurable OpenAI-compatible endpoint/model", async () => {
  let capturedUrl = "";
  let capturedBody = "";
  const secret = createLocalSecretInput("deepseek-secret");
  const provider = createDeepSeekFlashProvider({
    baseUrl: "http://127.0.0.1:4310/v1",
    model: "deepseek-v4-flash",
    secretSource: secret,
    fetch: async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "DeepSeek fixture answer." } }] }), { status: 200 });
    },
  });
  const completion = await provider.complete(ask("deepseek-1"));
  assert.equal(completion.answer, "DeepSeek fixture answer.");
  assert.equal(capturedUrl, "http://127.0.0.1:4310/v1/chat/completions");
  assert.equal(captureRequest(capturedBody).model, "deepseek-v4-flash");
  assert.equal(capturedBody.includes("deepseek-secret"), false);
  assert.equal(provider.displayMetadata.authSource, "local-secret-input");
  secret.replace("rotated-secret");
  assert.equal(provider.displayMetadata.keyConfigured, true);
  secret.clear();
  assert.equal(provider.displayMetadata.keyConfigured, false);
});

test("provider config refuses endpoint credentials and missing keys", () => {
  assert.throws(() => createOpenAIResponsesProvider({ baseUrl: "https://api.example.test/v1?api_key=bad", environment: { OPENAI_API_KEY: "x" } }), /credentials, query strings/);
  const provider = createOpenAIResponsesProvider({ environment: {} });
  assert.equal(provider.displayMetadata.keyConfigured, false);
});

test("Anthropic complete() returns every text block, not only the first", async () => {
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async () => new Response(JSON.stringify({ id: "msg_1", content: [{ type: "text", text: "First half." }, { type: "text", text: "Second half." }] }), { status: 200 }),
  });
  const completion = await provider.complete(ask("anthropic-2"));
  assert.equal(completion.answer, "First half.\nSecond half.");
});

test("Anthropic complete() returns text from a later block when an earlier block is empty", async () => {
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async () => new Response(JSON.stringify({ id: "msg_2", content: [{ type: "text", text: "" }, { type: "text", text: "Real answer." }] }), { status: 200 }),
  });
  const completion = await provider.complete(ask("anthropic-3"));
  assert.equal(completion.answer, "Real answer.");
});

test("complete() still returns a normal multi-block answer and sends max_tokens only when configured", async () => {
  const anthropic = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async () => new Response(JSON.stringify({ id: "msg_done", content: [{ type: "text", text: "First half." }, { type: "text", text: "Second half." }], stop_reason: "end_turn" }), { status: 200 }),
  });
  assert.equal((await anthropic.complete(ask("anthropic-done"))).answer, "First half.\nSecond half.");
  const bodies: CapturedRequest[] = [];
  const responder = recordingResponder(bodies);
  const configured = await createDeepSeekFlashProvider({ environment: { DEEPSEEK_API_KEY: "deepseek-secret" }, maxTokens: 2_048, fetch: responder }).complete(ask("deepseek-configured"));
  assert.equal(configured.answer, "Done.");
  await createDeepSeekFlashProvider({ environment: { DEEPSEEK_API_KEY: "deepseek-secret" }, fetch: responder }).complete(ask("deepseek-default"));
  assert.equal(bodies[0]?.max_tokens, 2_048);
  assert.equal(bodies[1] !== undefined && "max_tokens" in bodies[1], false, "an unconfigured provider keeps the provider's own cap");
});
