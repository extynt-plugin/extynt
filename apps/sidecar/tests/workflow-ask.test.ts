// The ae_ask_user tool: asking the user carries the request, its goal and any specialist handoff over to the turn that answers.
import assert from "node:assert/strict";
import test from "node:test";

import { MockProvider } from "@extynt/llm";
import { agentToolSpecs, WORKFLOW_ASK_TOOL } from "../src/agent.js";
import { authorization, chatTurn, mutableSnapshot, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { CARRIED_REQUEST_TTL_MS, takeCarriedRequest, type CarriedRequest } from "../src/server-workflow-carry.js";

test("ae_ask_user is included when workflowStage is true", () => {
  const withoutWorkflow = agentToolSpecs({});
  assert.equal(withoutWorkflow.some((tool) => tool.name === WORKFLOW_ASK_TOOL), false, "ae_ask_user is not included by default");
  const withWorkflow = agentToolSpecs({ workflowStage: true });
  assert.equal(withWorkflow.some((tool) => tool.name === WORKFLOW_ASK_TOOL), true, "ae_ask_user is included when workflowStage is true");
  const askSpec = withWorkflow.find((tool) => tool.name === WORKFLOW_ASK_TOOL);
  assert.ok(askSpec?.description?.includes("question"), "ae_ask_user spec describes asking the user");
});

test("the owner's first step calls ae_ask_user → outcome answered, no stage selected", async (t) => {
  const provider = new MockProvider({
    script: async () => ({
      text: "I need to clarify what you want.",
      toolCalls: [{ id: "ask-1", name: WORKFLOW_ASK_TOOL, arguments: { question: "Should this be 6 seconds or 30 seconds?" } }],
    }),
  });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());

  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(mutableSnapshot("probe-ask")),
  });

  const result = await chatTurn(address, "Make a 6-second rocket animation", [], { autoApply: true });
  assert.equal(result.ok, true, "chat turn succeeded");
  assert.equal(result.outcome, "answered", "outcome is answered when ae_ask_user was called");
  assert.equal(result.answer, "Should this be 6 seconds or 30 seconds?", "answer equals the question");
  const askTool = result.tools.find((entry) => entry.name === WORKFLOW_ASK_TOOL);
  assert.equal(askTool?.ok, true, "ae_ask_user tool succeeded");
  assert.equal(result.approval, undefined, "a plain question waits for an answer, not an approval");
  assert.equal(provider.calls, 1, "provider was called exactly once when loop stopped");
  assert.equal(sidecar.workflowCoordinator.workflowStore.getState().activeJobId, null, "workflow engine is free after asking");
});

test("owner selects stage then calls ae_ask_user with kind design-brief → outcome answered", async (t) => {
  const provider = new MockProvider({
    script: async (step) => {
      const toolMessages = step.messages.filter((msg) => msg.role === "tool").length;
      if (toolMessages === 0) {
        return workflowStageStep("ask-stage", "Build the scene", ["create_layer"]);
      }
      return { text: "", toolCalls: [{ id: "ask-2", name: WORKFLOW_ASK_TOOL, arguments: { question: "Layer 1 at (0, 0), Layer 2 at (100, 100). Approve?", kind: "design-brief" } }] };
    },
  });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());

  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(mutableSnapshot("probe-brief")),
  });

  const result = await chatTurn(address, "Build a scene with two layers", [], { autoApply: true });
  assert.equal(result.outcome, "answered", "outcome is answered even after stage selection");
  const askTool = result.tools.find((entry) => entry.name === WORKFLOW_ASK_TOOL);
  assert.equal(askTool?.ok, true, "ae_ask_user design-brief succeeded");
  assert.deepEqual(result.approval, { kind: "design-brief" }, "the reply tells the panel a design is waiting for approval");
});

