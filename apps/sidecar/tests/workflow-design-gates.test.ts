/** The design-first gates: what the owner may queue before the scene is designed and built, and how held animation is split off and released. */
import type { JsonObject } from "@extynt/decode";
import type { ReadOnlySidecar } from "../src/server.js";
import assert from "node:assert/strict";
import test from "node:test";

import { MockProvider } from "@extynt/llm";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { frameCheckMissing, operationAnimates, type BuildHistory } from "../src/server-workflow-design.js";
import { closeSettledStage } from "../src/server-workflow-implicit-stage.js";
import { DESIGNER_REPORT, mutableSnapshot, sidecarFor, token } from "./sidecar-fixture.js";
import type { AgentCallState } from "../src/server-chat-agent-types.js";
import { operationsOf } from "../src/server-workflow-design-receipts.js";
import { payload, targetLayerId, type ToolResult } from "../src/server-workflow-operation-json.js";
import { present } from "./agent-test-support.js";
import { fieldOf, listOf, maybeTextOf } from "./http-json.js";

const failureOf = (result: ToolResult) => (result.ok ? undefined : result.error);
const dataOf = (result: ToolResult): JsonObject => payload(result) ?? {};

const CREATE_CTRL = { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:ctrl" }, layerType: "null", name: "Control" };
const ANIMATE_CTRL = { type: "animate_property", target: { compositionId: "comp-1", layerId: "__new__:ctrl" }, propertyPath: "ADBE Transform Group/ADBE Position", keyframes: [{ time: 0, value: [100, 100] }] };

function workflowInput(id: string) {
  return { requestId: id, message: "test", history: [], autoApply: true, workflowJobId: id, workflowGoalSummary: "test", workflowRole: WORKFLOW_OWNER };
}

function specialistProvider(): MockProvider {
  return new MockProvider({ script: async (step) => ({ text: brief(/visual-scene specialist/.test(step.system ?? "") ? "visual-scene" : "motion"), toolCalls: [] }) });
}

async function designedJob(id: string) {
  const specialist = specialistProvider();
  const sidecar = sidecarFor({ token, chatProvider: specialist, workflowSpecialistProviders: { "visual-scene": specialist, motion: specialist }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot(id), receivedAt: "2026-09-24T00:00:00.000Z", bytes: 1 };
  const input = workflowInput(id);
  const state: AgentCallState = { workflowStage: { summary: "Build", operationTypes: ["create_layer", "animate_property"] } };
  const refused = await sidecar.runAgentTool("ae_queue_add", { operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:planet" }, layerType: "shape", name: "Planet" }] }, input, state);
  assert.equal(failureOf(refused)?.code, "WORKFLOW_DESIGN_REQUIRED", "a shape build waits for a design");
  for (const role of ["visual-scene", "motion"]) await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role, instruction: "Design the planet scene." }, input, state);
  await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, input, state);
  return { sidecar, input, state };
}

test("a plain layer is built and animated in one call with no specialists and no design", async () => {
  const specialist = specialistProvider();
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider({ answer: "test" }), workflowSpecialistProviders: { "visual-scene": specialist, motion: specialist }, quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("gate-plain"), receivedAt: "2026-09-24T00:00:00.000Z", bytes: 1 };
  const state = { workflowStage: { summary: "Build", operationTypes: ["create_layer", "animate_property"] } };
  const result = await sidecar.runAgentTool("ae_queue_add", {
    summary: "Red solid, text and a wiggling null",
    operations: [
      { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:bg" }, layerType: "solid", name: "Red Solid" },
      { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:title" }, layerType: "text", name: "Title" },
      CREATE_CTRL,
      ANIMATE_CTRL,
    ],
  }, workflowInput("gate-plain"), state);

  assert.equal(result.ok, true, "a solid, text and a null need no design, and the null may be animated in the same call");
  assert.equal(specialist.calls, 0, "no specialist was launched");
});

test("rule 2 — in a designed job, create and animate in one call stages the design and holds the animation", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-same");
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Create and animate control", operations: [CREATE_CTRL, positionKeys("__new__:ctrl")] }, input, state);

  assert.equal(result.ok, true, "the call is not refused");
  const data = dataOf(result);
  assert.equal(fieldOf(data, "designFirst.held"), 1, "one animation operation is held");
  assert.deepEqual(fieldOf(data, "designFirst.heldPositions"), [1], "the held operation is position 1 of the call");
  assert.match(maybeTextOf(data, "next") ?? "", /held by the sidecar and will be queued automatically.*do not resend them/, "the model is told plainly what happened");
  assert.equal(queuedTypes(sidecar).join(","), "create_layer", "only the design part reached the queue");
  assert.deepEqual(heldTypes(sidecar, input), ["animate_property"], "the animation is held, nothing lost");
});

test("rule 2 — a held operation the queue would refuse is refused now, at its call position, and nothing is staged or held", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-checked");
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Create and animate control", operations: [CREATE_CTRL, { ...positionKeys("__new__:ctrl"), fill: "red" }] }, input, state);

  assert.equal(result.ok, true, JSON.stringify(result));
  const data = dataOf(result);
  assert.equal(fieldOf(data, "accepted"), 0, "the call is refused as a whole");
  assert.deepEqual(listOf(data, "fix").map((entry) => [fieldOf(entry, "positions"), fieldOf(entry, "code")]), [[[1], "UNKNOWN_FIELD"]], "the held operation's refusal names its own position in the call");
  assert.equal(fieldOf(data, "designFirst.held"), 0, "nothing is held");
  assert.match(maybeTextOf(data, "next") ?? "", /nothing from this call was staged or held/, "the model is told to resend the whole call");
  assert.equal(queuedTypes(sidecar).length, 0, "nothing was staged");
  assert.equal(heldTypes(sidecar, input).length, 0, "nothing was deferred to release");
});

