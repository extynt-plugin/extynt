/** Compatible-provider capability discovery, refusal learning and Responses replay. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeOrThrow, object, optional, string } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { createLocalSecretInput, type AgentStepInput } from "../src/index.js";
import { OpenAICompatibleProvider } from "../src/openai.js";
import { responsesStepBody, responsesStepResult } from "../src/openai-responses-wire.js";
import { captureJson, captureRequest, nextReply, requestAt, stepOnce, type CapturedRequest } from "./wire-fixtures.js";

function itemTypes(items: JsonValue | undefined): Array<string | undefined> {
  return decodeOrThrow(array(object({ type: optional(string()) })), items).map((item) => item.type);
}

test("an OpenAI-compatible model teaches the adapter what it does not take, one refusal at a time", async () => {
  const bodies: CapturedRequest[] = [];
  const replies: Array<() => Response> = [
    () => new Response(JSON.stringify({ error: { message: "Unrecognized request argument supplied: thinking", type: "invalid_request_error", param: null } }), { status: 400 }),
    () => new Response(JSON.stringify({ error: { message: "Unsupported value: 'reasoning_effort' does not support 'max' with this model. Supported values are: 'low', 'medium', and 'high'.", type: "invalid_request_error", param: "reasoning_effort", code: "unsupported_value" } }), { status: 400 }),
    () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }), { status: 200 }),
    () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Again" } }] }), { status: 200 }),
  ];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("openai-secret"),
    config: { id: "custom-chat", endpoint: "http://127.0.0.1:4310", model: "gpt-model", authSource: "local-secret-input", reasoningEffort: "max" },
    fetch: (async (_input, init) => { bodies.push(captureRequest(String(init?.body))); return nextReply(replies); }),
  });
  assert.equal((await stepOnce(provider)).text, "OK");
  assert.deepEqual(requestAt(bodies, 0).thinking, { type: "enabled" });
  assert.equal("thinking" in requestAt(bodies, 1), false, "the refused field is dropped");
  assert.equal(requestAt(bodies, 2).reasoning_effort, "high", "the effort becomes the strongest level the model named");
  assert.deepEqual(provider.capabilities.current.efforts, ["low", "medium", "high"]);
  await stepOnce(provider);
  assert.equal(bodies.length, 4, "a later step is built from what was learned, without a refused request first");
  assert.equal(requestAt(bodies, 3).reasoning_effort, "high");
});

test("OpenAI retries function tools without reasoning effort when Chat Completions rejects their combination", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("openai-secret"),
    config: { id: "openai-chat", endpoint: "http://127.0.0.1:4310", model: "gpt-test", authSource: "local-secret-input", reasoningEffort: "medium" },
    fetch: (async (_input, init) => {
      const body = captureRequest(String(init?.body));
      bodies.push(body);
      return new Response(body.reasoning_effort !== "none" && body.tools.length
        ? JSON.stringify({ error: { message: "Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to none." } })
        : JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }), { status: body.reasoning_effort !== "none" && body.tools.length ? 400 : 200 });
    }),
  });
  const input: AgentStepInput = { requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [{ name: "ae_status", description: "status", parameters: { type: "object" } }] };
  assert.equal((await provider.step(input)).text, "OK");
  assert.equal(bodies.length, 2);
  assert.equal(requestAt(bodies, 0).reasoning_effort, "medium");
  assert.equal("thinking" in requestAt(bodies, 0), false);
  assert.equal(requestAt(bodies, 1).reasoning_effort, "none");
  await provider.step(input);
  assert.equal(bodies.length, 3, "later tool steps use the learned request shape immediately");
  assert.equal(requestAt(bodies, 2).reasoning_effort, "none");
  await stepOnce(provider);
  assert.equal(requestAt(bodies, 3).reasoning_effort, "medium", "the refusal applies only to steps with tools");
});

test("effort discovery probes the selected model with tools and caches only accepted levels", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("test-secret"),
    config: { id: "openai-chat", endpoint: "http://127.0.0.1:4310", model: "gpt-test", authSource: "local-secret-input" },
    fetch: (async (_input, init) => {
      const body = captureRequest(String(init?.body));
      bodies.push(body);
      const accepted = body.reasoning_effort === "none" || body.reasoning_effort === "low";
      return new Response(accepted ? JSON.stringify({ choices: [{ message: { content: "OK" } }] }) : JSON.stringify({ error: { message: "reasoning_effort is not supported with tools" } }), { status: accepted ? 200 : 400 });
    }),
  });
  assert.deepEqual(await provider.discoverEfforts(), ["none", "low"]);
  assert.deepEqual(provider.capabilities.current.efforts, ["none", "low"]);
  assert.equal(bodies.length, 7);
  assert.ok(bodies.every((body) => body.tools.length === 1));
  assert.deepEqual(await provider.discoverEfforts(), ["none", "low"]);
  assert.equal(bodies.length, 7, "opening the picker again does not bill seven more probes");
});

test("GPT-6 Sol uses Responses for reasoning with function tools and replays calls", async () => {
  const bodies: JsonObject[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("test-secret"),
    config: { id: "openai-chat", endpoint: "http://127.0.0.1:4310", model: "gpt-6-sol", authSource: "local-secret-input", reasoningEffort: "high" },
    fetch: (async (url, init) => {
      assert.equal(String(url), "http://127.0.0.1:4310/responses");
      bodies.push(captureJson(String(init?.body)));
      const output = bodies.length === 1
        ? [{ type: "function_call", call_id: "call_1", name: "ping", arguments: "{}" }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }];
      return new Response(JSON.stringify({ status: "completed", output }), { status: 200 });
    }),
  });
  const input: AgentStepInput = { requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [{ name: "ping", description: "ping", parameters: { type: "object", properties: {} } }] };
  const first = await provider.step(input);
  assert.equal(first.toolCalls[0]?.name, "ping");
  assert.deepEqual(bodies[0]?.reasoning, { effort: "high" });
  assert.deepEqual(bodies[0]?.include, ["reasoning.encrypted_content"]);
  const second = await provider.step({ ...input, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "", toolCalls: first.toolCalls, raw: first.raw }, { role: "tool", toolCallId: "call_1", name: "ping", content: "ok" }] });
  assert.equal(second.text, "Done.");
  assert.deepEqual(itemTypes(bodies[1]?.input).slice(-2), ["function_call", "function_call_output"]);
});

test("DeepSeek effort discovery uses distinct levels from its live model row", async () => {
  const requests: string[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("test-secret"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input", reasoningEffort: "medium" },
    fetch: (async (input, init) => {
      requests.push(String(input));
      if (init?.method === "POST") {
        assert.equal(captureRequest(String(init.body)).reasoning_effort, "high", "the old medium alias maps to the advertised high level");
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ id: "deepseek-flash", effort: { supported_levels: ["low", "high", "max"], default_level: "high" } }] }), { status: 200 });
    }),
  });
  assert.deepEqual(await provider.discoverEfforts(), ["low", "high", "max"]);
  assert.deepEqual(requests, ["http://127.0.0.1:4310/models"]);
  await stepOnce(provider);
});

test("a refusal about something else is the step's failure, with the provider's own reason", async () => {
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "m", authSource: "local-secret-input", reasoningEffort: "high" },
    fetch: (async () => new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 })),
  });
  await assert.rejects(() => stepOnce(provider), /HTTP 402: Insufficient Balance/);
});

test("a model list that says what a model takes is read for it; one that names only ids leaves it unreported", async () => {
  const listed = (data: JsonValue[]) => new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("k"),
    config: { id: "openrouter-chat", endpoint: "http://127.0.0.1:4310", model: "vendor/model", authSource: "local-secret-input" },
    fetch: (async () => new Response(JSON.stringify({ data }), { status: 200 })),
  });
  const vision = listed([{ id: "vendor/model", context_length: 256_000, architecture: { input_modalities: ["text", "image"] } }]);
  await vision.discoverCapabilities();
  assert.equal(vision.capabilities.current.images, true);
  assert.equal(vision.capabilities.current.contextWindow, 256_000);
  const textOnly = listed([{ id: "vendor/model", input_modalities: ["text"] }]);
  await textOnly.discoverCapabilities();
  assert.equal(textOnly.capabilities.current.images, false);
  const bare = listed([{ id: "vendor/model", object: "model" }]);
  await bare.discoverCapabilities();
  assert.deepEqual(bare.capabilities.current, {}, "a bare list reports nothing, so the model is asked by its first request");
});

const pingTool = { name: "ping", description: "ping", parameters: { type: "object", properties: {} } };
const responsesInput = (messages: AgentStepInput["messages"], extra: Partial<AgentStepInput> = {}): AgentStepInput => ({ requestId: "r", system: "Brief.", messages, tools: [pingTool], ...extra });
const wireOptions = { model: "gpt-6-sol", acceptsImages: true, observedImages: undefined, reasoningEffort: undefined, maxTokens: undefined } as const;

test("Responses keeps the screenshot on the last user message after tool results", () => {
  const image = { mediaType: "image/png", base64: "AAAA" };
  const calls = [{ id: "call_1", name: "ping", arguments: {} }];
  const messages: AgentStepInput["messages"] = [{ role: "user", content: "look" }, { role: "assistant", content: "", toolCalls: calls }, { role: "tool", toolCallId: "call_1", name: "ping", content: "ok" }];
  const wire = responsesStepBody(responsesInput(messages, { image }), wireOptions).input;
  assert.equal(wire.at(-1)?.type, "function_call_output");
  assert.deepEqual(wire[0]?.content, [{ type: "input_text", text: "look" }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }]);
  const withheld = responsesStepBody(responsesInput(messages, { image }), { ...wireOptions, acceptsImages: false });
  assert.match(String(withheld.input[0]?.content), /^look\n\n/);
});

test("Responses reports usage in the step usage shape, cached tokens included", () => {
  const usage = { input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 80 } };
  assert.deepEqual(responsesStepResult({ usage }).usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 80 });
  assert.equal("usage" in responsesStepResult({}), false, "a reply without usage reports none");
});

test("Responses clamps a stale effort to the levels the model reported", () => {
  const input = responsesInput([{ role: "user", content: "hi" }]);
  assert.deepEqual(responsesStepBody(input, { ...wireOptions, reasoningEffort: "max", efforts: ["low", "medium", "high"] }).reasoning, { effort: "high" });
  assert.deepEqual(responsesStepBody(input, { ...wireOptions, reasoningEffort: "none", efforts: ["low", "high"] }).reasoning, { effort: "low" });
  assert.deepEqual(responsesStepBody(input, { ...wireOptions, reasoningEffort: "max" }).reasoning, { effort: "max" }, "an unreported list sends the request as it is");
  assert.equal("reasoning" in responsesStepBody(input, { ...wireOptions, reasoningEffort: "high", efforts: [] }), false, "a model with no effort control gets none");
});

test("Responses never sends an orphan function_call_output", () => {
  const calls = [{ id: "call_1", name: "ping", arguments: { a: 1 } }];
  const rebuilt = responsesStepBody(responsesInput([{ role: "user", content: "hi" }, { role: "assistant", content: "", toolCalls: calls }, { role: "tool", toolCallId: "call_1", name: "ping", content: "ok" }]), wireOptions).input;
  assert.deepEqual(rebuilt.slice(1), [{ type: "function_call", call_id: "call_1", name: "ping", arguments: "{\"a\":1}" }, { type: "function_call_output", call_id: "call_1", output: "ok" }]);
  const orphan = responsesStepBody(responsesInput([{ role: "user", content: "hi" }, { role: "assistant", content: "thinking" }, { role: "tool", toolCallId: "gone", name: "ping", content: "ok" }]), wireOptions).input;
  assert.ok(orphan.every((row) => row.type !== "function_call_output"));
  assert.match(String(orphan.at(-1)?.content), /ok/);
});
