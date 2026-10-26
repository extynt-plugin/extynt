// A running turn: steering, progress and reasoning lines, a replaced turn, and the retry of a step the provider cut off.
import { flagOf, maybeNumberOf, maybeTextOf, numberOf, readJson, textOf } from "./http-json.js";
import { runAgent } from "../src/agent.js";
import { authorization, chatTurn, sidecarFor, token } from "./sidecar-fixture.js";
import { baseUrl, cancellationReached, postChat, postSnapshot, progressForTurn, waitForProgress } from "./agent-turn-support.js";
import { present, toolMessages } from "./agent-test-support.js";
import { MockProvider, splitTransient } from "@extynt/llm";
import assert from "node:assert/strict";
import test from "node:test";

const answerNow = () => ({ ok: true as const, data: {} });
const JSON_HEADERS = { ...authorization, "content-type": "application/json" };

test("a tool call that fails the same way twice is told so, and the turn is warned before it runs out of steps", async (t) => {
  const seen: string[] = [];
  const provider = new MockProvider({ script: (input) => {
    const last = splitTransient(input.messages).persisted.at(-1);
    if (last?.role === "tool") seen.push(last.content);
    return { text: "", toolCalls: [{ id: `c${seen.length}`, name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: "does-not-exist" } }] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-repeat");
  await chatTurn(address, "inspect it");
  assert.ok(seen.some((content) => /already called ae_inspect_layer with these exact arguments/.test(content)), "a repeated identical failing call must be named as such");
  assert.ok(seen.some((content) => /steps? left in this turn/.test(content)), "the model must learn the turn is running out of steps");
});

test("a message sent while a turn runs joins that turn instead of starting another", async (t) => {
  let entered: (() => void) | undefined;
  const enteredTurn = new Promise<void>((resolve) => { entered = resolve; });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const stepsSeen: Array<Array<{ role: string; content: string }>> = [];
  const provider = new MockProvider({ script: async (input) => {
    stepsSeen.push(input.messages.map((message) => ({ role: message.role, content: message.content })));
    if (stepsSeen.length === 1) {
      entered?.();
      await gate;
      return { text: "", toolCalls: [{ id: "c1", name: "ae_get_current_context", arguments: {} }] };
    }
    return { text: "Done.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-steer");
  const requestId = "chat-steer-1";
  const turn = fetch(`${baseUrl(address)}/v1/chat`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ requestId, message: "rename everything" }) });
  await enteredTurn;
  const steered = await fetch(`${baseUrl(address)}/v1/chat/steer`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ requestId, message: "actually make it blue" }) });
  assert.equal(steered.status, 202);
  assert.equal(numberOf(await readJson(steered), "queued"), 1);
  release?.();
  const response = await readJson((await turn));
  assert.equal(flagOf(response, "ok"), true);
  assert.equal(maybeNumberOf(response, "steering"), 1, "the turn reports that it carried a steer");

  assert.ok(!present(stepsSeen[0]).some((message) => message.content.includes("make it blue")));
  const secondStepUsers = present(stepsSeen[1]).filter((message) => message.role === "user").map((message) => message.content);
  assert.ok(secondStepUsers.some((content) => content.includes("actually make it blue")), `the steer reached the next model call: ${JSON.stringify(secondStepUsers)}`);
  assert.match(secondStepUsers.find((content) => content.includes("make it blue")) ?? "", /not a new turn/);
});

test("steering a turn that is not running is refused rather than silently queued", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: new MockProvider({ answer: "hi" }), quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const refused = await fetch(`${baseUrl(address)}/v1/chat/steer`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ requestId: "nothing-running", message: "hello?" }) });
  assert.equal(refused.status, 409);
  const body = await readJson(refused);
  assert.equal(textOf(body, "error.code"), "NO_RUNNING_TURN");
});

test("the provider's stop signal survives the turn instead of being dropped", async () => {
  const provider = new MockProvider({ script: () => ({ text: "Done.", toolCalls: [], finishReason: "stop" }) });
  const result = await runAgent(provider, { requestId: "r-stop", message: "hello", history: [], briefing: "b", callTool: answerNow });
  assert.equal(result.stopReason, "stop");
  const truncated = new MockProvider({ script: () => ({ text: "Cut off.", toolCalls: [], finishReason: "max_tokens" }) });
  assert.equal((await runAgent(truncated, { requestId: "r-len", message: "hello", history: [], briefing: "b", callTool: answerNow })).stopReason, "max_tokens");
});

