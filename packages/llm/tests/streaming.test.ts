// Streaming fixtures for the quiet failures: a chunk boundary inside a JSON object, a tool call split across chunks, and a replayed message that must keep its reasoning_content.
import assert from "node:assert/strict";
import test from "node:test";
import { extractReasoning, type AgentStepResult } from "../src/index.js";
import type { OpenAICompatibleProvider } from "../src/openai.js";
import { messageAt, requestAt, type CapturedRequest } from "./wire-fixtures.js";
import { DONE_FRAME, STEP, collectingDeltas, contentDelta, deepSeekStreaming, sseEvent, streamingFetch, streamingProvider, toolFragment } from "./stream-fixtures.js";

const fadeCall = { id: "call_1", type: "function", function: { name: "ae_propose_plan", arguments: "{\"summary\":\"Fade\"}" } };
const fadeFragments = [
  toolFragment(0, { id: "call_1", type: "function", function: { name: "ae_propose_plan", arguments: "{\"summary\":" } }),
  toolFragment(0, { function: { arguments: "\"Fade\"}" } }),
];

function replayStep(first: AgentStepResult) {
  return { ...STEP, messages: [...STEP.messages, { role: "assistant" as const, content: first.text, toolCalls: first.toolCalls, raw: first.raw }, { role: "tool" as const, toolCallId: "call_1", name: "ae_propose_plan", content: "{\"data\":{}}" }] };
}

test("SSE frames are parsed and the assembled reply streams text and reasoning as they arrive", async () => {
  const textChunks = ["The plan ", "is to fade ", "the layer ", "and then ", "trim it."];
  const reasoningChunks = ["First I weigh ", "the fade ", "against trimming ", "the tail ", "of the comp."];
  const chunks = textChunks.flatMap((text, index) => [contentDelta({ content: text }), contentDelta({ reasoning_content: reasoningChunks[index] ?? "" })]);
  chunks.push(contentDelta({}, "stop"), sseEvent({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, prompt_cache_hit_tokens: 100 } }), DONE_FRAME);

  const { deltas, onDelta } = collectingDeltas();
  let captured: CapturedRequest | undefined;
  const result = await deepSeekStreaming(streamingFetch(chunks, (body) => { captured = body; })).step({ ...STEP, onDelta });

  assert.equal(captured?.stream, true, "the opt-in streaming path asks for a stream");
  assert.deepEqual(captured?.stream_options, { include_usage: true });
  assert.equal(result.text, "The plan is to fade the layer and then trim it.");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 40, totalTokens: 160, cachedInputTokens: 100 });
  assert.deepEqual(deltas[0], { text: textChunks[0], reasoning: "" });
  assert.deepEqual(deltas[1], { text: "", reasoning: reasoningChunks[0] }, "reasoning is visible before the answer is finished");
  assert.equal(deltas.filter((delta) => delta.text).at(-1)?.text, result.text);
  assert.equal(deltas.filter((delta) => delta.reasoning).at(-1)?.reasoning, reasoningChunks.join(""));
});

test("a chunk boundary inside a JSON object does not lose or duplicate a delta", async () => {
  const frames = [sseEvent({ choices: [{ delta: { reasoning_content: "one" } }] }), sseEvent({ choices: [{ delta: { reasoning_content: "two" } }] }), sseEvent({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }), DONE_FRAME];
  const wire = frames.join("");
  for (const split of [1, 7, 23, 60, wire.length - 1]) {
    const { deltas, onDelta } = collectingDeltas();
    const provider = deepSeekStreaming(streamingFetch([wire.slice(0, split), wire.slice(split, split + 13), wire.slice(split + 13)]));
    const result = await provider.step({ ...STEP, onDelta });
    assert.equal(result.text, "Done.", `text survives a split at ${split}`);
    assert.equal(deltas.filter((delta) => delta.reasoning).at(-1)?.reasoning, "onetwo", `reasoning survives a split at ${split}`);
    assert.equal(deltas.at(-1)?.text, "Done.");
    assert.equal(deltas.filter((delta) => delta.reasoning === "one").length, 1, `no duplicated delta at split ${split}`);
  }
});

test("tool-call fragments assemble per index across chunks, in index order", async () => {
  const chunks = [
    toolFragment(0, { id: "call_1", type: "function", function: { name: "ae_propose_plan", arguments: "" } }),
    toolFragment(1, { id: "call_2", type: "function", function: { name: "ae_list_plans", arguments: "{}" } }),
    toolFragment(0, { function: { arguments: "{\"summary\":" } }),
    toolFragment(0, { function: { arguments: "\"Fade the layer\"}" } }),
    sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    sseEvent({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    DONE_FRAME,
  ];
  const result = await deepSeekStreaming(streamingFetch(chunks)).step(STEP);

  assert.deepEqual(result.toolCalls, [
    { id: "call_1", name: "ae_propose_plan", arguments: { summary: "Fade the layer" } },
    { id: "call_2", name: "ae_list_plans", arguments: {} },
  ]);
  assert.equal(result.finishReason, "tool_calls");
  assert.equal(result.usage?.totalTokens, 15);
  assert.deepEqual(result.raw, {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "ae_propose_plan", arguments: "{\"summary\":\"Fade the layer\"}" } },
      { id: "call_2", type: "function", function: { name: "ae_list_plans", arguments: "{}" } },
    ],
  });
});