test("rule 2 — in a designed job, create in call A and animate in call B holds call B's animation", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-across");
  const result1 = await sidecar.runAgentTool("ae_queue_add", { summary: "Create control", operations: [CREATE_CTRL] }, input, state);
  assert.equal(result1.ok, true, "first ae_queue_add succeeds");

  const result2 = await sidecar.runAgentTool("ae_queue_add", { summary: "Animate control", operations: [positionKeys("__new__:ctrl")] }, input, state);
  assert.equal(result2.ok, true, "second ae_queue_add is not refused");
  assert.match(maybeTextOf(dataOf(result2), "next") ?? "", /nothing new was staged/, "the model is told nothing else was staged");
  assert.equal(queuedTypes(sidecar).join(","), "create_layer", "the queue still holds only the design");
  assert.deepEqual(heldTypes(sidecar, input), ["animate_property"], "the animation is held");
});

test("rule 2 — animating an existing layer is allowed in a designed job", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-existing");
  const result = await sidecar.runAgentTool("ae_queue_add", {
    summary: "Animate existing layer",
    operations: [{ type: "animate_property", target: { compositionId: "comp-1", layerId: "layer-1" }, propertyPath: "ADBE Transform Group/ADBE Position", keyframes: [{ time: 0, value: [100, 100] }] }],
  }, input, state);

  assert.equal(result.ok, true, "animating an existing layer is allowed");
});

