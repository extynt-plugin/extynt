/** Model-aware reasoning controls on the Messages API, and the failures a step must name instead of hiding. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeOrThrow } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import { extractReasoning, effortAtMost } from "../src/index.js";
import { createAnthropicProvider } from "../src/anthropic.js";
import { anthropicCapabilities, anthropicMaxTokens, anthropicReasoningParams } from "../src/anthropic-reasoning.js";
import { anthropicModelEntryShape } from "../src/anthropic-wire.js";
import { captureRequest, messageAt, nextReply, requestAt, stepOnce, type CapturedRequest } from "./wire-fixtures.js";

const secretSource = { authSource: "server-environment" as const, resolve: () => "anthropic-secret" };

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

interface EntryOptions {
  efforts?: string[];
  adaptive?: boolean;
  images?: boolean;
  maxTokens?: number;
}

function entry(options: EntryOptions): JsonObject {
  const efforts = options.efforts ?? [];
  const adaptive = options.adaptive ?? false;
  return {
    id: "claude-model",
    max_tokens: options.maxTokens ?? 128_000,
    max_input_tokens: 1_000_000,
    capabilities: {
      image_input: { supported: options.images ?? true },
      effort: { supported: efforts.length > 0, ...Object.fromEntries(EFFORT_LEVELS.map((level) => [level, { supported: efforts.includes(level) }])) },
      thinking: { supported: adaptive, types: { enabled: { supported: false }, adaptive: { supported: adaptive } } },
    },
  };
}

function capabilitiesOf(options: EntryOptions): ReturnType<typeof anthropicCapabilities> {
  return anthropicCapabilities(decodeOrThrow(anthropicModelEntryShape, entry(options)));
}

test("each model gets only the reasoning controls its own Models API entry reports", () => {
  const noEffort = capabilitiesOf({ maxTokens: 64_000 });
  assert.deepEqual(noEffort.efforts, [], "a model that reports no effort is never sent one");
  assert.deepEqual(anthropicReasoningParams(noEffort, "high"), {});
  const noXhigh = capabilitiesOf({ efforts: ["low", "medium", "high", "max"], adaptive: true });
  assert.deepEqual(anthropicReasoningParams(noXhigh, "xhigh"), { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "max" } }, "an unreported level becomes the nearest one above it, never silently less thinking");
  assert.deepEqual(anthropicReasoningParams(capabilitiesOf({ efforts: ["low", "medium", "high"], adaptive: true }), "max"), { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" } }, "with nothing above, the strongest level the model has");
  assert.deepEqual(anthropicReasoningParams(noXhigh, "none"), { output_config: { effort: "low" } }, "none never disables thinking on a model that thinks");
  const full = capabilitiesOf({ efforts: ["low", "medium", "high", "xhigh", "max"], adaptive: true, images: false });
  assert.equal(full.images, false, "image input is the model's own answer");
  assert.deepEqual(anthropicReasoningParams(full, "max"), { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "max" } });
  assert.deepEqual(anthropicReasoningParams({ ...full, thinkingDisplay: false }, "low"), { thinking: { type: "adaptive" }, output_config: { effort: "low" } }, "a refused display is not sent again");
  assert.deepEqual(anthropicReasoningParams({}, "none"), { thinking: { type: "disabled" } }, "a model nothing reported on gets the request this adapter always sent");
  assert.deepEqual(anthropicReasoningParams({}, "high"), { output_config: { effort: "high" } });

  assert.equal(anthropicMaxTokens(full, undefined), full.maxOutputTokens, "no setting: the model's own maximum output");
  assert.equal(anthropicMaxTokens(noEffort, undefined), 64_000, "whatever the model reports, not a floor");
  assert.equal(anthropicMaxTokens({ adaptiveThinking: true }, undefined), 64_000, "a thinking model that reports no maximum gets the thinking ceiling");
  assert.equal(anthropicMaxTokens({}, undefined), 8_192, "the field is required, so an unreported model gets a conventional value");
  assert.equal(anthropicMaxTokens({ ...full, maxOutputTokens: 32_000 }, 100_000), 32_000, "a setting never goes above the model's own output ceiling");
  assert.equal(anthropicMaxTokens(full, 20_000), 20_000, "an explicit setting below the maximum is kept");

  assert.equal(effortAtMost("max", "medium"), "medium");
  assert.equal(effortAtMost("low", "medium"), "low");
  assert.equal(effortAtMost(undefined, "medium"), undefined);
});

test("the adapter asks the Models API about its model, and a refusal teaches it what the model does not take", async () => {
  const bodies: CapturedRequest[] = [];
  const urls: string[] = [];
  const replies: Array<() => Response> = [
    () => new Response(JSON.stringify(entry({ efforts: ["low", "medium", "high"], adaptive: true })), { status: 200 }),
    () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "thinking.display: Extra inputs are not permitted" } }), { status: 400 }),
    () => new Response(JSON.stringify({ content: [{ type: "text", text: "OK." }], stop_reason: "end_turn" }), { status: 200 }),
  ];
  const provider = createAnthropicProvider({ secretSource, model: "claude-model", fetch: (async (input, init) => { urls.push(String(input)); if (init?.body) bodies.push(captureRequest(String(init.body))); return nextReply(replies); }) });
  await provider.discoverCapabilities();
  assert.match(urls[0] ?? "", /\/models\/claude-model$/);
  assert.deepEqual(provider.capabilities.current.efforts, ["low", "medium", "high"]);
  const reply = await provider.step({ requestId: "learn", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [], reasoningEffort: "max" });
  assert.equal(reply.text, "OK.");
  assert.deepEqual(requestAt(bodies, 0).output_config, { effort: "high" }, "max is sent as the strongest level the model reported");
  assert.deepEqual(requestAt(bodies, 1).thinking, { type: "adaptive" }, "the retry drops only the field the API refused");
  assert.equal(provider.capabilities.current.thinkingDisplay, false);
});

test("a model that reports no image input is told a frame was withheld instead of being sent it", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = createAnthropicProvider({ secretSource, capabilities: { images: false }, fetch: (async (_input, init) => { bodies.push(captureRequest(String(init?.body))); return new Response(JSON.stringify({ content: [{ type: "text", text: "No frame." }], stop_reason: "end_turn" }), { status: 200 }); }) });
  await provider.step({ requestId: "img", system: "Brief.", messages: [{ role: "user", content: "look" }], tools: [], image: { mediaType: "image/png", base64: "iVBORw0KGgo=" } });
  const sent = JSON.stringify(requestAt(bodies, 0).messages);
  assert.equal(sent.includes("\"type\":\"image\""), false);
  assert.match(sent, /frame was not sent/);
});

test("a refused thinking replay is retried once without thinking blocks, and later steps stop sending them", async () => {
  const bodies: CapturedRequest[] = [];
  const replies: Array<() => Response> = [
    () => new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "plan", signature: "sig-1" }, { type: "tool_use", id: "toolu_1", name: "ae_status", input: {} }], stop_reason: "tool_use" }), { status: 200 }),
    () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation." } }), { status: 400 }),
    () => new Response(JSON.stringify({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }), { status: 200 }),
    () => new Response(JSON.stringify({ content: [{ type: "text", text: "Again." }], stop_reason: "end_turn" }), { status: 200 }),
  ];
  const provider = createAnthropicProvider({ secretSource, model: "claude-opus-5-5", fetch: (async (_input, init) => { bodies.push(captureRequest(String(init?.body))); return nextReply(replies); }) });
  const tools = [{ name: "ae_status", description: "Status.", parameters: { type: "object" } }];
  const first = await provider.step({ requestId: "bind-1", system: "Brief.", messages: [{ role: "user", content: "status?" }], tools });
  const history = [{ role: "user" as const, content: "status?" }, { role: "assistant" as const, content: first.text, toolCalls: first.toolCalls, raw: first.raw }, { role: "tool" as const, toolCallId: "toolu_1", name: "ae_status", content: "{}" }];
  const second = await provider.step({ requestId: "bind-2", system: "Brief, with a clock that moved.", messages: history, tools });
  assert.equal(second.text, "Done.", "the step recovers instead of failing the turn");
  assert.equal(bodies.length, 3);
  assert.equal(JSON.stringify(messageAt(requestAt(bodies, 1), 1).content).includes("sig-1"), true, "the first attempt replayed the signed block");
  assert.deepEqual(messageAt(requestAt(bodies, 2), 1).content, [{ type: "tool_use", id: "toolu_1", name: "ae_status", input: {} }], "the retry keeps the tool call and drops the thinking");
  await provider.step({ requestId: "bind-3", system: "Brief, later still.", messages: history, tools });
  assert.equal(bodies.length, 4, "a later step does not spend a refused request first");
  assert.equal(JSON.stringify(requestAt(bodies, 3).messages).includes("sig-1"), false);
});

test("a refused request names the API's own reason, and a stream that fails mid-reply is a failure", async () => {
  const overloaded = createAnthropicProvider({ secretSource, fetch: (async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 })) });
  await assert.rejects(() => stepOnce(overloaded), /HTTP 529: overloaded_error: Overloaded/);
  const plain = createAnthropicProvider({ secretSource, fetch: (async () => new Response("<html>bad gateway</html>", { status: 502 })) });
  await assert.rejects(() => stepOnce(plain), /HTTP 502: <html>bad gateway<\/html>/);

  const sse = [
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "{\"role\":\"mot" } })}`,
    `data: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}`,
    "",
  ].join("\n\n");
  const streaming = createAnthropicProvider({ secretSource, fetch: (async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) });
  await assert.rejects(() => streaming.step({ requestId: "stream-error", system: "Brief.", messages: [{ role: "user", content: "consult" }], tools: [], forceStream: true }), /stream failed: overloaded_error: Overloaded/, "the partial text is not handed back as an answer");
});

test("reasoning is read from the Messages adapter's own blocks", () => {
  assert.equal(extractReasoning([{ type: "thinking", thinking: "weigh the options", signature: "s" }, { type: "text", text: "answer" }]), "weigh the options");
  assert.equal(extractReasoning({ content: [{ type: "thinking", thinking: "a whole message", signature: "s" }] }), "a whole message");
  assert.equal(extractReasoning({ reasoning_content: "deepseek" }), "deepseek");
});

test("an Anthropic stream cut off before message_stop is not an answer: the ordinary request is used", async () => {
  const cut = [
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "The plan is" } })}`,
    "",
  ].join("\n\n");
  const bodies: CapturedRequest[] = [];
  const provider = createAnthropicProvider({
    secretSource,
    fetch: (async (_input, init) => {
      bodies.push(captureRequest(String(init?.body)));
      if (bodies.length === 1) return new Response(cut, { status: 200, headers: { "content-type": "text/event-stream" } });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "The plan is to fade the layer." }], stop_reason: "end_turn" }), { status: 200 });
    }),
  });
  const step = await provider.step({ requestId: "cut", system: "Brief.", messages: [{ role: "user", content: "consult" }], tools: [], forceStream: true });

  assert.equal(step.text, "The plan is to fade the layer.");
  assert.equal(bodies.length, 2, "the cut stream is followed by one ordinary request");
  assert.equal(requestAt(bodies, 0).stream, true);
  assert.equal("stream" in requestAt(bodies, 1), false);
});
