// Tests that a panel receipt whose coerced or expression-driven steps cannot be read back still maps to a settled batch instead of blocking the job.

import type { StoredReceipt } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlan, Operation } from "@extynt/action-plan";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";

const at = new Date("2026-09-24T14:56:43.000Z");
const authority = {
  hostProfileId: "profile-fixture",
  hostBasis: "complete fixture host profile",
  hostSupported: true,
  verificationBasis: "sealed action-plan verification report",
  exactVerification: true,
  targetResolved: true,
  policyApprovalId: "approval-ref:fixture",
} as const;
const target = { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" };

function plan(planId: string, operations: Operation[]): ActionPlan {
  return {
    schemaVersion: "0.2",
    planId,
    snapshotFingerprint: "snapshot-before",
    selectionFingerprint: "selection-1",
    freshness: { revision: "1", capturedAt: at.toISOString() },
    summary: "Place the planet",
    requiresApproval: true,
    operations,
  };
}

const rename: Operation = { type: "set_layer_name", target, name: "Planet" };
const position: Operation = { type: "set_layer_property", target, role: "transform.position", propertyPath: "ADBE Transform Group/ADBE Position", value: [600, 880] };
const renameStep = { operation: "set_layer_name", observed: true, verificationState: "exact", basis: "layer-name", compositionId: "comp-1", layerId: "layer-1" };
const coercedStep = { operation: "set_layer_property", observed: false, verificationState: "applied_unverified", basis: "property-value-coerced", compositionId: "comp-1", layerId: "layer-1", propertyPath: "ADBE Transform Group/ADBE Position" };

function settle(value: ActionPlan, receipt: StoredReceipt): WorkflowCoordinator {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  assert.equal(coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  coordinator.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.claim(value.planId);
  coordinator.executing(value.planId);
  coordinator.receipt(value.planId, { planId: value.planId, status: "executed", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after", ...receipt });
  return coordinator;
}

test("a batch whose only unverified step is a coerced position write settles verified", () => {
  const value = plan("coerced-only", [rename, position]);
  const coordinator = settle(value, { postcondition: "applied_unverified", verification: { steps: [renameStep, coercedStep] } });
  const projection = coordinator.projection();
  assert.equal(projection.divergences.length, 0, "the receipt must map; an unmapped receipt is what blocked the rocket run");
  assert.equal(projection.batches[0]?.execution, "executed");
  assert.equal(projection.batches[0]?.verification, "verified");
  assert.deepEqual(projection.operations.map((operation) => operation.outcome), ["confirmed", "coerced_equivalent"]);
});

test("a write under its own enabled expression settles the batch verified", () => {
  const value = plan("write-under-expression", [rename, position]);
  const underExpression = { ...coercedStep, basis: "property-value-under-expression" };
  const coordinator = settle(value, { postcondition: "applied_unverified", verification: { steps: [renameStep, underExpression] } });
  const projection = coordinator.projection();
  assert.equal(projection.divergences.length, 0);
  assert.equal(projection.batches[0]?.verification, "verified");
  assert.deepEqual(projection.operations.map((operation) => operation.outcome), ["confirmed", "coerced_equivalent"]);
});

test("a step whose expression motion went unverified keeps the batch applied_unverified and names that row", () => {
  const value = plan("expression-motion", [rename, position]);
  const motionStep = { ...coercedStep, observed: true, verificationState: "exact", basis: "property-keyframe-digest", expressionMotionUnverified: true };
  const coordinator = settle(value, { postcondition: "applied_unverified", verification: { steps: [renameStep, motionStep] } });
  const projection = coordinator.projection();
  assert.equal(projection.divergences.length, 0);
  assert.equal(projection.batches[0]?.verification, "applied_unverified");
  assert.deepEqual(projection.operations.map((operation) => operation.outcome), ["confirmed", "applied_unconfirmed"]);
});

test("an executed batch whose verifying probe failed is applied_unverified, not an unknown execution", () => {
  const value = plan("probe-failed", [rename, position]);
  const coordinator = settle(value, { postcondition: "verification_unavailable" });
  const projection = coordinator.projection();
  assert.equal(projection.divergences.length, 0);
  assert.equal(projection.batches[0]?.execution, "executed", "the host executed and returned; only verification is missing");
  assert.equal(projection.batches[0]?.verification, "applied_unverified");
  assert.deepEqual(projection.operations.map((operation) => operation.outcome), ["applied_unconfirmed", "applied_unconfirmed"]);
});

test("a trimmed receipt keeps the panel's applied_unverified grade and still maps", () => {
  const value = plan("trimmed", [rename, position]);
  const coordinator = settle(value, { postcondition: "applied_unverified", verificationTrimmed: true, verification: { steps: [coercedStep] } });
  const projection = coordinator.projection();
  assert.equal(projection.divergences.length, 0);
  assert.equal(projection.batches[0]?.verification, "applied_unverified");
  assert.ok(projection.operations.some((operation) => operation.outcome === "applied_unconfirmed"), "an applied_unverified aggregate names at least one unconfirmed row");
});

test("a plan applied in several undo groups settles, and more groups than operations is refused", () => {
  const value = plan("two-groups", [rename, position]);
  const steps = { postcondition: "passed", verification: { steps: [renameStep, { ...coercedStep, observed: true, verificationState: "exact", basis: "property-value" }] } };
  const coordinator = settle(value, { ...steps, undoGroups: 2 });
  assert.equal(coordinator.projection().divergences.length, 0);
  assert.equal(coordinator.projection().batches[0]?.execution, "executed");
  assert.throws(() => settle(plan("three-groups", [rename, position]), { ...steps, undoGroups: 3 }), { code: "MULTI_UNDO_BATCH" });
});
