// Tests for workflow coordinator admission, policy classification, receipts and undo.

import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlan, Operation, RenderCompositionOperation, V2TargetReference } from "@extynt/action-plan";
import { mutationBehaviorForPlan, WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { classifyWorkflowPolicy } from "../src/workflow-coordinator-admission.js";
import { present } from "./agent-test-support.js";
import { at, authority, batchOf, jobIdOf, plan, ready, refusalCode } from "./workflow-coordinator-fixture.js";

function withoutTarget(value: typeof authority): Omit<typeof authority, "targetResolved"> {
  const { targetResolved: _target, ...rest } = value;
  return rest;
}

test("workflow coordinator projects the real sealed -> claim -> receipt ordering", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  ready(coordinator);
  coordinator.receipt("plan-1", { planId: "plan-1", status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" });
  const projection = coordinator.projection();
  const batch = present(projection.batches[0], "batch");
  const operation = present(projection.operations[0], "operation");
  const job = present(projection.jobs[0], "job");
  assert.equal(projection.resumeSupported, false);
  assert.equal(job.status, "blocked");
  assert.equal(batch.execution, "executed");
  assert.equal(batch.verification, "applied_unverified");
  assert.equal(operation.outcome, "applied_unconfirmed");
  assert.equal("payload" in operation, false);
  assert.equal(batch.receipt?.receiptId, "receipt:plan-1:0");
  assert.equal(batch.policy, "manual");
  assert.equal(batch.undo.dispatch, "idle");
  assert.equal(batch.requiredPostconditions, 0);
  assert.deepEqual(job.progress, { totalBatches: 1, settledBatches: 1, verifiedBatches: 0, appliedUnverifiedBatches: 1, uncertainBatches: 0, undoCompleted: 0, criteria: { total: 1, satisfied: 0 } });
});

test("workflow-v1 refuses a legacy plan spanning multiple host undo groups before queueing", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const result = coordinator.admitPlan(plan("multi"), { jobId: "job-1", undoGroups: 2, authority });
  assert.deepEqual(result, { ok: false, code: "MULTI_UNDO_BATCH", message: "workflow-v1 refused a plan whose reported undo-group count does not match the authoritative host boundary." });
  assert.equal(coordinator.projection().jobs.length, 0);
});

test("workflow-v1 recomputes the host undo boundary instead of trusting a forged one-group report", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = { ...plan("forged-single-undo"), operations: Array.from({ length: 26 }, (_, index) => ({ ...present(plan("operation").operations[0], "operation"), name: `Rename ${index}` })) } satisfies ActionPlan;
  const result = coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 1, authority });
  assert.deepEqual(result, { ok: false, code: "MULTI_UNDO_BATCH", message: "workflow-v1 admits exactly one workflow Batch per host undo unit; this plan exceeds the authoritative single-undo operation bound." });
  assert.equal(coordinator.projection().jobs.length, 0, "a forged receipt count cannot create workflow authority");
});

test("workflow-v1 refuses a plan whose reported single-group count disagrees with its authoritative operation count", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("forged-two-undo");
  const result = coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 2, authority });
  assert.deepEqual(result, { ok: false, code: "MULTI_UNDO_BATCH", message: "workflow-v1 refused a plan whose reported undo-group count does not match the authoritative host boundary." });
  assert.equal(coordinator.projection().jobs.length, 0);
});

test("workflow admission refuses unknown snapshot-bound target evidence", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const result = coordinator.admitPlan(plan("missing-target"), { jobId: "job-1", undoGroups: 1, authority: withoutTarget(authority) });
  assert.equal(refusalCode(result), "TARGET_EVIDENCE_UNAVAILABLE");
  assert.equal(coordinator.projection().jobs.length, 0);
});

