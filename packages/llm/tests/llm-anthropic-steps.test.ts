// The Anthropic adapter's tool-calling step: block mapping, streaming, thinking replay, effort levels, caching, token limits and turn coalescing.
import assert from "node:assert/strict";
import test from "node:test";
import { createAnthropicProvider } from "../src/anthropic.js";
import type { ModelCapabilities } from "../src/model-capabilities.js";
import type { ReasoningEffort } from "../src/provider-config.js";
import type { AgentMessage, ChatMessage } from "../src/index.js";
import { representativeSnapshot } from "@extynt/project-graph";
import { selectProjectContext } from "../src/index.js";
import { captureRequest, lastRequest, messageAt, nextReply, recordingReply, requestAt, serverSecret, stepOnce, systemAt, toolAt, type CapturedRequest } from "./wire-fixtures.js";

const context = selectProjectContext(representativeSnapshot).context;
const okReply = { content: [{ type: "text", text: "OK" }] };
const statusTool = { name: "ae_status", description: "status", parameters: { type: "object" } };

test("Anthropic tool-calling step maps tool_use and tool_result blocks", async () => {
  const bodies: CapturedRequest[] = [];
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async (_input, init) => {
      bodies.push(captureRequest(String(init?.body)));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_1", name: "ae_inspect_layer", input: { layerId: "L" } }] }), { status: 200 });
    },
  });
  const messages: AgentMessage[] = [
    { role: "user", content: "a" },
    { role: "assistant", content: "", toolCalls: [{ id: "toolu_0", name: "ae_list_plans", arguments: {} }] },
    { role: "tool", toolCallId: "toolu_0", name: "ae_list_plans", content: "[]" },
    { role: "tool", toolCallId: "toolu_x", name: "ae_list_plans", content: "[]" },
  ];
  const step = await provider.step({ requestId: "r", system: "Brief.", messages, tools: [{ name: "ae_inspect_layer", description: "Inspect.", parameters: { type: "object" } }] });
  assert.equal(step.text, "Checking.");
  assert.deepEqual(step.toolCalls, [{ id: "toolu_1", name: "ae_inspect_layer", arguments: { layerId: "L" } }]);
  const sent = requestAt(bodies, 0);
  assert.deepEqual(sent.messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(messageAt(sent, 2).content?.length, 2, "consecutive tool results share one user turn");
  assert.equal(typeof sent.tools[0]?.input_schema, "object");
});

test("Anthropic forceStream reports cumulative specialist text and reasoning", async () => {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 7 } } },
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "checking" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "First" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: " second" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
    { type: "message_stop" },
  ];
  const sse = [...events.map((event) => `data: ${JSON.stringify(event)}`), ""].join("\n\n");
  const bodies: CapturedRequest[] = [];
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async (_input, init) => {
      bodies.push(captureRequest(String(init?.body)));
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  const deltas: Array<{ text: string; reasoning: string }> = [];
  const step = await provider.step({ requestId: "stream", system: "Brief.", messages: [{ role: "user", content: "consult" }], tools: [], forceStream: true, onDelta: (delta) => deltas.push(delta) });
  assert.equal(requestAt(bodies, 0).stream, true);
  assert.equal(step.text, "First second");
  assert.equal(step.finishReason, "end_turn");
  assert.deepEqual(step.usage, { inputTokens: 7, outputTokens: 4, totalTokens: 11, cachedInputTokens: 0 });
  assert.deepEqual(deltas.at(-1), { text: "First second", reasoning: "checking" });
});

test("Anthropic replays signed and redacted thinking blocks unchanged with tool continuations", async () => {
  const bodies: CapturedRequest[] = [];
  const replies = [
    () => new Response(JSON.stringify({ content: [{ type: "thinking", thinking: "", signature: "signed-empty" }, { type: "redacted_thinking", data: "redacted-payload" }, { type: "tool_use", id: "toolu_signed", name: "ae_list_plans", input: {} }], stop_reason: "tool_use" }), { status: 200 }),
    () => new Response(JSON.stringify({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }), { status: 200 }),
  ];
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async (_input, init) => {
      bodies.push(captureRequest(String(init?.body)));
      return nextReply(replies);
    },
  });
  const first = await provider.step({ requestId: "signed-1", system: "Brief.", messages: [{ role: "user", content: "list" }], tools: [{ name: "ae_list_plans", description: "List.", parameters: { type: "object" } }] });
  await provider.step({ requestId: "signed-2", system: "Brief.", messages: [{ role: "user", content: "list" }, { role: "assistant", content: first.text, toolCalls: first.toolCalls, raw: first.raw }, { role: "tool", toolCallId: "toolu_signed", name: "ae_list_plans", content: "[]" }], tools: [] });
  assert.deepEqual(messageAt(requestAt(bodies, 1), 1).content, [
    { type: "thinking", thinking: "", signature: "signed-empty" },
    { type: "redacted_thinking", data: "redacted-payload" },
    { type: "tool_use", id: "toolu_signed", name: "ae_list_plans", input: {} },
  ]);
});