test("a streamed turn replays the same assistant message as a non-streamed one", async () => {
  const message = { role: "assistant", content: null, reasoning_content: "weighing the fade", tool_calls: [fadeCall] };
  const streamed = streamingProvider(() => [...fadeFragments, sseEvent({ choices: [{ delta: { reasoning_content: "weighing the fade" }, finish_reason: "tool_calls" }] }), DONE_FRAME].join(""), true);
  const streamedResult = await streamed.provider.step(STEP);
  const plain = streamingProvider(() => JSON.stringify({ choices: [{ finish_reason: "tool_calls", message }] }), false);
  const plainResult = await plain.provider.step(STEP);

  assert.equal(streamedResult.text, plainResult.text);
  assert.deepEqual(streamedResult.toolCalls, plainResult.toolCalls);
  assert.deepEqual(streamedResult.raw, plainResult.raw, "one reply must produce one replayed message whichever path fetched it");
  assert.deepEqual(streamedResult.raw, { ...message, content: "" }, "the provider's own tool-call shape is what replays");
  assert.equal(extractReasoning(streamedResult.raw), "weighing the fade");
  assert.deepEqual(streamedResult.usage, undefined, "a stream that reports no usage invents none");
});

test("a two-step streamed turn sends a second request whose assistant message keeps its reasoning", async () => {
  const replies = [
    [...fadeFragments, sseEvent({ choices: [{ delta: { reasoning_content: "weighing the fade " }, finish_reason: "tool_calls" }] }), DONE_FRAME].join(""),
    [sseEvent({ choices: [{ delta: { reasoning_content: "the plan is ready" } }] }), sseEvent({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }), DONE_FRAME].join(""),
  ];
  const { provider, bodies } = streamingProvider((call) => replies[call - 1] ?? "", true);

  const first = await provider.step(STEP);
  assert.deepEqual(first.toolCalls.map((call) => call.name), ["ae_propose_plan"]);
  const second = await provider.step(replayStep(first));

  assert.equal(second.text, "Done.");
  assert.deepEqual(messageAt(requestAt(bodies, 1), 2), { role: "assistant", content: "", reasoning_content: "weighing the fade ", tool_calls: [fadeCall] });
});

test("a turn with streaming on produces the same answer and replays the same assistant message as one with it off", async () => {
  const firstMessage = { role: "assistant", content: null, reasoning_content: "weighing the fade", tool_calls: [fadeCall] };
  const streamFor = (call: number): string => (call === 1
    ? [...fadeFragments, contentDelta({ reasoning_content: "weighing the fade" }, "tool_calls"), DONE_FRAME].join("")
    : [contentDelta({ reasoning_content: "landing it" }), contentDelta({ content: "Done." }, "stop"), DONE_FRAME].join(""));
  const jsonFor = (call: number): string => JSON.stringify(call === 1
    ? { choices: [{ finish_reason: "tool_calls", message: firstMessage }] }
    : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Done.", reasoning_content: "landing it" } }] });
  const streamed = streamingProvider(streamFor, true);
  const plain = streamingProvider(jsonFor, false);

  const runTurn = async (provider: OpenAICompatibleProvider): Promise<AgentStepResult> => provider.step(replayStep(await provider.step(STEP)));
  const streamedAnswer = await runTurn(streamed.provider);
  const plainAnswer = await runTurn(plain.provider);

  assert.equal(streamedAnswer.text, plainAnswer.text);
  assert.equal(streamedAnswer.finishReason, plainAnswer.finishReason);
  assert.deepEqual(streamedAnswer.raw, plainAnswer.raw);
  assert.equal(streamed.bodies.length, 2, "a working stream is one request per step");
  assert.deepEqual(requestAt(streamed.bodies, 1).messages, requestAt(plain.bodies, 1).messages, "both turns send the same second request");
  assert.equal(messageAt(requestAt(streamed.bodies, 1), 2).reasoning_content, "weighing the fade");
});

test("two tool calls without an index stay separate when their ids differ", async () => {
  const chunks = [
    sseEvent({ choices: [{ delta: { tool_calls: [{ id: "call_1", type: "function", function: { name: "ae_propose_plan", arguments: "" } }] } }] }),
    sseEvent({ choices: [{ delta: { tool_calls: [{ function: { arguments: "{\"summary\":\"Fade the layer\"}" } }] } }] }),
    sseEvent({ choices: [{ delta: { tool_calls: [{ id: "call_2", type: "function", function: { name: "ae_list_plans", arguments: "{}" } }] } }] }),
    sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    DONE_FRAME,
  ];
  const result = await deepSeekStreaming(streamingFetch(chunks)).step(STEP);

  assert.deepEqual(result.toolCalls, [
    { id: "call_1", name: "ae_propose_plan", arguments: { summary: "Fade the layer" } },
    { id: "call_2", name: "ae_list_plans", arguments: {} },
  ]);
});
