// How a turn keeps inside its window: the fold fires on a working set, replayed reasoning is elided, a folded result stays byte-identical, the last-resort pass re-cuts to the floor, and a runaway prompt fails with CONTEXT_LIMIT.
import assert from "node:assert/strict";
import test from "node:test";
import { foldOldToolResults, runAgent, turnBudget } from "../src/agent.js";
import { decode, object, optional, rawJson, string } from "@extynt/decode";
import { MockProvider, type AgentMessage } from "@extynt/llm";
import { assistantAt, present, toolAt, toolMessages } from "./agent-test-support.js";

const FOLD_MARKER = "[earlier result folded to save room.";
const RAW_REPLAY = object({ reasoning_content: optional(string()), tool_calls: rawJson() });
const RAW_ONLY = object({ raw: optional(rawJson()) });

test("the fold fires on a working set, not on the room the window has left", () => {
  const million = turnBudget(1_000_000, "high");
  assert.ok(million.toolTokens > 900_000, "the memory-safety bound still scales with the window: it is what says a request would not fit");
  assert.ok(million.workingSetTokens >= 24_000 && million.workingSetTokens <= 32_000, `a working set a turn can actually fill, got ${million.workingSetTokens}`);
  assert.equal(million.foldTokens, million.workingSetTokens, "at a 1M window the working set is the smaller of the two, so it is what the fold uses");
  assert.ok(million.foldTokens * 10 < million.toolTokens, "the fold no longer waits for hundreds of thousands of tokens of stale results");
  assert.ok(million.foldedChars < 4_000, `a folded result keeps a head it can be folded from, got ${million.foldedChars}`);

  const tiny = turnBudget(32_000, "high");
  assert.equal(tiny.foldTokens, tiny.toolTokens, "a small window folds at its own memory bound, not at a working set bigger than it");
  assert.ok(turnBudget(undefined, "high").foldTokens <= million.foldTokens, "an undeclared window never buys a larger working set");
});

function replayOf(messages: readonly AgentMessage[], index: number) {
  const decoded = decode(RAW_REPLAY, assistantAt(messages, index).raw);
  return decoded.ok ? decoded.value : undefined;
}

function assertElided(messages: readonly AgentMessage[], index: number, calls: string): void {
  const raw = replayOf(messages, index);
  const reasoning = raw?.reasoning_content ?? "";
  assert.ok(reasoning.includes("[earlier reasoning elided"), `old step ${index} gives up its thinking`);
  assert.ok(reasoning.length < 300, "what replaces it is bounded");
  assert.equal(raw?.tool_calls, calls, "the tool calls the following results answer survive the elision");
}

function rawChars(message: AgentMessage): number {
  const replay = message.role === "assistant" ? decode(RAW_ONLY, { raw: message.raw }) : undefined;
  return replay?.ok ? (replay.value.raw ?? "{}").length : 2;
}

test("the fold counts replayed reasoning, elides the older steps, and keeps the newest whole", () => {
  const budget = 9_000;
  const reasoning = (step: number) => `step-${step} `.repeat(1_500);
  const rawCalls = (step: number) => [{ id: `call-${step}`, type: "function", function: { name: "ae_inspect_layer", arguments: `{"layerId":"layer-${step}"}` } }];
  const messages: AgentMessage[] = [];
  for (let step = 0; step < 4; step += 1) messages.push({ role: "assistant", content: "", toolCalls: [{ id: `call-${step}`, name: "ae_inspect_layer", arguments: { layerId: `layer-${step}` } }], raw: { role: "assistant", content: "", reasoning_content: reasoning(step), tool_calls: rawCalls(step) } });
  messages.push({ role: "tool", toolCallId: "call-3", name: "ae_inspect_layer", content: JSON.stringify({ layerId: "layer-3", pad: "x".repeat(20_000) }) });
  foldOldToolResults(messages, budget);

  for (const index of [0, 1, 2]) assertElided(messages, index, JSON.stringify(rawCalls(index)));
  assert.equal(replayOf(messages, 3)?.reasoning_content, reasoning(3), "the step the next request follows directly keeps its thinking verbatim");

  const carried = messages.reduce((sum, message) => sum + message.content.length + rawChars(message), 0);
  assert.ok(carried / 3.6 <= budget * 1.1, `carried ${carried} chars against a ${budget}-token budget`);
});

test("a folded result keeps its exact content however much the budget shrinks", () => {
  const payload = JSON.stringify({ layerId: "layer-0", matchName: "ADBE Gaussian Blur 2", pad: "x".repeat(60_000) });
  const messages: AgentMessage[] = [
    { role: "tool", toolCallId: "call-0", name: "ae_inspect_layer", content: payload },
    { role: "assistant", content: "", toolCalls: [{ id: "call-big", name: "ae_inspect_composition", arguments: { pad: "y".repeat(120_000) } }] },
  ];
  foldOldToolResults(messages, 10_000);
  const once = toolAt(messages, 0).content;
  assert.ok(once.startsWith(payload.slice(0, 400)), "the first fold keeps the opening lines it was given room for");
  assert.ok(once.includes("layerId=layer-0"), "and the identities the result named");

  foldOldToolResults(messages, 4_000, { foldedChars: 200 });
  foldOldToolResults(messages, 1_000, { foldedChars: 100 });
  assert.equal(toolAt(messages, 0).content, once, "the second and third passes leave the folded result byte-identical");

  foldOldToolResults(messages, 1_000, { foldedChars: 400 });
  assert.equal(toolAt(messages, 0).content, once, "a normal pass with the floor head is still a strict no-op");
});

