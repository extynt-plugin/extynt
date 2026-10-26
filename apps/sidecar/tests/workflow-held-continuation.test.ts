/** Design-first holds across a batch whose read-back is incomplete, and the completion answers that follow (slice H2). */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import { chatTurn, DESIGNER_REPORT } from "./sidecar-fixture.js";
import { rigFor, step, toolCalls } from "./single-loop-rig.js";

function specialistReply(role: string): string {
  const handoff = JSON.stringify({ role, objective: "o", requirements: ["r"], deliverables: ["d"], constraints: ["c"], verification: ["v"] });
  return role === "visual-scene" ? DESIGNER_REPORT : handoff;
}

const RINGS_OPS = [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:rings" }, layerType: "shape", name: "Rings" }];
const ringsKeys = (layerId: string) => ({ type: "animate_property", target: { compositionId: "comp-1", layerId, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 10] }] });

test("a design batch that applied but could not read every op back still releases the held animation, and completion never says HELD", async (t) => {
  const specialist = new MockProvider({ script: async (input) => ({ text: specialistReply(/visual-scene specialist/.test(input.system ?? "") ? "visual-scene" : "motion"), toolCalls: [] }) });
  const results = new Map<string, string>();
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    for (const message of input.messages) if (message.role === "tool") results.set(String(message.toolCallId), String(message.content));
    if (!called.includes("ae_consult_specialist")) return step("h-launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design cyan rings in comp-1, 1920x1080, 10 s, 30 fps." });
    if (called.filter((name) => name === "ae_consult_specialist").length === 1) return step("h-wait", "ae_consult_specialist", { action: "wait", role: "visual-scene", waitSeconds: 5 });
    if (!called.includes("ae_queue_add")) return step("h-add", "ae_queue_add", { summary: "Build and move the rings", operations: [...RINGS_OPS, ringsKeys("__new__:rings")] });
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (finishes < 1) return step(`h-finish-${finishes}`, "ae_queue_finish", {});
    if (!called.includes("ae_workflow_complete")) return step("h-complete", "ae_workflow_complete", { summary: "done" });
    return { text: "Built and animated the rings.", toolCalls: [] };
  }, "single-loop-h2", [["create_layer", "add_marker?"], ["animate_property"]], specialist);
  rig.bindCreated = true;
  await chatTurn(rig.address, "Draw thin cyan rings in the middle of the comp and slide them", [], { autoApply: true });
  assert.match(results.get("h-finish-0") ?? "", /queued the 1 animation operation/, `the seal of an applied-but-unproven design still released the animation: ${results.get("h-finish-0")}`);
  assert.equal([...rig.sidecar.workflowHeldAnimation.values()].flat().length, 0, "nothing is left held");
  assert.doesNotMatch(results.get("h-complete") ?? "", /HELD_ANIMATION/, `completion never says HELD with an empty ledger: ${results.get("h-complete")}`);
});

test("animating an existing layer after a build takes the missing frame check itself instead of refusing for it", async (t) => {
  const specialist = new MockProvider({ script: async (input) => ({ text: specialistReply(/visual-scene specialist/.test(input.system ?? "") ? "visual-scene" : "motion"), toolCalls: [] }) });
  const results = new Map<string, string>();
  let called: Array<string | undefined> = [];
  const rig = await rigFor(t, (input) => {
    called = toolCalls(input);
    for (const message of input.messages) if (message.role === "tool") results.set(String(message.toolCallId), String(message.content));
    if (!called.includes("ae_consult_specialist")) return step("m-launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design a rings layer in comp-1, 1920x1080, 10 s, 30 fps." });
    if (called.filter((name) => name === "ae_consult_specialist").length === 1) return step("m-wait", "ae_consult_specialist", { action: "wait", role: "visual-scene", waitSeconds: 5 });
    const adds = called.filter((name) => name === "ae_queue_add").length;
    if (adds === 0) return step("m-add-0", "ae_queue_add", { summary: "Build the rings", operations: RINGS_OPS });
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (finishes === 0) return step("m-finish-0", "ae_queue_finish", {});
    if (adds === 1) return step("m-add-1", "ae_queue_add", { summary: "Move the first layer", operations: [ringsKeys("layer-1")] });
    return { text: "Built the rings and moved layer 1.", toolCalls: [] };
  }, "single-loop-h2-gate", [["create_layer"]], specialist);
  rig.bindCreated = true;
  rig.captured = [];
  await chatTurn(rig.address, "Add a layer named Halo to comp-1 and put it on top", [], { autoApply: true });
  assert.doesNotMatch(results.get("m-add-1") ?? "", /WORKFLOW_FRAME_CHECK_REQUIRED/, `the animation was not refused for a frame the sidecar can take: ${results.get("m-add-1")}`);
  assert.ok(!called.includes("ae_capture_composition_frame"), "the model captured nothing by hand");
  assert.ok((rig.captured ?? []).length >= 1, "the sidecar took the frame itself");
});

test("held animation never waits for the model to capture: the seal takes the frame itself even when the read-back already proves the job", async (t) => {
  const specialist = new MockProvider({ script: async (input) => ({ text: specialistReply(/visual-scene specialist/.test(input.system ?? "") ? "visual-scene" : "motion"), toolCalls: [] }) });
  const results = new Map<string, string>();
  let called: Array<string | undefined> = [];
  const rig = await rigFor(t, (input) => {
    called = toolCalls(input);
    for (const message of input.messages) if (message.role === "tool") results.set(String(message.toolCallId), String(message.content));
    if (!called.includes("ae_consult_specialist")) return step("k-launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design a rings layer in comp-1, 1920x1080, 10 s, 30 fps." });
    if (called.filter((name) => name === "ae_consult_specialist").length === 1) return step("k-wait", "ae_consult_specialist", { action: "wait", role: "visual-scene", waitSeconds: 5 });
    if (!called.includes("ae_queue_add")) return step("k-add", "ae_queue_add", { summary: "Build and move the rings", operations: [...RINGS_OPS, ringsKeys("__new__:rings")] });
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (finishes < 1) return step(`k-finish-${finishes}`, "ae_queue_finish", {});
    if (!called.includes("ae_workflow_complete")) return step("k-complete", "ae_workflow_complete", { summary: "done" });
    return { text: "Built and animated the rings.", toolCalls: [] };
  }, "single-loop-h2-frame", [["create_layer"], ["animate_property"]], specialist);
  rig.bindCreated = true;
  rig.captured = [];
  await chatTurn(rig.address, "Add a layer named Halo to comp-1 and put it on top", [], { autoApply: true });
  assert.match(results.get("k-finish-0") ?? "", /queued the 1 animation operation/, `the seal released the animation: ${results.get("k-finish-0")}`);
  assert.ok(!called.includes("ae_capture_composition_frame") && !called.includes("ae_observe_frame"), "the model captured nothing by hand");
  assert.ok((rig.captured ?? []).length >= 1, "the sidecar took the frame itself");
  assert.equal([...rig.sidecar.workflowHeldAnimation.values()].flat().length, 0, "nothing is left held");
});
