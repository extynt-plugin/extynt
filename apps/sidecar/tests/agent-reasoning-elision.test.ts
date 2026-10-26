/** Spent reasoning: dropped once a step's calls all answered cleanly, kept when one was refused, and never an edit to a signed block. */
import { foldOldToolResults, elideSpentReasoning } from "../src/agent.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import { MockProvider, extractReasoning, type AgentMessage } from "@extynt/llm";
import assert from "node:assert/strict";
import test from "node:test";

const THOUGHT = "t".repeat(2_000);

async function reasoningSeenOnStepTwo(firstCall: string): Promise<string> {
  let steps = 0;
  let seen = "";
  const provider = new MockProvider({ script: (input) => {
    steps += 1;
    if (steps === 2) seen = input.messages.filter((message) => message.role === "assistant").map((message) => extractReasoning(message.raw)).join("|");
    if (steps > 1) return { text: "done", toolCalls: [] };
    return { text: "", toolCalls: [{ id: "c1", name: firstCall, arguments: {} }], raw: { role: "assistant", content: "", reasoning_content: THOUGHT } };
  } });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  try {
    await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-elide")) });
    await chatTurn(address, "look");
  } finally { await sidecar.stop(); }
  return seen;
}

test("a step whose calls all succeeded does not replay its reasoning", async () => {
  const seen = await reasoningSeenOnStepTwo("ae_get_project_overview");
  assert.ok(seen.length > 0 && seen.length < THOUGHT.length, `the placeholder replaces the thought, got ${seen.length} chars`);
});

test("a step that was refused keeps its reasoning for the correction", async () => {
  assert.equal(await reasoningSeenOnStepTwo("ae_no_such_tool"), THOUGHT);
});

test("the newest turn keeps Anthropic's signed thinking blocks: the API requires them on the live tool-use turn", () => {
  const blocks = [
    { type: "thinking", thinking: THOUGHT, signature: "sig" },
    { type: "redacted_thinking", data: "opaque" },
    { type: "tool_use", id: "c1", name: "ae_get_project_overview", input: {} },
  ];
  const messages: AgentMessage[] = [{ role: "user", content: "go" }, { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "ae_get_project_overview", arguments: {} }], raw: blocks }];
  elideSpentReasoning(messages);
  const assistant = messages[1];
  assert.ok(assistant?.role === "assistant" && assistant.raw === blocks);
  const wrapped: AgentMessage[] = [{ role: "assistant", content: "", raw: { role: "assistant", content: blocks } }];
  elideSpentReasoning(wrapped);
  assert.equal(extractReasoning(wrapped[0]?.role === "assistant" ? wrapped[0].raw : undefined).length > 0, true);
});

test("the budget fold drops signed thinking from older messages instead of editing its text", () => {
  const messages: AgentMessage[] = [];
  for (let index = 0; index < 6; index += 1) {
    messages.push({ role: "assistant", content: "", toolCalls: [{ id: `c${index}`, name: "ae_get_project_overview", arguments: {} }], raw: [{ type: "thinking", thinking: "r".repeat(40_000), signature: "sig" }, { type: "tool_use", id: `c${index}`, name: "ae_get_project_overview", input: {} }] });
    messages.push({ role: "tool", toolCallId: `c${index}`, name: "ae_get_project_overview", content: "ok" });
  }
  foldOldToolResults(messages, 20_000);
  const first = messages[0];
  assert.ok(first?.role === "assistant" && Array.isArray(first.raw) && first.raw.every((block: { type?: string }) => block.type !== "thinking"));
});