test("direct runAgentTool calls reject based on conditions", async (t) => {
  const sidecar = sidecarFor({ port: 0, token, chatProvider: new MockProvider({ answer: "" }), quietAgentLog: true });
  await sidecar.start();
  t.after(() => sidecar.stop());

  const baseInput = {
    requestId: "direct-ask",
    message: "Test",
    history: [],
    autoApply: true,
    workflowGoalSummary: "Test",
    workflowRole: WORKFLOW_OWNER,
    workflowCycle: 0,
  };

  const withoutJobId = await sidecar.runAgentTool(WORKFLOW_ASK_TOOL, { question: "Q?" }, baseInput, {});
  assert.equal(withoutJobId.ok, false, "missing workflowJobId → error");
  assert.equal(withoutJobId.error?.code, "ASK_UNAVAILABLE");

  const continuationCycle = await sidecar.runAgentTool(
    WORKFLOW_ASK_TOOL,
    { question: "Q?" },
    { ...baseInput, workflowJobId: "test-job", workflowCycle: 1 },
    {},
  );
  assert.equal(continuationCycle.ok, false, "cycle > 0 → error");
  assert.equal(continuationCycle.error?.code, "ASK_NOT_IN_CONTINUATION");

  const missingQuestion = await sidecar.runAgentTool(
    WORKFLOW_ASK_TOOL,
    { question: "" },
    { ...baseInput, workflowJobId: "test-job" },
    {},
  );
  assert.equal(missingQuestion.ok, false, "empty question → error");
  assert.equal(missingQuestion.error?.code, "INVALID_ARGUMENT");
});

test("ae_ask_user rejects when queue holds operations", async (t) => {
  let step = 0;
  const provider = new MockProvider({
    script: async () => {
      step++;
      if (step === 1) return workflowStageStep("qask-1", "Rename", ["set_layer_name"]);
      if (step === 2) {
        return {
          text: "",
          toolCalls: [{ id: "qask-add", name: "ae_queue_add", arguments: { summary: "Rename", operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" }, name: "Renamed" }] } }],
        };
      }
      return { text: "", toolCalls: [{ id: "qask-ask", name: WORKFLOW_ASK_TOOL, arguments: { question: "Ready?" } }] };
    },
  });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());

  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(mutableSnapshot("probe-queue")),
  });

  const result = await chatTurn(address, "Rename the layer", [], { autoApply: true });
  const askTool = result.tools.find((entry) => entry.name === WORKFLOW_ASK_TOOL);
  assert.equal(askTool?.ok, false, "ae_ask_user failed when queue held operations");
  assert.equal(askTool?.code, "ASK_AFTER_QUEUE");
});

test("carry the goal: turn 1 asks user, turn 2 continues with reply + history", async (t) => {
  let calledAsk = false;
  const provider = new MockProvider({
    script: async (input) => {
      if (calledAsk) return { text: "Got it, trimmed to 6 seconds.", toolCalls: [] };
      const toolMessages = input.messages.filter((msg) => msg.role === "tool").length;
      if (toolMessages === 0) {
        return workflowStageStep("carry-1", "Understand the request", ["create_layer"]);
      }
      if (toolMessages === 1) {
        calledAsk = true;
        return { text: "I need to know the duration.", toolCalls: [{ id: "carry-ask", name: WORKFLOW_ASK_TOOL, arguments: { question: "Should this be 6 seconds or 30 seconds?" } }] };
      }
      return { text: "Done.", toolCalls: [] };
    },
  });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: provider, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());

  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, {
    method: "POST",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify(mutableSnapshot("probe-carry-goal")),
  });

  const turn1 = await chatTurn(address, "Make a rocket animation", [], { autoApply: true });
  assert.equal(turn1.outcome, "answered", "turn 1 outcome is answered when ae_ask_user was called");
  assert.ok(sidecar.carriedRequests.get("")?.goal.includes("Make a rocket animation"), "carried goal includes turn 1 message");

  const turn2 = await chatTurn(address, "Trim it to 6 seconds", [
    { role: "user", content: "Make a rocket animation" },
    { role: "assistant", content: "Should this be 6 seconds or 30 seconds?" },
  ], { autoApply: true });
  assert.equal(turn2.outcome, "answered", "turn 2 outcome is answered");
  const jobs = sidecar.workflowCoordinator.workflowStore.getState().jobs;
  const newestJob = Object.values(jobs).at(-1);
  assert.ok(newestJob?.goalSummary.includes("Make a rocket animation"), "newest job goal includes original request");
  assert.ok(newestJob?.goalSummary.includes("The user answered: Trim it to 6 seconds"), "newest job goal includes user answer");
  assert.equal(sidecar.carriedRequests.size, 0, "carried request cleared after turn 2");
});