test("the live token count rides the progress update instead of waiting for the response", async () => {
  let step = 0;
  const provider = new MockProvider({ script: async () => { step += 1; return step === 1
    ? { text: "", toolCalls: [{ id: "c1", name: "ae_read_something", arguments: {} }], usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedInputTokens: 20 }, raw: undefined }
    : { text: "Done.", toolCalls: [], usage: { inputTokens: 300, outputTokens: 90, totalTokens: 390, cachedInputTokens: 60 }, raw: undefined }; } });
  const seen: Array<{ step: number; total: number }> = [];
  const result = await runAgent(provider, { requestId: "r-usage", message: "hello", history: [], briefing: "b", callTool: answerNow, onProgress: (progress) => seen.push({ step: progress.step, total: progress.usage?.totalTokens ?? 0 }) });

  assert.equal(result.usage.totalTokens, 530);
  assert.equal(seen[0]?.total, 0);
  assert.ok(seen.some((entry) => entry.step === 2 && entry.total === 140), `expected a step-2 update carrying 140 tokens, saw ${JSON.stringify(seen)}`);
});

test("a step's reasoning rides the progress update, once per step and bounded", async () => {
  let step = 0;
  const provider = new MockProvider({ script: async () => { step += 1; return step === 1
    ? { text: "", toolCalls: [{ id: "c1", name: "ae_read_something", arguments: {} }], usage: undefined, raw: { reasoning_content: "first thought" } }
    : { text: "Done.", toolCalls: [], usage: undefined, raw: { reasoning_content: "last thought" } }; } });
  const seen: Array<{ step: number; reasoning?: string | undefined }> = [];
  const result = await runAgent(provider, { requestId: "r-reason", message: "hello", history: [], briefing: "b", callTool: answerNow, onProgress: (progress) => seen.push({ step: progress.step, reasoning: progress.reasoning }) });
  assert.deepEqual(seen.filter((entry) => typeof entry.reasoning === "string").map((entry) => entry.reasoning), ["first thought", "last thought"], `one reasoning update per step, in order: ${JSON.stringify(seen)}`);
  assert.deepEqual(result.reasoning, [
    { step: 1, text: "first thought", tools: ["ae_read_something"] },
    { step: 2, text: "last thought", tools: [] },
  ], "the completed result keeps every provider-exposed step even if a progress poll missed it");

  const silent = new MockProvider({ script: async () => ({ text: "Done.", toolCalls: [], usage: undefined, raw: { content: [{ type: "text", text: "the answer" }] } }) });
  const none: Array<string | undefined> = [];
  await runAgent(silent, { requestId: "r-silent", message: "hello", history: [], briefing: "b", callTool: answerNow, onProgress: (progress) => none.push(progress.reasoning) });
  assert.equal(none.some((entry) => entry !== undefined), false, "no reasoning means no field");

  const long = new MockProvider({ script: async () => ({ text: "Done.", toolCalls: [], usage: undefined, raw: { reasoning_content: `${"x".repeat(9000)}THE END` } }) });
  const chunks: string[] = [];
  await runAgent(long, { requestId: "r-long", message: "hello", history: [], briefing: "b", callTool: answerNow, onProgress: (progress) => { if (typeof progress.reasoning === "string") chunks.push(progress.reasoning); } });
  assert.equal(chunks[0]?.length, 8001, "8000 characters plus the leading ellipsis");
  assert.ok(chunks[0]?.startsWith("…"), "the start that scrolled out is marked");
  assert.ok(chunks[0]?.endsWith("THE END"), "the newest text is the part that survives");
});

test("a streaming step grows the progress reasoning while the step runs, and stays inside the same bound", async () => {
  const provider = new MockProvider({ script: async (input) => {
    let reasoning = "";
    for (let index = 0; index < 60; index += 1) {
      reasoning += `${"x".repeat(197)}${String(index).padStart(3, "0")}`;
      input.onDelta?.({ text: "", reasoning });
    }
    return { text: "Done.", toolCalls: [], usage: undefined, raw: { reasoning_content: reasoning } };
  } });
  const seen: string[] = [];
  await runAgent(provider, { requestId: "r-stream", message: "hello", history: [], briefing: "b", callTool: answerNow, onProgress: (progress) => { if (typeof progress.reasoning === "string") seen.push(progress.reasoning); } });

  assert.ok(seen.length >= 3, `expected the reasoning to arrive in growing updates, saw ${JSON.stringify(seen.map((value) => value.length))}`);
  assert.ok(seen.slice(1).every((value, index) => value.length >= (seen[index]?.length ?? 0)), "each update is at least as long as the one before it");

  assert.equal(seen.at(-1)?.length, 8001, "the streamed chain is clipped to the same bound as the finished one");
  assert.ok(seen.at(-1)?.startsWith("…"), "the chain is clipped from the front, not the back");
  assert.ok(seen.at(-1)?.endsWith("059"), "the newest chunk is what the reader sees");
  assert.equal(seen.at(-1)?.includes("019"), false, "the oldest chunks are the ones dropped");
  assert.ok(seen.at(-1)?.includes("020"), "the oldest surviving chunk is the first one inside the bound");
});

