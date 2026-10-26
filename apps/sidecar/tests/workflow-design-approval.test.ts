/** A job that draws new artwork stops at a design brief the user approves before anything is built, whatever the model chooses to do. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { AgentStepInput, AgentStepResult } from "@extynt/llm";
import { chatTurn } from "./sidecar-fixture.js";
import { rigWith, step, toolCalls } from "./single-loop-rig.js";

const PLAIN = "Design a logo for a coffee shop called Ember, then animate it in";
const REQUEST = `${PLAIN}. Show me the design first and wait for my go-ahead.`;
const LAUNCH = { action: "launch", role: "visual-scene", instruction: "Draw the Ember logo in Main (comp-1), 1920x1080, 10 s." };
const BRIEF = { question: "Cup, flame and wordmark in amber on dark brown, flame flickers in. Build it?", kind: "design-brief" };

function launches(input: AgentStepInput): AgentStepResult {
  return step(`launch-${toolCalls(input).length}`, "ae_consult_specialist", LAUNCH);
}

function startRig(t: TestContext, script: (input: AgentStepInput) => AgentStepResult) {
  return rigWith(t, script, "approval", [["create_layer"]], { workflowDesignApproval: true });
}

test("a model that launches the designer without asking is held, then the sidecar sends the brief itself", async (t) => {
  const rig = await startRig(t, launches);
  const turn = await chatTurn(rig.address, REQUEST, [], { autoApply: true });
  assert.deepEqual(turn.approval, { kind: "design-brief" }, JSON.stringify(turn));
  assert.deepEqual(turn.tools.map((tool) => tool.code), ["DESIGN_APPROVAL_REQUIRED", undefined]);
  assert.equal(turn.plans.length, 0, "nothing was built before the user approved");
  assert.ok(turn.answer.includes("Ember"), "the brief carries the request");
  assert.ok(turn.answer.includes("Build it"), "the brief tells the user how to approve");
});

test("a model told to write the brief itself gets its own words on the card", async (t) => {
  const rig = await startRig(t, (input) => (toolCalls(input).length === 0 ? launches(input) : step("ask", "ae_ask_user", BRIEF)));
  const asked = await chatTurn(rig.address, REQUEST, [], { autoApply: true });
  assert.deepEqual(asked.approval, { kind: "design-brief" }, JSON.stringify(asked));
  assert.equal(asked.answer, BRIEF.question);
});

test("after the user approves the brief the designer launches without another hold", async (t) => {
  let turns = 0;
  const rig = await startRig(t, (input) => {
    if (toolCalls(input).length > 0) return { text: "Done.", toolCalls: [] };
    turns += 1;
    return turns === 1 ? step("ask", "ae_ask_user", BRIEF) : launches(input);
  });
  const asked = await chatTurn(rig.address, REQUEST, [], { autoApply: true });
  assert.deepEqual(asked.approval, { kind: "design-brief" });
  const built = await chatTurn(rig.address, "Build it", [], { autoApply: true });
  assert.equal(built.approval, undefined, JSON.stringify(built));
  assert.equal(built.tools.some((tool) => tool.code === "DESIGN_APPROVAL_REQUIRED"), false, "an approved design is not held again");
});

test("a plain question does not count as approval of a design", async (t) => {
  let turns = 0;
  const rig = await startRig(t, (input) => {
    if (toolCalls(input).length > 0) return { text: "Done.", toolCalls: [] };
    turns += 1;
    return turns === 1 ? step("ask", "ae_ask_user", { question: "Which size should the logo be?" }) : launches(input);
  });
  await chatTurn(rig.address, REQUEST, [], { autoApply: true });
  const answered = await chatTurn(rig.address, "1080 square", [], { autoApply: true });
  assert.equal(answered.tools[0]?.code, "DESIGN_APPROVAL_REQUIRED", JSON.stringify(answered));
});

test("drawing shape layers by hand is held for the design brief too", async (t) => {
  const shape = { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:flame" }, layerType: "shape", name: "Flame" };
  const rig = await startRig(t, (input) => step(`queue-${toolCalls(input).length}`, "ae_queue_add", { operations: [shape] }));
  const turn = await chatTurn(rig.address, REQUEST, [], { autoApply: true });
  assert.deepEqual(turn.approval, { kind: "design-brief" }, JSON.stringify(turn));
  assert.equal(turn.tools[0]?.code, "DESIGN_APPROVAL_REQUIRED");
  assert.equal(turn.plans.length, 0);
});

test("a plain design request is not held", async (t) => {
  const rig = await startRig(t, (input) => (toolCalls(input).length === 0 ? launches(input) : { text: "Done.", toolCalls: [] }));
  const turn = await chatTurn(rig.address, PLAIN, [], { autoApply: true });
  assert.equal(turn.approval, undefined, JSON.stringify(turn));
  assert.equal(turn.tools.some((tool) => tool.code === "DESIGN_APPROVAL_REQUIRED"), false);
});

test("the sidecar's own brief is in the language of the request", async (t) => {
  const rig = await startRig(t, launches);
  const turn = await chatTurn(rig.address, "Diseña un logo para Ember y muéstrame el diseño primero", [], { autoApply: true });
  assert.deepEqual(turn.approval, { kind: "design-brief" }, JSON.stringify(turn));
  assert.ok(turn.answer.startsWith("Este es el diseño"), turn.answer);
});