function designOwner(onSecondTurn: (system: string) => void): MockProvider {
  return new MockProvider({
    script: async (step) => {
      if (step.messages.some((msg) => msg.role === "user" && msg.content === "Looks good")) {
        onSecondTurn(step.system);
        return { text: "Building it.", toolCalls: [] };
      }
      const toolCalls = step.messages.filter((msg) => msg.role === "tool").length;
      if (toolCalls === 0) return { text: "", toolCalls: [{ id: "launch", name: "ae_consult_specialist", arguments: { action: "launch", role: "visual-scene", instruction: "Design the scene." } }] };
      if (toolCalls === 1) return { text: "", toolCalls: [{ id: "wait", name: "ae_consult_specialist", arguments: { action: "wait", role: "visual-scene", waitSeconds: 5 } }] };
      return { text: "", toolCalls: [{ id: "brief", name: WORKFLOW_ASK_TOOL, arguments: { question: "Planet with a split ring. Approve?", kind: "design-brief" } }] };
    },
  });
}

test("carry the design: a specialist handoff made before the question reaches the reply's job", async (t) => {
  const specialist = new MockProvider({ script: async () => ({ text: "Planet with split ring", toolCalls: [] }) });
  let turn2SystemPrompt: string | undefined;
  const owner = designOwner((system) => { turn2SystemPrompt = system; });
  const sidecar = sidecarFor({ port: 0, token, chatProvider: owner, workflowSpecialistProviders: { "visual-scene": specialist }, quietAgentLog: true });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  await fetch(`http://${address.host}:${address.port}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("probe-carry-design-specialist")) });
  const turn1 = await chatTurn(address, "Build a planet with a ring", [], { autoApply: true });
  assert.equal(turn1.outcome, "answered", "turn 1 outcome is answered");
  assert.equal(sidecar.carriedRequests.get("")?.sessions?.get("visual-scene")?.brief?.objective, "Planet with split ring", "carried request has specialist brief");
  assert.ok(sidecar.carriedRequests.get("")?.bundle, "carried request has bundle");
  assert.equal(sidecar.workflowSpecialistSessions.size, 0, "specialist sessions moved out, not left on cancelled job");
  await chatTurn(address, "Looks good", [{ role: "user", content: "Build a planet with a ring" }, { role: "assistant", content: "Planet with a split ring. Approve?" }], { autoApply: true });
  assert.ok(turn2SystemPrompt?.includes("ORCHESTRATOR/VALIDATOR OWNERSHIP CONTRACT"), "turn 2 system prompt contains orchestration briefing");
  assert.ok(turn2SystemPrompt?.includes("Planet with split ring"), "turn 2 system prompt contains specialist objective");
  assert.equal(specialist.calls, 1, "specialist was not called again");
  assert.equal(sidecar.carriedRequests.size, 0, "carried request cleared after turn 2");
});

test("takeCarriedRequest clears stale requests and always clears the slot", async () => {
  const now = Date.now();
  const carried: CarriedRequest = {
    goal: "Test goal",
    question: "Test question?",
    kind: "question",
    savedAt: now - CARRIED_REQUEST_TTL_MS - 1,
  };

  const state = { carriedRequests: new Map([["", carried]]) };
  const result = takeCarriedRequest(state, { now });
  assert.equal(result, undefined, "stale request returns undefined");
  assert.equal(state.carriedRequests.size, 0, "slot cleared even for stale request");

  const freshCarried: CarriedRequest = {
    goal: "Fresh goal",
    question: "Fresh question?",
    kind: "design-brief",
    savedAt: now - 1000,
  };
  state.carriedRequests.set("", freshCarried);
  const fresh = takeCarriedRequest(state, { now });
  assert.ok(fresh, "fresh request is returned");
  assert.equal(state.carriedRequests.size, 0, "slot cleared for fresh request");
});
