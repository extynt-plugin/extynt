/** The stall window is a no-output window: a quiet call is abandoned, a call that keeps streaming is never cut for its length. No test here touches the network. */
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { createLocalSecretInput, ProviderStallError, startStallGuard, STALL_TIMEOUT_MS, type AgentStepInput, type StallTimers } from "../src/index.js";
import { createAnthropicProvider } from "../src/anthropic.js";
import { OpenAICompatibleProvider } from "../src/openai.js";

const STEP: AgentStepInput = { requestId: "r", system: "Brief.", messages: [{ role: "user", content: "draw" }], tools: [], forceStream: true };
const sse = (delta: JsonObject): string => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function timedBody(signal: AbortSignal | null | undefined, chunks: Array<{ after: number; text: string }>, end: boolean): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      signal?.addEventListener("abort", () => { try { controller.error(signal.reason); } catch { return; } }, { once: true });
      for (const chunk of chunks) {
        await sleep(chunk.after);
        if (signal?.aborted) return;
        controller.enqueue(encoder.encode(chunk.text));
      }
      if (end) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const compatible = (chunks: Array<{ after: number; text: string }>, end: boolean) => new OpenAICompatibleProvider({
  secretSource: createLocalSecretInput("secret"),
  config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input" },
  fetch: async (_input, init) => timedBody(init?.signal, chunks, end),
});

test("the stall window is 90 s", () => assert.equal(STALL_TIMEOUT_MS, 90_000));

test("the guard fires after the window with no touch, and a touch starts the window over (fake time)", () => {
  const armed = new Set<() => void>();
  const timers: StallTimers = { start: (run) => { armed.add(run); return () => armed.delete(run); } };
  const controller = new AbortController();
  const guard = startStallGuard(controller, 90_000, timers);
  for (let chunk = 0; chunk < 1000; chunk += 1) guard.touch();
  assert.equal(armed.size, 1, "only the newest timer is armed");
  assert.equal(controller.signal.aborted, false);
  for (const run of armed) run();
  assert.equal(controller.signal.aborted, true);
  assert.ok(guard.fired instanceof ProviderStallError);
  assert.equal(guard.fired.message, "stalled: no output for 90 s");
  assert.equal(controller.signal.reason, guard.fired);
});

test("a stream that goes quiet is abandoned as stalled", async () => {
  const provider = compatible([{ after: 0, text: sse({ content: "Hel" }) }], false);
  await assert.rejects(provider.step({ ...STEP, stallTimeoutMs: 80 }), { name: "ProviderStallError", message: /^stalled: no output for/ });
});

test("a stream that never sends its first chunk stalls too", async () => {
  const provider = compatible([], false);
  await assert.rejects(provider.step({ ...STEP, stallTimeoutMs: 60 }), ProviderStallError);
});

test("a stream that keeps emitting text, reasoning and tool-call deltas past the window is never aborted", async () => {
  const kinds: JsonObject[] = [{ content: "a" }, { reasoning_content: "think" }, { tool_calls: [{ index: 0, id: "c", function: { name: "ae_x", arguments: "{" } }] }, { tool_calls: [{ index: 0, function: { arguments: "}" } }] }];
  const chunks = Array.from({ length: 16 }, (_, at) => ({ after: 25, text: sse(kinds[at] ?? { content: "b" }) }));
  chunks.push({ after: 25, text: `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n` });
  const started = Date.now();
  const reply = await compatible(chunks, true).step({ ...STEP, stallTimeoutMs: 80 });
  assert.ok(Date.now() - started > 80 * 3, "ran several windows long");
  assert.equal(reply.toolCalls[0]?.name, "ae_x");
});

test("keep-alive comments are not output: a stream that only pings still stalls", async () => {
  const pings = Array.from({ length: 20 }, () => ({ after: 20, text: ": keep-alive\n\n" }));
  await assert.rejects(compatible(pings, false).step({ ...STEP, stallTimeoutMs: 80 }), ProviderStallError);
});

test("the Anthropic stream follows the same rule", async () => {
  const event = (text: string): string => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`;
  const build = (chunks: Array<{ after: number; text: string }>, end: boolean) => createAnthropicProvider({ secretSource: { authSource: "server-environment", resolve: () => "k" }, fetch: async (_input, init) => timedBody(init?.signal, chunks, end) });
  await assert.rejects(build([{ after: 0, text: event("x") }], false).step({ ...STEP, stallTimeoutMs: 80 }), ProviderStallError);
  const steady = Array.from({ length: 12 }, () => ({ after: 25, text: event("y") }));
  steady.push({ after: 25, text: `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n` });
  steady.push({ after: 25, text: `data: ${JSON.stringify({ type: "message_stop" })}\n\n` });
  const reply = await build(steady, true).step({ ...STEP, stallTimeoutMs: 80 });
  assert.equal(reply.text.length, 12);
});

test("the caller's Stop ends a stream mid-answer: the request is aborted and the step rejects with the stop, not a stall", async () => {
  const stop = new AbortController();
  let reached: AbortSignal | undefined;
  const provider = new OpenAICompatibleProvider({
    secretSource: createLocalSecretInput("secret"),
    config: { id: "deepseek-flash", endpoint: "http://127.0.0.1:4310", model: "deepseek-flash", authSource: "local-secret-input" },
    fetch: async (_input, init) => { reached = init?.signal ?? undefined; return timedBody(init?.signal, [{ after: 0, text: sse({ content: "Hel" }) }], false); },
  });
  const pending = provider.step({ ...STEP, signal: stop.signal });
  await sleep(40);
  stop.abort(new Error("the job was stopped"));
  await assert.rejects(pending, (error) => !(error instanceof ProviderStallError));
  assert.equal(reached?.aborted, true, "the abort reached the network request");
});
