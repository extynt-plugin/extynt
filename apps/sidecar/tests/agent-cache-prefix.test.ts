/** The request prefix the provider caches: system prompt, tools and history stay byte-identical while per-step state rides a trailing message. */
import assert from "node:assert/strict";
import test from "node:test";
import { foldOldToolResults, runAgent, type ToolResult } from "../src/agent.js";
import { present } from "./agent-test-support.js";
import { MockProvider, type AgentMessage } from "@extynt/llm";

const readCall = (id: string) => ({ id, name: "ae_inspect_layer", arguments: { compositionId: "comp-1", layerId: "layer-1" } });
const callTool = (): ToolResult => ({ ok: true, data: { name: "Hero" } });

test("a multi-step turn sends a byte-identical system prompt and tool list, and live state only in a trailing message", async () => {
  let tick = 0;
  const provider = new MockProvider({ script: (input) => {
    const done = input.messages.filter((message) => message.role === "tool").length;
    return done < 3 ? { text: "", toolCalls: [readCall(`r${done}`)] } : { text: "Done.", toolCalls: [] };
  } });
  await runAgent(provider, {
    requestId: "req-prefix", message: "look", history: [], briefing: "briefing", briefingSegments: [{ text: "briefing", cache: true }],
    liveState: () => `turn clock tick-${tick += 1}`, callTool,
  });
  const steps = provider.stepInputs;
  assert.ok(steps.length >= 4, "tool calls then an answer");
  const first = present(steps[0], "the first step");
  const state = (step: (typeof steps)[number]): AgentMessage | undefined => step.messages.at(-1);
  for (const [index, step] of steps.entries()) {
    assert.equal(step.system, "briefing");
    assert.equal(JSON.stringify(step.system), JSON.stringify(first.system));
    assert.equal(JSON.stringify(step.systemSegments), JSON.stringify(first.systemSegments));
    assert.equal(JSON.stringify(step.tools), JSON.stringify(first.tools));
    const tail = state(step);
    assert.equal(tail?.role, "user");
    assert.match(String(tail?.content), new RegExp(`tick-${index + 1}\\b`));
    assert.match(String(tail?.content), /trusted/);
    assert.doesNotMatch(JSON.stringify(step.messages.slice(0, -1)), /tick-/, "the live state is only in the trailing message");
    assert.doesNotMatch(step.system, /tick-/);
  }
  for (let index = 1; index < steps.length; index += 1) {
    const before = present(steps[index - 1]).messages.slice(0, -1);
    const after = present(steps[index]).messages.slice(0, -1);
    assert.equal(JSON.stringify(after.slice(0, before.length)), JSON.stringify(before), "each step extends the previous history unchanged");
  }
});

test("folding past the budget brings the history well under it, so the next steps fold nothing", () => {
  const messages: AgentMessage[] = [];
  for (let index = 0; index < 8; index += 1) {
    messages.push({ role: "assistant", content: "", toolCalls: [{ id: `c${index}`, name: "ae_inspect_layer", arguments: {} }] });
    messages.push({ role: "tool", toolCallId: `c${index}`, name: "ae_inspect_layer", content: "x".repeat(4000) });
  }
  const budget = 7000;
  foldOldToolResults(messages, budget, { foldedChars: 200, charsPerToken: 4 });
  const settled = JSON.stringify(messages);
  messages.push({ role: "tool", toolCallId: "c8", name: "ae_inspect_layer", content: "y".repeat(4000) });
  foldOldToolResults(messages, budget, { foldedChars: 200, charsPerToken: 4 });
  assert.ok(JSON.stringify(messages).startsWith(settled.slice(0, -1)), "a small addition after a fold leaves the earlier prefix untouched");
});