test("pre-dispatch rejection settles a queued batch and releases the workflow lane", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("pre-dispatch");
  assert.equal(coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  coordinator.rejectBeforeApply(value.planId, { planId: value.planId, status: "rejected", postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied" });
  const projection = coordinator.projection();
  assert.equal(projection.batches[0]?.lifecycle, "settled");
  assert.equal(projection.batches[0]?.execution, "rejected_before_apply");
  assert.equal(projection.activeJobId, null, "a known pre-dispatch refusal blocks only this job and releases the idle host lane");
});

test("workflow receipt cannot report more host undo groups than the Batch has operations", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("receipt-multi-undo");
  ready(coordinator, value);
  assert.throws(() => coordinator.receipt(value.planId, { planId: value.planId, status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", undoGroups: 2, afterFingerprint: "snapshot-after" }), /more undo groups than the plan has operations/);
  const batch = batchOf(coordinator, value.planId);
  assert.equal(batch.lifecycle, "executing", "a rejected receipt projection leaves the host lease and legacy settlement untouched");
  assert.equal(coordinator.projection().divergences.length, 0, "a caller can still report the malformed receipt without accepting a contradictory settlement");
});

test("workflow apply refuses raw approval capabilities", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("secret");
  assert.equal(coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  assert.throws(() => coordinator.beginApply(value.planId, "raw-one-time-token", value.snapshotFingerprint), /stable non-secret/);
});

test("workflow admission binds approval to the immutable source plan digest", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("digest-bound");
  assert.equal(coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  const admitted = present(Object.values(coordinator.workflowStore.getState().batches)[0]?.admission ?? undefined, "admission");
  assert.ok(admitted.sourcePlanDigest);
  assert.throws(() => coordinator.bindApproval(value.planId, "approval-ref:wrong", value.snapshotFingerprint, "wrong-source-digest"), /source action-plan digest/);
  coordinator.bindApproval(value.planId, "approval-ref:right", value.snapshotFingerprint, admitted.sourcePlanDigest);
  assert.equal(Object.values(coordinator.workflowStore.getState().batches)[0]?.approval?.sourcePlanDigest, admitted.sourcePlanDigest);
});

test("mutation admission joins highest-risk behavior independent of operation order", () => {
  const target: V2TargetReference = { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" };
  const operationOf = (type: string): Operation => {
    if (type === "set_layer_name") return { type: "set_layer_name", target, name: "Renamed" };
    if (type === "create_layer") return { type: "create_layer", target, layerType: "null", name: "Created" };
    if (type === "remove_layer") return { type: "remove_layer", target, destructive: true };
    throw new Error(`no fixture operation for ${type}`);
  };
  const make = (types: string[]): ActionPlan => ({ ...plan("mutation-order"), operations: types.map(operationOf) });
  assert.equal(mutationBehaviorForPlan(make(["set_layer_name", "create_layer", "set_layer_name"])), "creating");
  assert.equal(mutationBehaviorForPlan(make(["set_layer_name", "remove_layer", "create_layer"])), "destructive");
  assert.equal(mutationBehaviorForPlan(make(["create_layer", "set_layer_name", "remove_layer"])), "creating", "the layer created earlier in the same plan is the plan's own work to remove");
  const precompose: Operation = { type: "precompose_layers", target: { compositionId: "comp-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, layerIds: ["layer-1"], name: "Precompose", newCompositionId: "__new__:precomp", newLayerId: "__new__:precomp-layer" };
  assert.equal(mutationBehaviorForPlan({ ...plan("mutation-precompose"), operations: [precompose] }), "creating");
});

test("removing what this job created is not destructive; removing anything else still is", () => {
  const removal = (layerId: string): ActionPlan => ({ ...plan(`own-${layerId}`), operations: [{ type: "remove_layer", target: { compositionId: "comp-1", layerId, snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, destructive: true }] });
  const owned = new Set(["layer-9"]);
  assert.equal(mutationBehaviorForPlan(removal("layer-9"), owned), "ensuring");
  assert.equal(mutationBehaviorForPlan(removal("layer-1"), owned), "destructive");
  assert.equal(mutationBehaviorForPlan(removal("layer-9")), "destructive", "no job, nothing proven owned");
  assert.equal(mutationBehaviorForPlan(removal("layer-9"), new Set(["layer-8"])), "destructive", "another job's ids do not count");
  assert.equal(classifyWorkflowPolicy(removal("layer-9"), authority, owned).policyClass, "automatic");
  assert.equal(classifyWorkflowPolicy(removal("layer-1"), authority, owned).policyClass, "manual-only");
});

test("WS4 policy verdict keeps probationary, manual-only, and blocked facts distinct", () => {
  const safe = classifyWorkflowPolicy(plan("policy-safe"), authority);
  assert.equal(safe.policyClass, "automatic");
  assert.equal(safe.approvalRequired, true, "the current adapter still requires an explicit approval capability");

  const probationary = classifyWorkflowPolicy(plan("policy-probationary"), { ...authority, hostSupported: false });
  assert.equal(probationary.policyClass, "probationary");
  assert.match(probationary.reasons.join(" "), /probationary/i);

  const partial = classifyWorkflowPolicy(plan("policy-partial"), { ...authority, exactVerification: false });
  assert.equal(partial.policyClass, "manual-only");
  assert.match(partial.reasons.join(" "), /partial/i);

  const destructive: ActionPlan = { ...plan("policy-destructive"), operations: [{ type: "remove_layer", target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, destructive: true }] };
  const manual = classifyWorkflowPolicy(destructive, authority);
  assert.equal(manual.policyClass, "manual-only");
  assert.match(manual.reasons.join(" "), /destructive/i);

  const renderNow: RenderCompositionOperation = { type: "render_composition", compositionId: "comp-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1", outputPath: "/tmp/out.mov", destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" };
  const blocked: ActionPlan = { ...plan("policy-blocked"), operations: [renderNow] };
  const refusal = classifyWorkflowPolicy(blocked, authority);
  assert.equal(refusal.policyClass, "blocked");
  assert.match(refusal.reasons.join(" "), /undo/i);
});

test("workflow admission blocks non-undoable policy before creating ledger authority", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const renderNow: RenderCompositionOperation = { type: "render_composition", compositionId: "comp-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1", outputPath: "/tmp/out.mov", destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" };
  const renderPlan: ActionPlan = { ...plan("policy-preflight-blocked"), operations: [renderNow] };
  const result = coordinator.admitPlan(renderPlan, { jobId: "job-1", undoGroups: 1, authority });
  assert.equal(refusalCode(result), "POLICY_BLOCKED");
  assert.equal(coordinator.projection().jobs.length, 0);
});

test("failed and uncertain legacy receipts remain distinct from applied-unverified", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  ready(coordinator, plan("failed"));
  coordinator.receipt("failed", { planId: "failed", status: "rejected", postcondition: "not_run", mayHaveMutated: true, mutationState: "partial-applied", completedOperations: ["set_layer_name"] });
  assert.equal(coordinator.projection().batches[0]?.execution, "failed_during_apply");
  assert.equal(coordinator.projection().batches[0]?.recovery, "blocked");
});

test("a passed receipt without per-operation readback remains applied-unverified", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  ready(coordinator, plan("passed-without-readback"));
  coordinator.receipt("passed-without-readback", { planId: "passed-without-readback", status: "executed", postcondition: "passed", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" });
  assert.equal(coordinator.projection().batches[0]?.verification, "applied_unverified");
  assert.equal(coordinator.canReconcileLateReceipt("passed-without-readback"), true);
});

test("undo occupies the shared workflow lane and preserves unverified undo evidence", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  ready(coordinator, plan("undo"));
  coordinator.receipt("undo", { planId: "undo", status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" });
  coordinator.requestUndo("undo", "snapshot-after");
  coordinator.claimUndo("undo");
  coordinator.executingUndo("undo");
  const undoReceipt = { planId: "undo", receiptId: "undo-coordinator-retry", operation: "undo_plan", status: "executed", executed: true, afterFingerprint: "snapshot-after-undo" };
  coordinator.undoReceipt("undo", undoReceipt);
  coordinator.undoReceipt("undo", undoReceipt);
  const projection = coordinator.projection();
  assert.equal(projection.batches[0]?.recovery, "undo_unverified");
  assert.equal(projection.activeJobId, null);
});

test("cancellation closes an unclaimed undo deterministically and releases the workflow owner", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("undo-cancel-pending");
  ready(coordinator, value);
  coordinator.receipt(value.planId, { planId: value.planId, status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" });
  const jobId = jobIdOf(coordinator, value.planId);
  coordinator.requestUndo(value.planId, "snapshot-after");
  assert.equal(coordinator.batchForPlan(value.planId)?.recovery.state, "requested");
  coordinator.cancelJob(jobId);
  const batch = batchOf(coordinator, value.planId);
  assert.equal(batch.recovery.state, "blocked");
  assert.equal(batch.recovery.dispatch, "idle");
  assert.equal(coordinator.workflowStore.getState().activeDispatchLease, null);
  assert.equal(coordinator.workflowStore.getState().activeJobId, null);
});

test("cancellation during undo retains the lease until unknown settlement, then accepts one guarded late receipt", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("undo-cancel-executing");
  ready(coordinator, value);
  coordinator.receipt(value.planId, { planId: value.planId, status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" });
  const jobId = jobIdOf(coordinator, value.planId);
  coordinator.requestUndo(value.planId, "snapshot-after");
  coordinator.beginUndo(value.planId);
  coordinator.cancelJob(jobId);
  assert.equal(coordinator.batchForPlan(value.planId)?.recovery.dispatch, "executing");
  assert.equal(coordinator.workflowStore.getState().activeDispatchLease?.kind, "undo");
  coordinator.undoReceipt(value.planId, { receiptId: "undo-lost", planId: value.planId, status: "unknown", operation: "undo_plan" });
  const uncertain = batchOf(coordinator, value.planId);
  assert.equal(uncertain.recovery.state, "unknown");
  assert.equal(uncertain.recovery.dispatch, "idle");
  assert.equal(coordinator.workflowStore.getState().activeDispatchLease, null);
  assert.equal(coordinator.workflowStore.getState().activeJobId, null);
  coordinator.reconcileUndo(value.planId, { receiptId: "undo-late", planId: value.planId, status: "executed", operation: "undo_plan", afterFingerprint: "snapshot-before", undo: { restoredPreApplyFingerprint: true } });
  assert.equal(coordinator.batchForPlan(value.planId)?.recovery.state, "undone");
  assert.equal(coordinator.workflowStore.getState().jobs[jobId]?.status, "cancelled");
  assert.equal(coordinator.workflowStore.getState().activeDispatchLease, null);
  assert.throws(() => coordinator.reconcileUndo(value.planId, { receiptId: "undo-late", planId: value.planId, status: "executed", operation: "undo_plan", afterFingerprint: "other", undo: { restoredPreApplyFingerprint: true } }), /already applied|DUPLICATE_EVENT_CONFLICT/);
});
