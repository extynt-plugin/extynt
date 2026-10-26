// The visual-waiver decision: a model's verdict for the goal decides whether a verified read-back stands in for a rendered frame; with no verdict the sidecar's own reading stands.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { ActionPlan, Operation } from "@extynt/action-plan";
import { bookYesNo, clearBook } from "../src/decision-book.js";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { present } from "./agent-test-support.js";
import { at, batchIdOf, ready } from "./workflow-coordinator-fixture.js";

beforeEach(() => clearBook());

const target = { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snap-before", selectionFingerprint: "selection-1" };
const opacity: Operation = { type: "set_layer_property", target, role: "transform.opacity", propertyPath: "ADBE Transform Group/ADBE Opacity", value: 50 };
const LITERAL = "Set the opacity to 50";
const LOOK = "Make the title look warmer, like a sunset";

function visualEvidenceFor(goal: string): boolean {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const jobId = coordinator.openJob("waiver", goal);
  const plan: ActionPlan = { schemaVersion: "0.2", planId: "waiver-plan", snapshotFingerprint: "snap-before", selectionFingerprint: "selection-1", freshness: { revision: "1", capturedAt: at.toISOString() }, summary: "Set values", requiresApproval: true, operations: [opacity] };
  ready(coordinator, plan, "waiver");
  const step = { operation: opacity.type, observed: true, verificationState: "exact", basis: "fixture readback", compositionId: "comp-1", layerId: "layer-1" };
  coordinator.receipt(plan.planId, { receiptId: "waiver-receipt", planId: plan.planId, status: "executed", postcondition: "passed", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snap-after", verification: { state: "exact", basis: "fixture readback", steps: [step] } });
  coordinator.completeStageForContinuation(jobId);
  const batch = present(coordinator.workflowStore.getState().batches[batchIdOf(coordinator, plan.planId)], "batch");
  return (batch.execution.receipt?.hostEvidence ?? []).some((item) => item.kind === "visual");
}

test("with no booked verdict the wording decides as before", () => {
  assert.equal(visualEvidenceFor(LITERAL), true);
  assert.equal(visualEvidenceFor(LOOK), false);
});

test("a model that finds the read-back not enough keeps the frame requirement", () => {
  bookYesNo({ decision: "visual-waiver", text: LITERAL }, false);
  assert.equal(visualEvidenceFor(LITERAL), false);
});

test("a model that finds the read-back enough waives the frame for a goal the wording would not", () => {
  bookYesNo({ decision: "visual-waiver", text: LOOK }, true);
  assert.equal(visualEvidenceFor(LOOK), true);
});