async function specialistsSettled(sidecar: ReadOnlySidecar): Promise<void> {
  const running = () => [...sidecar.workflowSpecialistSessions.values()].some((sessions) => [...sessions.values()].some((session) => session.pending));
  for (let tick = 0; tick < 200 && running(); tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("rule 1 — design required refuses without launching, then allows once the model launched the specialists", async () => {
  const specialist = new MockProvider({
    script: async (step) => ({
      text: brief(/visual-scene specialist/.test(step.system ?? "") ? "visual-scene" : "motion"),
      toolCalls: [],
    }),
  });
  const sidecar = sidecarFor({
    token,
    chatProvider: specialist,
    workflowSpecialistProviders: { "visual-scene": specialist, motion: specialist },
    quietAgentLog: true,
  });
  sidecar.latest = { snapshot: mutableSnapshot("gate-rule-1-launch"), receivedAt: "2026-09-24T00:00:00.000Z", bytes: 1 };

  const input = { requestId: "gate-rule-1-launch", message: "test", history: [], autoApply: true, workflowJobId: "gate-rule-1-launch", workflowGoalSummary: "test", workflowRole: WORKFLOW_OWNER };
  const state = { workflowStage: { summary: "Build", operationTypes: ["create_layer"] } };

  const result1 = await sidecar.runAgentTool("ae_queue_add", {
    operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:planet" }, layerType: "shape", name: "Planet" }],
  }, input, state);

  assert.equal(result1.ok, false, "first ae_queue_add is refused");
  assert.equal(failureOf(result1)?.code, "WORKFLOW_DESIGN_REQUIRED", "refusal code is WORKFLOW_DESIGN_REQUIRED");
  assert.match(failureOf(result1)?.message ?? "", /Planet/, "error message contains layer name");
  assert.match(failureOf(result1)?.message ?? "", /ae_consult_specialist/, "the refusal tells the model to launch the designer");
  assert.equal(specialist.calls, 0, "the sidecar launched no specialist");
  for (const role of ["visual-scene", "motion"]) assert.equal((await sidecar.runAgentTool("ae_consult_specialist", { action: "launch", role, instruction: "Design the planet scene." }, input, state)).ok, true, `${role} launched by the model`);

  await specialistsSettled(sidecar);

  const waitInputVS = { ...input, workflowJobId: "gate-rule-1-launch" };
  const result2 = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "visual-scene", waitSeconds: 1 }, waitInputVS, state);
  assert.equal(result2.ok, true, "visual-scene specialist waits");
  assert.equal(fieldOf(dataOf(result2), "status"), "sleeping", "status is sleeping");

  const result3 = await sidecar.runAgentTool("ae_consult_specialist", { action: "wait", role: "motion", waitSeconds: 1 }, waitInputVS, state);
  assert.equal(result3.ok, true, "motion specialist waits");
  assert.equal(fieldOf(dataOf(result3), "status"), "sleeping", "status is sleeping");

  const result4 = await sidecar.runAgentTool("ae_queue_add", {
    operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:planet" }, layerType: "shape", name: "Planet" }],
  }, input, state);

  assert.equal(result4.ok, true, "ae_queue_add succeeds after specialists have completed");
});

test("rule 1 — no specialist providers, call allowed", async () => {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider({ answer: "test" }), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot("gate-rule-1-fallback"), receivedAt: "2026-09-24T00:00:00.000Z", bytes: 1 };

  const input = { requestId: "gate-rule-1-fallback", message: "test", history: [], autoApply: true, workflowJobId: "gate-rule-1-fallback", workflowGoalSummary: "test", workflowRole: WORKFLOW_OWNER };
  const state = { workflowStage: { summary: "Build", operationTypes: ["create_layer"] } };

  const result = await sidecar.runAgentTool("ae_queue_add", {
    operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:shape" }, layerType: "shape", name: "Shape" }],
  }, input, state);

  assert.equal(result.ok, true, "ae_queue_add is allowed without specialist providers");
});

test("rule 2 — an ae_queue_fix insert that animates a new layer is held, not refused", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-fix");
  await sidecar.runAgentTool("ae_queue_add", { summary: "Create control", operations: [CREATE_CTRL] }, input, state);
  const result = await sidecar.runAgentTool("ae_queue_fix", { edits: [{ op: "insert", index: 1, operation: positionKeys("__new__:ctrl") }] }, input, state);

  assert.equal(result.ok, true, "ae_queue_fix is not refused");
  assert.equal(fieldOf(dataOf(result), "designFirst.held"), 1, "the inserted animation is held");
  assert.deepEqual(heldTypes(sidecar, input), ["animate_property"], "nothing lost");
});

test("rule 2 — a split keeps every operation and maps the answer's positions back to the call", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-order");
  const createB = { type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:b" }, layerType: "null", name: "B" };
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Two nulls, one animated", operations: [CREATE_CTRL, positionKeys("__new__:ctrl"), createB] }, input, state);

  assert.equal(result.ok, true, JSON.stringify(result));
  const designFirst = fieldOf(dataOf(result), "designFirst");
  assert.deepEqual(fieldOf(designFirst, "designPositions"), [0, 2], "answer positions map back to the call");
  assert.deepEqual(fieldOf(designFirst, "heldPositions"), [1], "the animation's own position");
  assert.equal(queuedTypes(sidecar).length + heldTypes(sidecar, input).length, 3, "staged plus held is the whole call");
});

