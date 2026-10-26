// The OpenAI-compatible chat adapter's tool-calling step: request shape, reasoning controls, token limits, images, usage and replay.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { createLocalSecretInput, type AgentMessage, type AgentStepInput } from "../src/index.js";
import { OpenAICompatibleProvider, createDeepSeekFlashProvider } from "../src/openai.js";
import { validatedReasoningEffort } from "../src/provider-config.js";
import { captureJson, captureRequest, lastRequest, messageAt, recordingReply, recordingResponder, requestAt, stepOnce, type CapturedMessage, type CapturedRequest } from "./wire-fixtures.js";

const chatReply = { choices: [{ message: { role: "assistant", content: "OK" } }] };

function deepSeekFlash(reasoningEffort: "none" | "xhigh" | "high" | undefined, fetch: typeof globalThis.fetch, extra: { maxTokens?: number; acceptsImages?: boolean } = {}) {
  return new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("deepseek-secret"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input", ...(reasoningEffort ? { reasoningEffort } : {}), ...(extra.acceptsImages === undefined ? {} : { acceptsImages: extra.acceptsImages }) },
    ...(extra.maxTokens ? { maxTokens: extra.maxTokens } : {}),
    fetch,
  });
}

function userMessage(request: CapturedRequest): CapturedMessage {
  const message = request.messages.find((candidate) => candidate.role === "user");
  if (!message) throw new Error("The request carries no user message.");
  return message;
}

test("DeepSeek tool-calling step sends function tools, parses tool calls, and replays reasoning_content", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = createDeepSeekFlashProvider({
    baseUrl: "http://127.0.0.1:4310/v1",
    secretSource: createLocalSecretInput("deepseek-secret"),
    fetch: async (_input, init) => {
      bodies.push(captureRequest(String(init?.body)));
      const message = bodies.length === 1
        ? { role: "assistant", content: null, reasoning_content: "thinking", tool_calls: [{ id: "call_1", type: "function", function: { name: "ae_propose_plan", arguments: "{\"summary\":\"Fade\"}" } }, { id: "call_2", type: "function", function: { name: "ae_list_plans", arguments: "not json" } }] }
        : { role: "assistant", content: "Plan ready." };
      return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200 });
    },
  });
  const tools = [{ name: "ae_propose_plan", description: "Propose.", parameters: { type: "object", properties: {} } }];
  const first = await provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "fade it" }], tools });
  assert.deepEqual(first.toolCalls[0], { id: "call_1", name: "ae_propose_plan", arguments: { summary: "Fade" } });
  assert.deepEqual(first.toolCalls[1]?.arguments, {});
  assert.match(first.toolCalls[1]?.argumentsError ?? "", /not valid JSON/, "a malformed call is reported, so the loop refuses it instead of running it with nothing");
  assert.equal(first.usage?.totalTokens, 15);
  assert.equal(requestAt(bodies, 0).tools[0]?.function?.name, "ae_propose_plan");
  assert.equal(messageAt(requestAt(bodies, 0), 0).role, "system");
  const second = await provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "fade it" }, { role: "assistant", content: "", toolCalls: first.toolCalls, raw: first.raw }, { role: "tool", toolCallId: "call_1", name: "ae_propose_plan", content: "{\"data\":{}}" }], tools });
  assert.equal(second.text, "Plan ready.");
  assert.equal(messageAt(requestAt(bodies, 1), 2).reasoning_content, "thinking");
  assert.deepEqual(messageAt(requestAt(bodies, 1), 3), { role: "tool", tool_call_id: "call_1", content: "{\"data\":{}}" });
});

test("OpenRouter Auto offers a tool-capable routing pool when functions are present", async () => {
  const bodies: JsonObject[] = [];
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("router-secret"),
    config: { id: "openrouter-chat", endpoint: "http://127.0.0.1:4310", model: "openrouter/auto", authSource: "local-secret-input" },
    fetch: async (_input, init) => {
      bodies.push(captureJson(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Ready." } }] }), { status: 200 });
    },
  });
  const input = { requestId: "r", system: "Brief.", messages: [{ role: "user" as const, content: "inspect" }], tools: [{ name: "ae_status", description: "Read status", parameters: { type: "object" } }] };
  await provider.step(input);
  assert.deepEqual(bodies[0]?.plugins, [{ id: "auto-router", allowed_models: ["*"] }]);
  await provider.step({ ...input, tools: [] });
  assert.equal(bodies[1]?.plugins, undefined, "plain chat keeps OpenRouter's ordinary routing");
});

test("the thinking controls are chosen together, and the live API's enum is the one enforced", async () => {
  const bodies: CapturedRequest[] = [];
  const build = (effort?: "none" | "xhigh") => deepSeekFlash(effort, recordingReply(bodies, chatReply));

  await stepOnce(build("none"));
  assert.deepEqual(lastRequest(bodies).thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in lastRequest(bodies), false, "a disabled model is not also asked for an effort");

  await stepOnce(build("xhigh"));
  assert.deepEqual(lastRequest(bodies).thinking, { type: "enabled" });
  assert.equal(lastRequest(bodies).reasoning_effort, "xhigh");

  await stepOnce(build());
  assert.equal("thinking" in lastRequest(bodies), false, "an unset effort leaves the provider default alone");
  assert.equal("reasoning_effort" in lastRequest(bodies), false);

  assert.throws(() => validatedReasoningEffort("turbo"), /reasoningEffort/);
});

