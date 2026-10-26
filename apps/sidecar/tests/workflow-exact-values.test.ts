// Tests that a request which only sets exact values is proved by the verified host read-back and needs no rendered frame.

import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlan, Operation } from "@extynt/action-plan";
import { type JsonValue } from "@extynt/decode";
import { goalAsksForJudgement, goalNamesNoSceneOrMotion, requiredEvidenceKindsForGoal } from "../src/workflow-goal-evidence.js";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import type { CompletionResult } from "../src/workflow-coordinator-completion.js";
import { present } from "./agent-test-support.js";
import { at, batchIdOf, ready } from "./workflow-coordinator-fixture.js";

const target = { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snap-before", selectionFingerprint: "selection-1" };
const GOAL = "Add a Gaussian Blur with Blurriness 8 and a Glow with Radius 40";

const blur: Operation = { type: "set_layer_property", target, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [600, 880] };
const opacity: Operation = { type: "set_layer_property", target, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 };
const keyframed: Operation = { type: "animate_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] };
const created: Operation = { type: "create_layer", target: { ...target, layerId: "__new__:created" }, layerType: "null", name: "Created" };

function plan(planId: string, operations: Operation[]): ActionPlan {
  return { schemaVersion: "0.2", planId, snapshotFingerprint: "snap-before", selectionFingerprint: "selection-1", freshness: { revision: "1", capturedAt: at.toISOString() }, summary: "Set values", requiresApproval: true, operations };
}

function step(operation: Operation, state: string): Readonly<Record<string, JsonValue>> {
  return { operation: operation.type, observed: state === "exact", verificationState: state, basis: "fixture readback", compositionId: "comp-1", layerId: "layer-1" };
}

interface Settled { readonly coordinator: WorkflowCoordinator; readonly planId: string; readonly jobId: string }

function settle(goal: string, operations: Operation[], state = "exact"): Settled {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const jobId = coordinator.openJob("exact-values", goal);
  const value = plan("exact-plan", operations);
  ready(coordinator, value, "exact-values");
  const verified = state === "exact";
  coordinator.receipt(value.planId, { receiptId: "exact-receipt", planId: value.planId, status: "executed", postcondition: verified ? "passed" : "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snap-after", verification: { state, basis: "fixture readback", steps: operations.map((operation) => step(operation, state)) } });
  coordinator.completeStageForContinuation(jobId);
  return { coordinator, planId: value.planId, jobId };
}

function visualEvidence(run: Settled): boolean {
  const batch = present(run.coordinator.workflowStore.getState().batches[batchIdOf(run.coordinator, run.planId)], "batch");
  return (batch.execution.receipt?.hostEvidence ?? []).some((item) => item.kind === "visual");
}

function proposeVisual(run: Settled): CompletionResult {
  const batchId = batchIdOf(run.coordinator, run.planId);
  const current = { fingerprint: "snap-after", revision: "2" };
  const goalDigest = run.coordinator.continuation(run.jobId, current, 1).goalDigest;
  return run.coordinator.proposeCompletion(run.jobId, { goalDigest, criterionIds: ["goal-visual"], evidence: [{ criterionId: "goal-visual", reference: { kind: "batch_receipt", batchId, receiptId: "exact-receipt" }, satisfiedAt: at.toISOString() }] }, current);
}

function refusalMessage(result: CompletionResult): string {
  if (result.ok) throw new Error("expected the completion proposal to be refused");
  return result.message;
}

test("the blur-and-glow request still requires visual evidence by wording, yet exact values satisfy it", () => {
  assert.deepEqual(requiredEvidenceKindsForGoal(GOAL), ["visual"]);
  const run = settle(GOAL, [blur, opacity]);
  assert.equal(visualEvidence(run), true);
  assert.deepEqual(proposeVisual(run), { ok: true });
  assert.equal(run.coordinator.workflowStore.getState().jobs[run.jobId]?.status, "completed");
});

test("keyframes with literal values are structural, so their read-back satisfies the requirement", () => {
  const run = settle(GOAL, [blur, keyframed]);
  assert.equal(visualEvidence(run), true);
  assert.deepEqual(proposeVisual(run), { ok: true });
});

test("creating a plain layer is structural too, so its read-back satisfies the requirement", () => {
  const run = settle(GOAL, [created, blur]);
  assert.equal(visualEvidence(run), true);
  assert.deepEqual(proposeVisual(run), { ok: true });
});

test("shape artwork is judged by eye, so its visual requirement stays unmet", () => {
  const run = settle(GOAL, [{ ...created, layerType: "shape" }, blur]);
  assert.equal(visualEvidence(run), false);
  assert.match(refusalMessage(proposeVisual(run)), /requires visual evidence/);
});

test("a goal that asks for a look keeps the requirement unmet whatever was queued", () => {
  const run = settle("Make the title look better with a blur and a glow", [blur, opacity]);
  assert.equal(visualEvidence(run), false);
});

test("an unverified receipt carries no exact-values evidence", () => {
  const run = settle(GOAL, [blur, opacity], "applied_unverified");
  assert.equal(visualEvidence(run), false);
  assert.equal(proposeVisual(run).ok, false);
});

test("a scene or judgement goal keeps the visual requirement unmet", () => {
  for (const goal of ["Make it look cinematic with a glow", "Match the glow of the reference", "Give the title a nicer glow", "Animate a glow"]) {
    assert.equal(goalNamesNoSceneOrMotion(goal), false, goal);
  }
  const run = settle("Make it look cinematic: blur 8 and glow radius 40", [blur, opacity]);
  assert.equal(visualEvidence(run), false);
  assert.match(refusalMessage(proposeVisual(run)), /requires visual evidence/);
});

test("a plain exact-values goal passes the wording gate", () => {
  assert.equal(goalNamesNoSceneOrMotion(GOAL), true);
});

test("a slide and fade that holds until the end of the composition is proved by its keyframe read-back, as the comp is not a judgement", () => {
  const goal = "Animate the selected title so it slides in from the left and fades up over the first half second, then holds on screen until the end of the composition.";
  assert.equal(goalAsksForJudgement(goal), false);
  const run = settle(goal, [keyframed, { type: "set_layer_timing", target, inPoint: 0, outPoint: 12 }]);
  assert.equal(visualEvidence(run), true);
  const batchId = batchIdOf(run.coordinator, run.planId);
  const current = { fingerprint: "snap-after", revision: "2" };
  const goalDigest = run.coordinator.continuation(run.jobId, current, 1).goalDigest;
  const reference = { kind: "batch_receipt", batchId, receiptId: "exact-receipt" } as const;
  const criterionIds = ["goal-visual", "goal-temporal"];
  assert.deepEqual(run.coordinator.proposeCompletion(run.jobId, { goalDigest, criterionIds, evidence: criterionIds.map((criterionId) => ({ criterionId, reference, satisfiedAt: at.toISOString() })) }, current), { ok: true });
});

test("\"I'd like\" is a request, not a judgement, while a look, a match or a better composition still is", () => {
  assert.equal(goalAsksForJudgement("I'd like a red solid in the comp"), false);
  for (const goal of ["Make it look like the reference", "Improve the composition", "Make the composition feel calmer", "Match the other comp"]) assert.equal(goalAsksForJudgement(goal), true, goal);
});