const adaptiveEfforts: ModelCapabilities = { adaptiveThinking: true, efforts: ["low", "medium", "high", "xhigh", "max"] };

function effortProvider(bodies: CapturedRequest[], reasoningEffort: ReasoningEffort | undefined, capabilities?: ModelCapabilities) {
  return createAnthropicProvider({
    secretSource: serverSecret,
    config: reasoningEffort ? { reasoningEffort } : {},
    ...(capabilities ? { capabilities } : {}),
    fetch: recordingReply(bodies, okReply),
  });
}

test("Anthropic sends each effort level the model takes", async () => {
  const bodies: CapturedRequest[] = [];
  for (const [effort, level] of [["low", "low"], ["max", "max"], ["minimal", "low"], ["medium", "medium"], ["xhigh", "xhigh"]] as const) {
    await stepOnce(effortProvider(bodies, effort, adaptiveEfforts));
    assert.deepEqual(lastRequest(bodies).output_config, { effort: level });
    assert.deepEqual(lastRequest(bodies).thinking, { type: "adaptive", display: "summarized" }, "the reasoning the panel shows is asked for, since this model's default is an empty thinking text");
  }
});

test("Anthropic effort none lowers effort rather than disabling thinking, and an unreported model keeps its old request", async () => {
  const bodies: CapturedRequest[] = [];
  await stepOnce(effortProvider(bodies, "none", adaptiveEfforts));
  assert.deepEqual(lastRequest(bodies).output_config, { effort: "low" }, "none on a model that thinks by default is its lowest effort");
  assert.equal("thinking" in lastRequest(bodies), false, "and never an explicit disable, which Fable 5.x and Opus 5.5 refuse and which can turn tool calls into plain text");
  await stepOnce(effortProvider(bodies, undefined, adaptiveEfforts));
  assert.equal("output_config" in lastRequest(bodies), false);
  await stepOnce(effortProvider(bodies, "none"));
  assert.deepEqual(lastRequest(bodies).thinking, { type: "disabled" }, "a model nothing has reported on gets the request this adapter always sent");
  assert.equal("output_config" in lastRequest(bodies), false);
});