test("a harness phase can lower reasoning for the compatible adapter without changing provider defaults or completion capacity", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = deepSeekFlash("high", recordingReply(bodies, chatReply));
  await provider.step({ requestId: "phase-openai", system: "Brief.", messages: [{ role: "user", content: "select one stage" }], tools: [], reasoningEffort: "low" });
  assert.equal(requestAt(bodies, 0).reasoning_effort, "low");
  assert.equal(requestAt(bodies, 0).max_tokens, undefined);
  assert.equal(provider.config.reasoningEffort, "high", "the saved provider policy is unchanged for the next phase");
  const invalidStep: AgentStepInput = { requestId: "phase-openai-invalid", system: "Brief.", messages: [{ role: "user", content: "select one stage" }], tools: [] };
  Object.assign(invalidStep, { reasoningEffort: "turbo" });
  await assert.rejects(() => provider.step(invalidStep), /reasoningEffort/, "per-step overrides cross the same runtime validation boundary as saved config");
});

test("an OpenAI-compatible model with no max_tokens setting sends none, and an explicit setting is sent", async () => {
  const chat = async (maxTokens?: number) => {
    const bodies: CapturedRequest[] = [];
    await stepOnce(deepSeekFlash(undefined, recordingReply(bodies, chatReply), maxTokens ? { maxTokens } : {}));
    return requestAt(bodies, 0);
  };
  assert.equal((await chat(384_000)).max_tokens, 384_000);
  assert.equal("max_tokens" in (await chat()), false, "with no setting nothing is sent");
});

test("an attached screenshot rides the last user message, and a model that cannot see one is told it was withheld", async () => {
  const bodies: CapturedRequest[] = [];
  const build = (acceptsImages: boolean) => deepSeekFlash(undefined, recordingReply(bodies, chatReply), { acceptsImages });
  const image = { mediaType: "image/png", base64: "aGVsbG8=" };
  const messages: AgentMessage[] = [
    { role: "user", content: "what is wrong with this frame?" },
    { role: "assistant", content: "looking" },
    { role: "tool", toolCallId: "t1", name: "ae_get_capture_frame", content: "{}" },
  ];
  await build(true).step({ requestId: "r", system: "Brief.", messages, tools: [], image });
  const sent = lastRequest(bodies);
  assert.equal(sent.messages.filter((message) => message.role === "user").length, 1, "the frame does not add a message of its own");
  assert.deepEqual(userMessage(sent).content, [
    { type: "text", text: "what is wrong with this frame?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
  ], "the frame rides the user message the turn is answering");
  await build(false).step({ requestId: "r", system: "Brief.", messages, tools: [], image });
  const withheld = userMessage(lastRequest(bodies)).content;
  assert.equal(typeof withheld, "string", "a model that does not take images is never sent the frame");
  assert.match(String(withheld), /frame was not sent/, "and is told so, rather than answering about a frame it never saw");
});

test("an OpenAI-compatible step reports the cached share of its prompt", async () => {
  const provider = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Done.", role: "assistant" } }], usage: { prompt_tokens: 6100, completion_tokens: 12, total_tokens: 6112, prompt_cache_hit_tokens: 5900 } }), { status: 200 }),
  });
  const result = await stepOnce(provider);
  assert.equal(result.usage?.inputTokens, 6100);
  assert.equal(result.usage?.cachedInputTokens, 5900);
});

test("a step surfaces the provider stop reason and sends max_tokens only when the compatible path is configured with one", async () => {
  const bodies: CapturedRequest[] = [];
  const responder = recordingResponder(bodies);
  const configured = await stepOnce(createDeepSeekFlashProvider({ environment: { DEEPSEEK_API_KEY: "deepseek-secret" }, maxTokens: 2_048, fetch: responder }));
  assert.equal(configured.finishReason, "stop");
  await stepOnce(createDeepSeekFlashProvider({ environment: { DEEPSEEK_API_KEY: "deepseek-secret" }, fetch: responder }));
  assert.equal(requestAt(bodies, 0).max_tokens, 2_048);
  assert.equal("max_tokens" in requestAt(bodies, 1), false, "an unconfigured provider keeps the provider's own cap");
});

test("a replayed assistant message carries exactly the tool calls the adapter reported", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = createDeepSeekFlashProvider({
    environment: { DEEPSEEK_API_KEY: "deepseek-secret" },
    fetch: async (_input, init) => {
      bodies.push(captureRequest(String(init?.body)));
      const message = bodies.length === 1
        ? { role: "assistant", content: null, reasoning_content: "thinking", tool_calls: [{ id: "call_1", type: "function", function: { name: "ae_status", arguments: "{}" } }, { id: "call_2", type: "function", function: { arguments: "{}" } }] }
        : { role: "assistant", content: "done" };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
    },
  });
  const tools = [{ name: "ae_status", description: "status", parameters: { type: "object" } }];
  const first = await provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools });
  assert.deepEqual(first.toolCalls.map((toolCall) => toolCall.id), ["call_1"], "the call without a function name is not reported");
  await provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: first.text, toolCalls: first.toolCalls, raw: first.raw }, { role: "tool", toolCallId: "call_1", name: "ae_status", content: "{}" }], tools });
  const replayed = messageAt(requestAt(bodies, 1), 2);
  assert.deepEqual((replayed.tool_calls ?? []).map((toolCall) => toolCall.id), ["call_1"], "the replayed message must agree with the tool results the loop sent");
  assert.equal(replayed.reasoning_content, "thinking", "provider-specific fields still replay");
});
