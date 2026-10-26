/**
 * The designer draws, the sidecar compiles it, and ae_queue_design's queue path builds it. These tests drive that path for a drawing the designer
 * compiled but did not build (its build was refused): the owner's ae_queue_design builds it. The designer's own build is in workflow-designer.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MockProvider } from "@extynt/llm";
import type { ActionPlan } from "@extynt/action-plan";
import { WORKFLOW_OWNER } from "../src/workflow-orchestration.js";
import { BATCH_NODE_BUDGET, jsonNodes } from "../src/workflow-batch-nodes.js";
import { mutableSnapshot, seedDesign, sidecarFor, token } from "./sidecar-fixture.js";
import type { AgentCallState } from "../src/server-chat-agent-types.js";
import type { JsonObject } from "@extynt/decode";
import { operationsOf } from "../src/server-workflow-design-receipts.js";
import { namesOf, objectOf, payload, textOf, type ToolResult } from "../src/server-workflow-operation-json.js";
import { present } from "./agent-test-support.js";
import { fieldOf } from "./http-json.js";

const dataOf = (result: ToolResult): JsonObject => payload(result) ?? {};
const compositionOf = (operation: JsonObject) => textOf(objectOf(operation.target)?.compositionId);

const SUNRISE_LIVE = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">\n  <g id="Sky Background" data-anchor="480 270">\n    <rect x="0" y="0" width="960" height="540" fill="#0D1330"/>\n  </g>\n  <g id="Sun" data-anchor="480 355">\n    <circle cx="480" cy="355" r="90" fill="#FFC554"/>\n  </g>\n  <g id="Ray Up" data-anchor="480 355">\n    <path d="M 470 249 L 490 249 L 480 169 Z" fill="#FFD680"/>\n  </g>\n  <g id="Ray Left" data-anchor="480 355">\n    <path d="M 387.5 302.4 L 398.9 286.0 L 327.6 248.3 Z" fill="#FFD680"/>\n  </g>\n  <g id="Ray Right" data-anchor="480 355">\n    <path d="M 561.1 286.0 L 572.6 302.4 L 632.4 248.3 Z" fill="#FFD680"/>\n  </g>\n  <g id="Horizon" data-anchor="480 477.5">\n    <path d="M 0 460 Q 480 370 960 460 L 960 540 L 0 540 Z" fill="#060A1E"/>\n    <path d="M 0 460 Q 480 370 960 460" fill="none" stroke="#C4863A" stroke-width="3" stroke-linecap="round"/>\n  </g>\n</svg>';

function setup(requestId: string) {
  const sidecar = sidecarFor({ token, chatProvider: new MockProvider({ answer: "ok" }), quietAgentLog: true });
  sidecar.latest = { snapshot: mutableSnapshot(requestId), receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  const input = { requestId, message: "A planet with a ring", history: [], autoApply: true, workflowJobId: requestId, workflowGoalSummary: "A planet with a ring", workflowRole: WORKFLOW_OWNER };
  return { sidecar, input };
}

function design(sidecar: ReturnType<typeof setup>["sidecar"], input: ReturnType<typeof setup>["input"], svg?: string): void {
  seedDesign(sidecar, input.workflowJobId, svg);
}

test("ae_queue_design queues the drawing as native layers, selecting the build stage itself", async () => {
  const { sidecar, input } = setup("design-built");
  design(sidecar, input);
  const state: AgentCallState = {};
  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, state);
  assert.equal(built.ok, true, built.ok ? "" : JSON.stringify(built.error));
  assert.deepEqual(fieldOf(dataOf(built), "design.built"), ["Ring Back", "Planet", "Ring Front"]);
  assert.deepEqual(fieldOf(dataOf(built), "design.remaining"), []);
  assert.ok(state.workflowStage, "a build stage was selected");
  const open = sidecar.plans.get(sidecar.openQueuePlanId ?? "");
  assert.ok(open, "the operations sit in the open batch");
  const types = operationsOf(open).map((operation) => operation.type);
  assert.equal(types.filter((type) => type === "create_layer").length, 3);
  assert.equal(types.filter((type) => type === "draw_vector_shapes").length, 3);
  const again = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, state);
  assert.equal(again.ok && fieldOf(again.data, "queued"), 0, "a second call in the same batch queues nothing twice");
});

test("a new composition in the open batch receives the scene at its own canvas size", async () => {
  const svg = '<svg viewBox="0 0 960 540"><g id="Title"><rect x="0" y="0" width="960" height="540" fill="#0a1128"/></g></svg>';
  const { sidecar, input } = setup("design-new-composition");
  design(sidecar, input, svg);
  const state: AgentCallState = {};
  const stage = await sidecar.runAgentTool("ae_select_workflow_stage", { summary: "Create a separate 960x540 title", operationTypes: ["create_composition", "create_layer", "draw_vector_shapes"] }, input, state);
  assert.equal(stage.ok, true, JSON.stringify(stage));
  const created = await sidecar.runAgentTool("ae_queue_add", { summary: "Create title comp", operations: [{ type: "create_composition", newCompositionId: "__new__:title", name: "QA Title", width: 960, height: 540, durationSeconds: 5, frameRate: 30 }] }, input, state);
  assert.equal(created.ok, true, JSON.stringify(created));
  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, state);
  assert.equal(built.ok, true, JSON.stringify(built));
  const open = sidecar.plans.get(sidecar.openQueuePlanId ?? "");
  assert.ok(open);
  const operations = operationsOf(open);
  const newCompId = operations.find((operation) => operation.type === "create_composition")?.newCompositionId;
  assert.equal(typeof newCompId, "string");
  assert.equal(compositionOf(present(operations.find((operation) => operation.type === "create_layer"))), newCompId);
  assert.equal(compositionOf(present(operations.find((operation) => operation.type === "draw_vector_shapes"))), newCompId);
  assert.equal(fieldOf(built.ok ? built.data : undefined, "accepted"), 2, JSON.stringify(built));
});

test("a six-layer scene builds into a new composition in the same batch", async () => {
  const { sidecar, input } = setup("design-six-new");
  design(sidecar, input, SUNRISE_LIVE);
  const state: AgentCallState = {};
  const stage = await sidecar.runAgentTool("ae_select_workflow_stage", { summary: "Create sunrise scene", operationTypes: ["create_composition", "create_layer", "set_layer_property", "set_layer_name", "create_shape_group", "set_shape_path", "ensure_shape_fill", "ensure_shape_stroke", "add_shape_item"] }, input, state);
  assert.equal(stage.ok, true, JSON.stringify(stage));
  const created = await sidecar.runAgentTool("ae_queue_add", { summary: "Create sunrise", operations: [{ type: "create_composition", newCompositionId: "__new__:sunrise", name: "Sunrise", width: 960, height: 540, durationSeconds: 4, frameRate: 30 }] }, input, state);
  assert.equal(created.ok, true, JSON.stringify(created));
  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, state);
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(fieldOf(built.ok ? built.data : undefined, "accepted"), 17, JSON.stringify(built));
  assert.deepEqual(fieldOf(built.ok ? built.data : undefined, "design.built"), ["Sky Background", "Sun", "Ray Up", "Ray Left", "Ray Right", "Horizon"]);
  const open = sidecar.plans.get(sidecar.openQueuePlanId ?? "");
  assert.ok(open);
  assert.equal(operationsOf(open).filter((operation) => operation.type === "create_layer").length, 6);
});

test("ae_queue_design before any drawing says how to get one", async () => {
  const { sidecar, input } = setup("design-absent");
  const result = await sidecar.runAgentTool("ae_queue_design", {}, input, {});
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "DESIGN_UNAVAILABLE");
});

test("ae_queue_design reports a layer whose clip masks cannot fit in one batch", async () => {
  const clipPaths = Array.from({ length: 16 }, () => '<path d="M0 0H10V10Z"/>').join("");
  const svg = `<svg viewBox="0 0 1920 1080"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="c">${clipPaths}</clipPath></defs><g id="Part" clip-path="url(#c)"><rect width="100" height="100" fill="url(#g)"/></g></svg>`;
  const { sidecar, input } = setup("design-too-many-masks");
  design(sidecar, input, svg);
  const result = await sidecar.runAgentTool("ae_queue_design", {}, input, {});
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "DESIGN_LAYER_TOO_COMPLEX");
  assert.match(!result.ok ? result.error.message : "", /Simplify its clip path subpaths/);
});

test("a placeholder composition resolves only from this job's receipts, newest first", async () => {
  const requestId = "design-scoped-placeholder";
  const { sidecar, input } = setup(requestId);
  const base = mutableSnapshot(requestId);
  const [main] = base.result.compositions;
  sidecar.latest = { snapshot: { ...base, result: { ...base.result, compositions: [present(main), ...["comp-other", "comp-old", "comp-new"].map((id) => ({ ...present(main), id, name: id }))] } }, receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  design(sidecar, input);
  const jobId = sidecar.workflowCoordinator.jobIdForSeed(requestId);
  const session = sidecar.workflowSpecialistSessions.get(jobId)?.get("visual-scene");
  assert.ok(session?.design);
  session.design = { ...session.design, targetCompositionPlaceholder: "__new__:scene" };

  const authority = { hostProfileId: "profile-scope", hostBasis: "scope fixture", hostSupported: true, verificationBasis: "scope fixture", exactVerification: true, targetResolved: true, policyApprovalId: "approval-ref:scope" } as const;
  const admitted = (planId: string, logicalJob: string, created: string): void => {
    const plan: ActionPlan = { schemaVersion: "0.2", planId, snapshotFingerprint: "snapshot-scope", selectionFingerprint: "selection-scope", summary: "Create scene composition", requiresApproval: true, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-scope", selectionFingerprint: "selection-scope" }, name: "Scope" }] };
    assert.equal(sidecar.workflowCoordinator.admitPlan(plan, { jobId: logicalJob, undoGroups: 1, authority }).ok, true);
    sidecar.plans.set(planId, { plan, status: "applied", createdAt: "2026-09-24T15:00:00.000Z", updatedAt: "2026-09-24T15:00:00.000Z", receipt: { created: { "__new__:scene": created } } });
  };
  admitted("scope-other-plan", "another-job", "comp-other");
  sidecar.workflowCoordinator.cancelJob(present(sidecar.workflowCoordinator.jobIdForPlan("scope-other-plan") ?? undefined));
  admitted("scope-old-plan", requestId, "comp-old");
  admitted("scope-new-plan", requestId, "comp-new");
  assert.equal(sidecar.workflowCoordinator.jobIdForPlan("scope-new-plan"), jobId);

  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, {});
  assert.equal(built.ok, true, JSON.stringify(built));
  const open = sidecar.plans.get(sidecar.openQueuePlanId ?? "");
  assert.ok(open);
  const targets = operationsOf(open).map(compositionOf);
  assert.ok(targets.length > 0);
  assert.deepEqual([...new Set(targets)], ["comp-new"], "the build targets the newest composition this job created");
});

test("a starfield too heavy for one batch is built as sibling layers, each inside the engine's node bound", async () => {
  const stars = Array.from({ length: 160 }, (_, index) => `<circle cx="${(index * 97) % 1920}" cy="${(index * 61) % 1080}" r="2" fill="#ffffff"/>`).join("");
  const svg = `<svg viewBox="0 0 1920 1080"><g id="Sky"><rect width="1920" height="1080" fill="#050814"/></g><g id="Stars">${stars}</g></svg>`;
  const { sidecar, input } = setup("design-starfield");
  design(sidecar, input, svg);
  const result = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, {});
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.error));
  const remaining = namesOf(objectOf(dataOf(result).design)?.remaining);
  assert.deepEqual(fieldOf(dataOf(result), "design.built"), ["Sky", "Stars"]);
  assert.ok(remaining.includes("Stars 2"), `the rest of the stars wait for the next batch: ${remaining.join(", ")}`);
  const open = sidecar.plans.get(sidecar.openQueuePlanId ?? "");
  assert.ok(open && jsonNodes(operationsOf(open)) <= BATCH_NODE_BUDGET, "the open batch stays inside the node budget");
});

async function sealedJobFixture(requestId: string, created: Array<{ id: string; width: number; height: number }>) {
  const { sidecar, input } = setup(requestId);
  const base = mutableSnapshot(requestId);
  const [main] = base.result.compositions;
  const compositions = [{ ...present(main), width: 1280, height: 720 }, ...created.map((item) => ({ ...present(main), ...item, name: item.id }))];
  sidecar.latest = { snapshot: { ...base, result: { ...base.result, compositions } }, receivedAt: "2026-09-24T15:00:00.000Z", bytes: 1 };
  design(sidecar, input);
  const jobId = sidecar.workflowCoordinator.jobIdForSeed(requestId);
  const authority = { hostProfileId: "profile-seal", hostBasis: "seal fixture", hostSupported: true, verificationBasis: "seal fixture", exactVerification: true, targetResolved: true, policyApprovalId: "approval-ref:seal" } as const;
  created.forEach((item, index) => {
    const planId = `seal-plan-${index}`;
    const plan: ActionPlan = { schemaVersion: "0.2", planId, snapshotFingerprint: "snapshot-seal", selectionFingerprint: "selection-seal", summary: "Create composition", requiresApproval: true, operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-seal", selectionFingerprint: "selection-seal" }, name: "Seal" }] };
    assert.equal(sidecar.workflowCoordinator.admitPlan(plan, { jobId: requestId, undoGroups: 1, authority }).ok, true);
    sidecar.plans.set(planId, { plan, status: "applied", createdAt: "2026-09-24T15:00:00.000Z", updatedAt: "2026-09-24T15:00:00.000Z", receipt: { created: { [`__new__:comp${index}`]: item.id } } });
  });
  return { sidecar, input, jobId };
}

test("a composition this job created in an earlier sealed plan is the target, and the design records it", async () => {
  const { sidecar, input, jobId } = await sealedJobFixture("design-sealed-comp", [{ id: "comp-launch", width: 1920, height: 1080 }, { id: "comp-other-size", width: 640, height: 360 }]);
  const session = sidecar.workflowSpecialistSessions.get(jobId)?.get("visual-scene");
  assert.equal(session?.design?.compositionId, null);
  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, {});
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(session?.design?.compositionId, "comp-launch");
  const open = sidecar.plans.get(sidecar.openQueuePlanId ?? "");
  assert.ok(open);
  const targets = operationsOf(open).map(compositionOf);
  assert.deepEqual([...new Set(targets)], ["comp-launch"]);
});

test("two compositions of the drawing's size from this job are ambiguous", async () => {
  const { sidecar, input } = await sealedJobFixture("design-sealed-ambiguous", [{ id: "comp-a", width: 1920, height: 1080 }, { id: "comp-b", width: 1920, height: 1080 }]);
  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, {});
  assert.equal(built.ok, false);
  assert.equal(built.ok ? "" : built.error.code, "COMPOSITION_AMBIGUOUS");
  assert.match(built.ok ? "" : built.error.message, /comp-a.*comp-b|comp-b.*comp-a/);
});

test("no composition of the drawing's size reworded refusal does not push a duplicate", async () => {
  const { sidecar, input } = await sealedJobFixture("design-sealed-none", [{ id: "comp-small", width: 640, height: 360 }]);
  const built = await sidecar.runAgentTool("ae_queue_design", { finish: false }, input, {});
  assert.equal(built.ok, false);
  const error = built.ok ? { code: "", message: "" } : built.error;
  assert.equal(error.code, "COMPOSITION_TARGET_REQUIRED");
  assert.match(error.message, /No composition of 1920×1080 exists in this job or is open/);
  assert.doesNotMatch(error.message, /ask the designer to redraw/i);
});
