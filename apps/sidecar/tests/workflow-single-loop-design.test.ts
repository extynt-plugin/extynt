/** A job with a scene design keeps building in one conversation, and holds the animation until the design's seal releases it. */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import { present } from "./agent-test-support.js";
import { fieldOf } from "./http-json.js";
import { chatTurn, DESIGNER_REPORT } from "./sidecar-fixture.js";
import { rigFor, step, toolCalls } from "./single-loop-rig.js";
import { jobFacts } from "./workflow-cycle-fixtures.js";

function specialistReply(role: string): string {
  const handoff = JSON.stringify({ role, objective: "o", requirements: ["r"], deliverables: ["d"], constraints: ["c"], verification: ["v"] });
  return role === "visual-scene" ? DESIGNER_REPORT : handoff;
}

const RINGS_OPS = [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:rings" }, layerType: "shape", name: "Rings" }];

test("a job with a scene design keeps building in the same conversation after its build batch settles", async (t) => {
  const specialist = new MockProvider({ script: async (input) => ({ text: specialistReply(/visual-scene specialist/.test(input.system ?? "") ? "visual-scene" : "motion"), toolCalls: [] }) });
  let answeredWith: string[] = [];
  let sealedReceipt = "";
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    if (!called.includes("ae_consult_specialist")) return step("d-launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design cyan rings in comp-1, 1920x1080, 10 s, 30 fps." });
    if (called.filter((name) => name === "ae_consult_specialist").length === 1) return step("d-wait", "ae_consult_specialist", { action: "wait", role: "visual-scene", waitSeconds: 5 });
    if (!called.includes("ae_queue_add")) return step("d-add", "ae_queue_add", { summary: "Build the rings", operations: RINGS_OPS });
    if (!called.includes("ae_queue_finish")) return step("d-finish", "ae_queue_finish", {});
    answeredWith = called;
    sealedReceipt = String(input.messages.find((message) => message.role === "tool" && message.name === "ae_queue_finish")?.content);
    return { text: "Built the rings.", toolCalls: [] };
  }, "single-loop-designed", [["create_layer?"]], specialist);
  const reply = await chatTurn(rig.address, "Draw thin cyan rings in the middle of the comp", [], { autoApply: true });
  assert.equal(rig.applied.length, 1, `the build batch applied: ${JSON.stringify(reply)}`);
  assert.deepEqual(answeredWith, ["ae_consult_specialist", "ae_consult_specialist", "ae_queue_add", "ae_queue_finish"], "the answer came in the same conversation that designed and built the scene, with no capture or observe call of its own");
  assert.match(sealedReceipt, /contentFraction/, "the seal's receipt carried the frame the sidecar measured");
  assert.deepEqual(jobFacts(rig).statuses, ["completed"], "the designed job closed from its receipts");
});

const ringsKeys = (layerId: string) => ({ type: "animate_property", target: { compositionId: "comp-1", layerId, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 10] }] });

test("design first end to end: a mixed call stages the design, the seal's verified receipt and frame release the held animation, and it is sealed without being re-authored", async (t) => {
  const specialist = new MockProvider({ script: async (input) => ({ text: specialistReply(/visual-scene specialist/.test(input.system ?? "") ? "visual-scene" : "motion"), toolCalls: [] }) });
  const results = new Map<string, string>();
  const rig = await rigFor(t, (input) => {
    const called = toolCalls(input);
    for (const message of input.messages) if (message.role === "tool") results.set(String(message.toolCallId), String(message.content));
    if (!called.includes("ae_consult_specialist")) return step("e-launch", "ae_consult_specialist", { action: "launch", role: "visual-scene", instruction: "Design cyan rings in comp-1, 1920x1080, 10 s, 30 fps." });
    if (called.filter((name) => name === "ae_consult_specialist").length === 1) return step("e-wait", "ae_consult_specialist", { action: "wait", role: "visual-scene", waitSeconds: 5 });
    if (!called.includes("ae_queue_add")) return step("e-add", "ae_queue_add", { summary: "Build and move the rings", operations: [...RINGS_OPS, ringsKeys("__new__:rings")] });
    const finishes = called.filter((name) => name === "ae_queue_finish").length;
    if (finishes < 1) return step(`e-finish-${finishes}`, "ae_queue_finish", {});
    return { text: "Built and animated the rings.", toolCalls: [] };
  }, "single-loop-design-first", [["create_layer"], ["animate_property"]], specialist);
  rig.bindCreated = true;
  const reply = await chatTurn(rig.address, "Draw thin cyan rings in the middle of the comp and slide them", [], { autoApply: true });

  assert.match(results.get("e-add") ?? "", /held by the sidecar and will be queued automatically/, `the mixed call staged the design and held the animation: ${results.get("e-add")}`);
  assert.match(results.get("e-finish-0") ?? "", /"next":"The sidecar queued the 1 animation operation\(s\) it held/, `the design seal's own answer leads with the release and says it sealed it: ${results.get("e-finish-0")}`);
  assert.match(results.get("e-finish-0") ?? "", /"sealedAnimation":\[\{"sealed":true/, "the released animation was sealed in the same call and its receipt returned");
  assert.equal(rig.applied.length, 2, `the design batch and then the released animation batch applied: ${JSON.stringify(reply)}`);
  const designOps = rig.sidecar.plans.get(present(rig.applied[0]))?.plan.operations ?? [];
  assert.deepEqual(designOps.map((operation) => fieldOf(operation, "type")), ["create_layer"], "the design batch held only the static scene");
  const animation = rig.sidecar.plans.get(present(rig.applied[1]))?.plan.operations ?? [];
  assert.deepEqual(animation.map((operation) => [fieldOf(operation, "type"), fieldOf(operation, "target.layerId")]), [["animate_property", "layer-101"]], "the held animation was queued against the created layer's id");
  assert.equal([...rig.sidecar.workflowHeldAnimation.values()].flat().length, 0, "nothing is left held");
  assert.equal(rig.provider.calls, 5, "launch, wait, the mixed call, one seal that also sealed the released animation, and the answer: the animation was never authored twice");
  assert.equal(reply.answer, "Built and animated the rings.");
});
