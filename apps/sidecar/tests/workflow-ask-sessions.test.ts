// A question the agent asked belongs to the chat it was asked in: another chat's first message is never read as its answer.
import assert from "node:assert/strict";
import test from "node:test";

import { MockProvider } from "@extynt/llm";
import { WORKFLOW_ASK_TOOL } from "../src/agent.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";

const ASKING = "Make a rocket";

function askingProvider(): MockProvider {
  return new MockProvider({
    script: async (input) => {
      const asks = input.messages.some((msg) => msg.role === "user" && msg.content.startsWith(ASKING)) && !input.messages.some((msg) => msg.content === "Six seconds");
      if (!asks) return { text: "Done.", toolCalls: [] };
      const tools = input.messages.filter((msg) => msg.role === "tool").length;
      if (tools === 0) return workflowStageStep("sessions-1", "Understand the request", ["create_layer"]);
      if (tools === 1) return { text: "How long?", toolCalls: [{ id: "sessions-ask", name: WORKFLOW_ASK_TOOL, arguments: { question: "How long?" } }] };
      return { text: "Done.", toolCalls: [] };
    },
  });
}

async function started(t: test.TestContext) {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: askingProvider(), quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-sessions")) });
  return { sidecar, address };
}

function newestGoal(sidecar: Awaited<ReturnType<typeof started>>["sidecar"]): string {
  return Object.values(sidecar.workflowCoordinator.workflowStore.getState().jobs).at(-1)?.goalSummary ?? "";
}

test("a question asked in chat A is not the answer to chat B's first message", async (t) => {
  const { sidecar, address } = await started(t);
  await chatTurn(address, ASKING, [], { autoApply: true, sessionId: "chat-a" });
  assert.ok(sidecar.carriedRequests.has("chat-a"), "chat A holds its question");
  await chatTurn(address, "Add a blue square", [], { autoApply: true, sessionId: "chat-b" });
  assert.equal(newestGoal(sidecar), "Add a blue square", "chat B's goal is its own message alone");
  assert.ok(sidecar.carriedRequests.has("chat-a"), "chat A's question is untouched by chat B");
});

test("chat A's question stays answerable when chat A continues", async (t) => {
  const { sidecar, address } = await started(t);
  await chatTurn(address, ASKING, [], { autoApply: true, sessionId: "chat-a" });
  await chatTurn(address, "Add a blue square", [], { autoApply: true, sessionId: "chat-b" });
  await chatTurn(address, "Six seconds", [{ role: "user", content: ASKING }, { role: "assistant", content: "How long?" }], { autoApply: true, sessionId: "chat-a" });
  const goal = newestGoal(sidecar);
  assert.ok(goal.includes(ASKING) && goal.includes("The user answered: Six seconds"), "chat A's reply carries its original request");
  assert.ok(!goal.includes("blue square"), "chat B's message is not mixed in");
  assert.equal(sidecar.carriedRequests.has("chat-a"), false, "chat A's question is consumed");
});

test("questions from different chats do not stack into a later chat's goal", async (t) => {
  const { sidecar, address } = await started(t);
  await chatTurn(address, `${ASKING} one`, [], { autoApply: true, sessionId: "chat-a" });
  await chatTurn(address, `${ASKING} two`, [], { autoApply: true, sessionId: "chat-b" });
  assert.equal(sidecar.carriedRequests.size, 2, "each chat holds its own question");
  await chatTurn(address, "Add a blue square", [], { autoApply: true, sessionId: "chat-c" });
  const goal = newestGoal(sidecar);
  assert.equal(goal, "Add a blue square", "chat C starts clean");
  assert.ok(!goal.includes("one") && !goal.includes("two"), "no earlier chat's text is stacked");
});