test("rule 2 — held animation waits for the design batch, then is queued with the created id and never re-authored", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-release");
  await sidecar.runAgentTool("ae_queue_add", { summary: "Create and animate control", operations: [CREATE_CTRL, positionKeys("__new__:ctrl")] }, input, state);
  const designPlanId = sidecar.openQueuePlanId ?? "";

  const early = await sidecar.runAgentTool("ae_workflow_complete", { summary: "done" }, input, state);
  assert.equal(early.ok ? undefined : early.error.code, "WORKFLOW_HELD_ANIMATION", "completion waits on the held animation");
  assert.match(early.ok ? "" : early.error.message, /applied and verified/, "it says what it waits on");
  assert.equal(heldTypes(sidecar, input).length, 1, "still held while the design batch is open");

  settleDesign(sidecar, designPlanId);

  const extra = positionKeys("layer-1");
  const next = await sidecar.runAgentTool("ae_queue_add", { summary: "More motion", operations: [extra] }, input, state);
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.match(maybeTextOf(dataOf(next), "heldAnimation") ?? "", /queued the 1 animation operation/, "the model is told the held work was queued");
  assert.equal(heldTypes(sidecar, input).length, 0, "nothing is held any more");
  const queued = queuedOperations(sidecar);
  assert.deepEqual(queued.map(targetLayerId), ["layer-77", "layer-1"], "the held animation was rebound to the created id and queued first");
});

test("rule 2 — a design batch that did not verify hands the held animation back at completion instead of losing it", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-failed");
  await sidecar.runAgentTool("ae_queue_add", { summary: "Create and animate control", operations: [CREATE_CTRL, positionKeys("__new__:ctrl")] }, input, state);
  settleVerified(sidecar, sidecar.openQueuePlanId ?? "", [], "failed");
  sidecar.openQueuePlanId = null;

  const result = await sidecar.runAgentTool("ae_workflow_complete", { summary: "done" }, input, state);
  assert.equal(result.ok ? undefined : result.error.code, "WORKFLOW_HELD_ANIMATION", "completion is not accepted with animation outstanding");
  assert.match(result.ok ? "" : result.error.message, /did not verify.*animate_property/, "the held operations are handed back in the answer");
  assert.equal(heldTypes(sidecar, input).length, 0, "the hold is cleared once handed back");
});

test("unit: operationAnimates", () => {
  assert.equal(operationAnimates({ type: "animate_property" }), true, "animate_property animates");
  assert.equal(operationAnimates({ type: "set_expression" }), true, "set_expression animates");
  assert.equal(operationAnimates({ type: "add_shape_item", keyframes: { end: [{ time: 0, value: 0 }, { time: 1, value: 100 }] } }), true, "add_shape_item with keyframes animates");
  assert.equal(operationAnimates({ type: "add_shape_item", keyframes: {} }), false, "add_shape_item with empty keyframes does not animate");
  assert.equal(operationAnimates({ type: "create_layer" }), false, "create_layer does not animate");
});

const executedBatch = { operationIds: ["o"], execution: { state: "executed" }, updatedAt: "2026-01-01T00:00:10.000Z" };

function historyWith(observations: BuildHistory["observations"], batch: BuildHistory["batches"][string] = executedBatch): BuildHistory {
  return { jobs: { j: { batchIds: ["b"] } }, batches: { b: batch }, operations: { o: { type: "create_layer" } }, observations };
}

test("unit: frameCheckMissing", () => {
  assert.equal(frameCheckMissing(historyWith({}), "j"), true, "missing observation returns true");
  assert.equal(frameCheckMissing(historyWith({ obs1: { jobId: "j", kind: "visual", recordedAt: "2026-01-01T00:00:20.000Z" } }), "j"), false, "observation after build returns false");
  assert.equal(frameCheckMissing(historyWith({ obs1: { jobId: "j", kind: "visual", recordedAt: "2026-01-01T00:05:00.000Z" } }), "j"), false, "old observation returns false");
  assert.equal(frameCheckMissing(historyWith({ obs1: { jobId: "j", kind: "structural", recordedAt: "2026-01-01T00:00:20.000Z" } }), "j"), true, "structural observation returns true");
  assert.equal(frameCheckMissing(historyWith({ obs1: { jobId: "other", kind: "visual", recordedAt: "2026-01-01T00:00:20.000Z" } }), "j"), true, "observation for other job returns true");
  assert.equal(frameCheckMissing(historyWith({}, { ...executedBatch, execution: { state: "pending" } }), "j"), false, "pending batch returns false");
});