test("a turn reads its own progress line, and only its own", async (t) => {
  let release = (): void => {};
  const parked = new Promise<void>((resolve) => { release = resolve; });
  const provider = new MockProvider({ script: async () => { await parked; return { text: "Finished.", toolCalls: [] }; } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-progress-key");

  const turn = postChat(address, "chat-mine", "do the thing");
  const mine = await waitForProgress(address, "chat-mine");
  assert.equal(textOf(mine, "requestId"), "chat-mine", "a running turn must be able to read its own line");
  assert.equal(await progressForTurn(address, "chat-not-a-turn"), null, "a requestId that names no running turn answers with nothing, never with somebody else's turn");

  const newest = await readJson(await fetch(`${baseUrl(address)}/v1/chat/progress`, { headers: authorization }));
  assert.equal(maybeTextOf(newest, "progress.requestId"), "chat-mine");
  release();
  assert.equal((await turn).outcome, "answered");
  assert.equal(await progressForTurn(address, "chat-mine"), null, "a finished turn leaves no line behind");
});

test("a message sent while a turn is running replaces it, and the replaced turn reports a stop", async (t) => {
  let stoppedReachedProvider = false;
  const provider = new MockProvider({ model: "cheap", script: async (input) => {
    if (input.requestId === "chat-second") return { text: "The second turn answered.", toolCalls: [] };
    stoppedReachedProvider = await cancellationReached(input.signal);
    return { text: "The first turn answered.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-supersede");

  const first = postChat(address, "chat-first", "the first thing");
  assert.ok(await waitForProgress(address, "chat-first"), "the first turn must be running before the second arrives");
  const second = await postChat(address, "chat-second", "the second thing");
  const replaced = await first;
  assert.equal(second.outcome, "answered");
  assert.equal(textOf(second, "answer"), "The second turn answered.");
  assert.equal(replaced.outcome, "failed", "a replaced turn is not an answer");
  assert.equal(maybeTextOf(replaced, "failure.code"), "CANCELLED", "a replaced turn reports the stop, not a provider failure");
  assert.doesNotMatch(textOf(replaced, "answer"), /The first turn answered/, "the replaced turn's late reply must not be handed back as this turn's answer");
  assert.equal(stoppedReachedProvider, true, "replacing a turn must stop the request it was waiting on");
});

test("a step the provider's clock cut off is re-asked before the turn is allowed to fail", async (t) => {
  let attempts = 0;
  const provider = new MockProvider({ script: (input) => {
    attempts += 1;
    if (!toolMessages(input.messages).length) return { text: "", toolCalls: [{ id: "c1", name: "ae_get_current_context", arguments: {} }] };
    if (attempts === 2) { const timedOut = new Error("The step ran out of time."); timedOut.name = "AbortError"; throw timedOut; }
    return { text: "Recovered after the timeout.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-step-retry");

  const reply = await postChat(address, "chat-retry", "inspect the project");
  assert.equal(reply.outcome, "answered", "one step that outlived its clock must not end the turn");
  assert.equal(reply.answer, "Recovered after the timeout.");
  assert.equal(provider.calls, 3, "the timed-out step is asked once more, not abandoned");
});

test("a reply whose connection dropped mid-stream is asked again, not failed", async (t) => {
  let attempts = 0;
  const provider = new MockProvider({ script: (input) => {
    attempts += 1;
    if (!toolMessages(input.messages).length) return { text: "", toolCalls: [{ id: "c1", name: "ae_get_current_context", arguments: {} }] };
    if (attempts === 2) throw new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
    return { text: "Recovered after the dropped connection.", toolCalls: [] };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-dropped");

  const reply = await postChat(address, "chat-dropped", "inspect the project");
  assert.equal(reply.outcome, "answered", "a dropped stream must not end the turn while a retry is left");
  assert.equal(reply.answer, "Recovered after the dropped connection.");
  assert.equal(provider.calls, 3);
});

test("a provider timeout is not handed to the fallback model, and a stop never is", async (t) => {
  const timingOut = new MockProvider({ model: "cheap", script: (input) => {
    if (!toolMessages(input.messages).length) return { text: "", toolCalls: [{ id: "c1", name: "ae_get_current_context", arguments: {} }] };
    const timedOut = new Error("This step will not finish.");
    timedOut.name = "AbortError";
    throw timedOut;
  } });
  const strong = new MockProvider({ model: "strong", answer: "The strong model answered." });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: timingOut, fallbackChatProvider: strong, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await postSnapshot(address, "probe-no-fallback");

  const reply = await postChat(address, "chat-timeout", "inspect the project");
  assert.equal(maybeTextOf(reply, "failure.code"), "PROVIDER_TIMEOUT");
  assert.equal(reply.model, "cheap", "a step that ran out of clock is not evidence the other model reads the same prompt faster");
  assert.equal(reply.fallback, undefined, "the work already done must not be thrown away and re-bought on the fallback model");
});