test("a harness phase can lower Anthropic reasoning without changing provider defaults or completion capacity", async () => {
  const bodies: CapturedRequest[] = [];
  const anthropic = createAnthropicProvider({
    secretSource: serverSecret,
    config: { reasoningEffort: "max" },
    capabilities: { adaptiveThinking: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
    fetch: recordingReply(bodies, okReply),
  });
  await anthropic.step({ requestId: "phase-anthropic", system: "Brief.", messages: [{ role: "user", content: "select one stage" }], tools: [], reasoningEffort: "low" });
  assert.deepEqual(requestAt(bodies, 0).output_config, { effort: "low" });
  assert.equal(requestAt(bodies, 0).max_tokens, 64_000, "a thinking model's capacity is the agentic ceiling at every phase, never the phase's effort");
  assert.equal(anthropic.config.reasoningEffort, "max");
});

test("max_tokens is the user's setting, else the model's own maximum", async () => {
  const send = async (options: { maxTokens?: number; capabilities?: ModelCapabilities }) => {
    const bodies: CapturedRequest[] = [];
    const anthropic = createAnthropicProvider({ secretSource: serverSecret, ...options, fetch: recordingReply(bodies, okReply) });
    await stepOnce(anthropic);
    return requestAt(bodies, 0).max_tokens;
  };
  assert.equal(await send({ capabilities: { maxOutputTokens: 128_000 } }), 128_000, "the model's own maximum, not a floor");
  assert.equal(await send({ capabilities: { maxOutputTokens: 128_000 }, maxTokens: 20_000 }), 20_000, "an explicit setting wins");
  assert.equal(await send({ capabilities: { maxOutputTokens: 16_000 }, maxTokens: 20_000 }), 16_000, "but never past the model's ceiling");
  assert.equal(await send({ capabilities: { adaptiveThinking: true } }), 64_000, "the thinking ceiling where the model reports no maximum");
});

test("a tool-calling step marks the briefing and tool schemas cacheable, and counts what the cache served", async () => {
  let capturedBody = "";
  const provider = createAnthropicProvider({
    environment: { ANTHROPIC_API_KEY: "anthropic-secret" },
    fetch: async (_input, init) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ id: "msg_2", content: [{ type: "text", text: "Done." }], usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 } }), { status: 200 });
    },
  });
  const result = await provider.step({ requestId: "step-1", system: "You are the agent.\nProject context: …", systemSegments: [{ text: "You are the agent.\n", cache: true }, { text: "Project context: …" }], messages: [{ role: "user", content: "hi" }], tools: [{ ...statusTool, parameters: { type: "object" } }, { name: "ae_inspect_layer", description: "inspect", parameters: { type: "object" } }] });
  const body = captureRequest(capturedBody);
  assert.deepEqual(systemAt(body, 0).cache_control, { type: "ephemeral" });
  assert.equal(systemAt(body, 1).text, "Project context: …");
  assert.equal(systemAt(body, 1).cache_control, undefined);
  assert.equal(toolAt(body, 0).cache_control, undefined, "only the last tool carries the breakpoint");
  assert.deepEqual(toolAt(body, 1).cache_control, { type: "ephemeral" });
  assert.equal(result.usage?.inputTokens, 6040);
  assert.equal(result.usage?.cachedInputTokens, 6000);
  assert.equal(result.usage?.totalTokens, 6050);
});

test("a step with tool calls and no text is still a successful step", async () => {
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async () => new Response(JSON.stringify({ id: "msg_tools", content: [{ type: "tool_use", id: "toolu_1", name: "ae_status", input: {} }], stop_reason: "tool_use" }), { status: 200 }),
  });
  const result = await provider.step({ requestId: "r", system: "Brief.", messages: [{ role: "user", content: "hi" }], tools: [statusTool] });
  assert.equal(result.text, "");
  assert.deepEqual(result.toolCalls.map((call) => call.name), ["ae_status"]);
});

test("an Anthropic step surfaces the provider stop reason", async () => {
  const provider = createAnthropicProvider({
    secretSource: serverSecret,
    fetch: async () => new Response(JSON.stringify({ id: "msg_done", content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }), { status: 200 }),
  });
  const result = await stepOnce(provider);
  assert.equal(result.text, "Done.");
  assert.equal(result.finishReason, "end_turn");
});

test("the Anthropic adapter never sends a first message in the assistant role and coalesces same-role turns", async () => {
  const panelHistory: ChatMessage[] = [
    { role: "assistant", content: "[Proposed plan p3: plan 3]" },
    { role: "user", content: "ask 4" },
    { role: "assistant", content: "answer 4" },
    { role: "assistant", content: "[Proposed plan p4: plan 4]" },
    { role: "user", content: "now fade it" },
  ];
  const bodies: CapturedRequest[] = [];
  const provider = createAnthropicProvider({ secretSource: serverSecret, fetch: recordingReply(bodies, { id: "msg_3", content: [{ type: "text", text: "ok" }] }) });
  const stepMessages = panelHistory.map((turn): AgentMessage => turn.role === "user" ? { role: "user", content: turn.content } : { role: "assistant", content: turn.content });
  await provider.step({ requestId: "r", system: "Brief.", messages: stepMessages, tools: [] });
  assert.deepEqual(requestAt(bodies, 0).messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(messageAt(requestAt(bodies, 0), 1).content?.length, 2, "adjacent assistant turns share one message");
  await provider.complete({ requestId: "r", systemInstructions: "Answer.", userMessage: "Summarize.", history: panelHistory, context });
  assert.deepEqual(requestAt(bodies, 1).messages.map((message) => message.role), ["user", "assistant", "user"]);
});