test("the last-resort pass re-folds what a normal pass folded, and only down to the floor", () => {
  const messages: AgentMessage[] = [];
  for (let index = 0; index < 100; index += 1) {
    messages.push({ role: "assistant", content: "", toolCalls: [{ id: `call-${index}`, name: "ae_inspect_layer", arguments: { layerId: `layer-${index}`, pad: "p".repeat(6_000) } }] });
    messages.push({ role: "tool", toolCallId: `call-${index}`, name: "ae_inspect_layer", content: JSON.stringify({ layerId: `layer-${index}`, pad: "x".repeat(30_000) }) });
  }
  const budget = turnBudget(128_000, "high");
  foldOldToolResults(messages, budget.foldTokens, { foldedChars: budget.foldedChars, charsPerToken: budget.charsPerToken });
  const toolChars = () => toolMessages(messages).reduce((sum, message) => sum + message.content.length, 0);
  const afterNormal = toolChars();
  assert.equal(toolMessages(messages).filter((message) => message.content.includes(FOLD_MARKER)).length, 100, "every result folded once");
  assert.ok(afterNormal > 60_000, `each keeps the working-set head, which is most of the ${afterNormal} chars`);

  const emergency = Math.max(16_000, Math.round(budget.foldTokens * 0.5));
  const lastResort = { foldedChars: 400, charsPerToken: budget.charsPerToken, lastResort: true };
  foldOldToolResults(messages, emergency, lastResort);
  const afterLastResort = toolChars();
  assert.ok(afterLastResort < afterNormal * 0.6, `the last-resort pass re-cut them: ${afterNormal} → ${afterLastResort} chars`);
  assert.ok(afterLastResort / budget.charsPerToken <= emergency, `the tool output is back under the ${emergency}-token budget it was given`);
  assert.ok(toolMessages(messages).every((message) => message.content.length <= 900), "each result is the floor head plus its suffix");

  foldOldToolResults(messages, emergency, lastResort);
  assert.equal(toolChars(), afterLastResort, "an emergency pass at the floor cannot cut a second time");
});

test("the last-resort fold brings a turn back under the input backstop instead of failing it", async () => {
  const toolChars: number[] = [];
  const floorCount: number[] = [];
  const provider = new MockProvider({ script: (input) => {
    const tools = toolMessages(input.messages);
    toolChars.push(tools.reduce((sum, message) => sum + message.content.length, 0));
    floorCount.push(tools.filter((message) => message.content.length <= 800).length);
    if (tools.length >= 44) return { text: "Read everything.", toolCalls: [] };
    return { text: "", toolCalls: [{ id: `read-${tools.length}`, name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: `layer-${tools.length}`, pad: "p".repeat(6_000) } }] };
  } });
  provider.config.contextWindow = 128_000;
  const result = await runAgent(provider, { requestId: "req-last-resort", message: "read everything", history: [], briefing: "briefing", callTool: () => ({ ok: true, data: { pad: "x".repeat(30_000) } }) });

  assert.equal(result.failure, undefined, `the turn continued past the backstop instead of stopping: ${result.failure?.message ?? ""}`);
  assert.equal(result.steps, 45, "it reached the step that answers");

  const peakFloor = Math.max(...floorCount);
  assert.ok(peakFloor >= 20, `the last-resort pass demonstrably re-cut results, but at most ${peakFloor} ever reached the floor head`);

  const recovered = Math.max(...toolChars.map((chars, index) => index === 0 ? 0 : present(toolChars[index - 1]) - chars));
  assert.ok(recovered > 40_000, `one last-resort pass recovered ${recovered} characters of folded tool output`);
  const finalChars = present(toolChars.at(-1), "the last step's tool characters");
  assert.ok(finalChars < 30_000, `the last-resort pass re-cut the folded results, which still carry ${finalChars} chars`);
});

test("a turn at a 1M-token window folds its oldest results at the working set", async () => {
  const provider = new MockProvider({ script: (input) => {
    const read = toolMessages(input.messages).length;
    if (read >= 8) return { text: "Read everything.", toolCalls: [] };
    return { text: "", toolCalls: [{ id: `read-${read}`, name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: `layer-${read}` } }] };
  } });
  provider.config.contextWindow = 1_000_000;
  const result = await runAgent(provider, { requestId: "req-working-set", message: "read everything", history: [], briefing: "briefing", callTool: () => ({ ok: true, data: { pad: "x".repeat(30_000) } }) });

  assert.equal(result.failure, undefined, "the turn finished");
  const carriedTools = toolMessages(provider.stepInputs.at(-1)?.messages ?? []);
  const carried = carriedTools.reduce((sum, message) => sum + message.content.length, 0);
  const workingSet = turnBudget(1_000_000, undefined).foldTokens;
  assert.ok(carriedTools.some((message) => message.content.includes("[earlier result folded")), "the fold fired, which it never did while it waited for 938k tokens");
  assert.ok(carried < workingSet * 3.6, `carried ${carried} chars, past the ${workingSet}-token working set`);
});

test("a runaway prompt fails the turn with CONTEXT_LIMIT before an unbounded request is sent", async () => {
  const provider = new MockProvider({ script: (input) => toolMessages(input.messages).length
    ? { text: "done", toolCalls: [] }
    : { text: "", toolCalls: [{ id: "read-1", name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: "layer-1", pad: "x".repeat(120_000) } }] } });
  const result = await runAgent(provider, { requestId: "req-context-limit", message: "read it", history: [], briefing: "briefing", toolBudgetTokens: 16_000, callTool: () => ({ ok: true, data: {} }) });

  assert.equal(result.failure?.code, "CONTEXT_LIMIT", "the failure is named and readable, like every other turn failure");
  assert.match(result.failure?.message ?? "", /input budget/, "the message says what was exceeded");
  assert.equal(result.outcome, "failed");
  assert.equal(provider.calls, 1, "the next step was never sent, so nothing was billed for a request that could not fit");
});
