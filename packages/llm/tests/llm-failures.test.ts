/** Provider failures: truncation stop reasons, empty replies, and step timeouts. */
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot } from "@extynt/project-graph";
import { createLocalSecretInput, selectProjectContext } from "../src/index.js";
import { AGENT_STEP_TIMEOUT_FLOOR_MS } from "../src/provider-stall.js";
import { createAnthropicProvider } from "../src/anthropic.js";
import { createDeepSeekFlashProvider, OpenAICompatibleProvider } from "../src/openai.js";
import { staticReply } from "./wire-fixtures.js";

const context = selectProjectContext(representativeSnapshot).context;

test("an Anthropic step with no text and no tool calls is a provider failure, not an empty answer", async () => {
  const provider = createAnthropicProvider({
    secretSource: { authSource: "server-environment", resolve: () => "anthropic-secret" },
    fetch: staticReply({ id: "msg_refusal", content: [], stop_reason: "refusal" }),
  });
  await assert.rejects(
    provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "fade it" }], tools: [] }),
    /no text or tool calls/,
  );
});

test("an OpenAI-compatible step with null content and no tool calls is a provider failure", async () => {
  const provider = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
    fetch: (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "content_filter", message: { role: "assistant", content: null } }] }), { status: 200 })),
  });
  await assert.rejects(
    provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [] }),
    /no text or tool calls/,
  );
});

test("an Anthropic step reports a max_tokens stop as a failure instead of the finished answer", async () => {
  const provider = createAnthropicProvider({
    secretSource: { authSource: "server-environment", resolve: () => "anthropic-secret" },
    fetch: (async () => new Response(JSON.stringify({ id: "msg_truncated", content: [{ type: "text", text: "The plan is to fade the layer and then" }], stop_reason: "max_tokens" }), { status: 200 })),
  });
  await assert.rejects(
    provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "fade it" }], tools: [] }),
    /max_tokens/,
  );
});

test("an OpenAI-compatible step reports a length stop as a failure instead of the finished answer", async () => {
  const provider = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
    fetch: staticReply({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "The plan is to fade the layer and then" } }] }),
  });
  await assert.rejects(
    provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "fade it" }], tools: [] }),
    /length/,
  );
});

test("an Anthropic complete() reports a max_tokens stop as a failure instead of the finished answer", async () => {
  const provider = createAnthropicProvider({
    secretSource: { authSource: "server-environment", resolve: () => "anthropic-secret" },
    fetch: (async () => new Response(JSON.stringify({ id: "msg_truncated", content: [{ type: "text", text: "The plan is to fade the layer and then" }], stop_reason: "max_tokens", usage: { input_tokens: 100, output_tokens: 4_096 } }), { status: 200 })),
  });
  await assert.rejects(
    provider.complete({ requestId: "anthropic-truncated", systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context }),
    /max_tokens/,
  );
});

test("an OpenAI-compatible complete() reports a length stop as a failure instead of the finished answer", async () => {
  const provider = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
    fetch: staticReply({ choices: [{ finish_reason: "length", message: { role: "assistant", content: "The plan is to fade the layer and then" } }] }),
  });
  await assert.rejects(
    provider.complete({ requestId: "deepseek-truncated", systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context }),
    /length/,
  );
});

test("a truncated complete() with no text at all reports the truncation, not an empty answer", async () => {
  const anthropicEmpty = createAnthropicProvider({
    secretSource: { authSource: "server-environment", resolve: () => "anthropic-secret" },
    fetch: (async () => new Response(JSON.stringify({ id: "msg_cut", content: [], stop_reason: "max_tokens" }), { status: 200 })),
  });
  await assert.rejects(
    anthropicEmpty.complete({ requestId: "anthropic-cut", systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context }),
    /max_tokens/,
  );
  const compatibleEmpty = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
    fetch: (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { role: "assistant", content: null } }] }), { status: 200 })),
  });
  await assert.rejects(
    compatibleEmpty.complete({ requestId: "deepseek-cut", systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context }),
    /length/,
  );
  const anthropicEmptyStop = createAnthropicProvider({
    secretSource: { authSource: "server-environment", resolve: () => "anthropic-secret" },
    fetch: staticReply({ id: "msg_refusal", content: [], stop_reason: "refusal" }),
  });
  await assert.rejects(
    anthropicEmptyStop.complete({ requestId: "anthropic-refusal", systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context }),
    /no text output/,
  );
});

test("one agent step outlives the completion timeout, which a one-shot completion does not", async () => {
  assert.ok(AGENT_STEP_TIMEOUT_FLOOR_MS >= 300_000, `the floor must leave room for a long plan, got ${AGENT_STEP_TIMEOUT_FLOOR_MS}`);
  const slow: typeof fetch = async (_input, init) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 150);
      init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); });
    });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "A whole plan." } }] }), { status: 200 });
  };
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input" },
    requestTimeoutMs: 40,
    fetch: slow,
  });
  const reply = await provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "plan" }], tools: [] });
  assert.equal(reply.text, "A whole plan.");
  await assert.rejects(provider.complete({ requestId: "c", systemInstructions: "Answer.", userMessage: "Summarize.", history: [], context }));
});