type Sidecar = ReturnType<typeof sidecarFor>;

function positionKeys(layerId: string) {
  return { type: "animate_property", target: { compositionId: "comp-1", layerId, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 10] }] };
}

function queuedOperations(sidecar: Sidecar) {
  const open = sidecar.openQueuePlanId ? sidecar.plans.get(sidecar.openQueuePlanId) : undefined;
  return open ? operationsOf(open) : [];
}

function queuedTypes(sidecar: Sidecar): string[] { return queuedOperations(sidecar).map((operation) => String(operation.type)); }

function heldTypes(sidecar: Sidecar, input: { workflowJobId: string }): string[] {
  const jobId = sidecar.workflowCoordinator.jobIdForSeed(input.workflowJobId);
  return (sidecar.workflowHeldAnimation.get(jobId) ?? []).flatMap((hold) => hold.operations.map((operation) => String(operation.type)));
}

function settleVerified(sidecar: Sidecar, planId: string, createdBindings: Array<{ placeholder: string; createdId: string }>, verification = "verified"): void {
  const coordinator = sidecar.workflowCoordinator;
  const original = coordinator.batchForPlan.bind(coordinator);
  const settled = { lifecycle: "settled", verification: { state: verification }, recovery: { state: "none" }, execution: { receipt: { createdBindings } } };
  coordinator.batchForPlan = (id) => (id === planId ? Object.assign({}, original(id), settled) : original(id));
}

function settleDesign(sidecar: Sidecar, designPlanId: string): void {
  const canonical = sidecar.plans.get(designPlanId)?.placeholderBindings?.["__new__:ctrl"] ?? "__new__:ctrl";
  settleVerified(sidecar, designPlanId, [{ placeholder: canonical, createdId: "layer-77" }]);
  sidecar.openQueuePlanId = null;
  sidecar.latest = { snapshot: snapshotWithControl("gate-rule-2-release"), receivedAt: "2026-09-24T00:00:01.000Z", bytes: 1 };
}

function snapshotWithControl(id: string) {
  const base = mutableSnapshot(id);
  const [comp] = base.result.compositions;
  const [first] = present(comp).layers;
  const control = { ...present(first), id: "layer-77", index: 2, name: "Control", selected: false, type: "null" };
  return { ...base, result: { ...base.result, compositions: [{ ...present(comp), layers: [present(first), control] }] } };
}

function brief(role: string): string {
  const handoff = JSON.stringify({
    role,
    objective: "o",
    requirements: ["r"],
    deliverables: ["d"],
    constraints: ["c"],
    verification: ["v"],
  });
  return role === "visual-scene" ? DESIGNER_REPORT : handoff;
}

const settledSeal = { ok: true as const, tool: "ae_queue_finish", snapshotFingerprint: null, data: null, continuesLoop: true };

test("rule 2 — once the build batch settles in the loop, a later batch may animate the layers it created", async () => {
  const { sidecar, input, state } = await designedJob("gate-rule-2-settled");
  const built = await sidecar.runAgentTool("ae_queue_add", { summary: "Create control", operations: [CREATE_CTRL] }, input, state);
  assert.equal(built.ok, true, "the build call is queued");
  closeSettledStage(state, settledSeal);
  const result = await sidecar.runAgentTool("ae_queue_add", { summary: "Animate control", operations: [ANIMATE_CTRL] }, input, state);
  assert.notEqual(failureOf(result)?.code, "WORKFLOW_DESIGN_FIRST", "the settled seal ended the build batch");
});

test("a handoff the owner already read in this conversation is not returned again; a later cycle gets it in full", async () => {
  const { sidecar, input, state } = await designedJob("handoff-once");
  const again = await sidecar.runAgentTool("ae_consult_specialist", { action: "status", role: "motion" }, input, state);
  assert.equal(again.ok ? typeof fieldOf(again.data, "handoff") : "refused", "string", "the wait already returned this handoff, so status points back to it");
  const fresh = await sidecar.runAgentTool("ae_consult_specialist", { action: "status", role: "motion" }, { ...input, workflowCycle: 1 }, state);
  assert.equal(fresh.ok ? typeof fieldOf(fresh.data, "handoff") : "refused", "object", "a new cycle starts a fresh history, so it gets the whole handoff");
});
