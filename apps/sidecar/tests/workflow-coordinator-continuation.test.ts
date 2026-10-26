// Tests for workflow coordinator continuation: sequential batches, observations, verification contracts, creator bindings and terminal receipts.

import type { StoredReceipt } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlan } from "@extynt/action-plan";
import { safeWorkflowDiagnostic, WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { present } from "./agent-test-support.js";
import { at, authority, batchIdOf, batchOf, jobIdOf, plan, ready, refusalCode, verifiedReceipt } from "./workflow-coordinator-fixture.js";

test("one explicit workflow job admits sequential receipt-gated batches and exports only verified bindings", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const first = {
    ...plan("cycle-1", "Create the first bounded change"),
    operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, layerType: "text", name: "Created layer", text: "Created layer" }],
  } satisfies ActionPlan;
  ready(coordinator, first);
  const jobId = jobIdOf(coordinator, first.planId);
  const firstBatchId = batchIdOf(coordinator, first.planId);
  coordinator.receipt(first.planId, verifiedReceipt("receipt-cycle-1", { "__new__:layer": "layer-created-1" }, "create_layer", { layerId: "layer-created-1" }));

  const second = plan("cycle-2", "Continue from the verified receipt", "snapshot-after-receipt-cycle-1");
  const admitted = coordinator.admitPlan(second, { jobId: "job-1", undoGroups: 1, authority });
  assert.equal(admitted.ok, true);
  if (!admitted.ok) return;
  assert.deepEqual(coordinator.workflowStore.getState().batches[admitted.batchId]?.dependencies, [firstBatchId]);
  coordinator.queue(second.planId);
  coordinator.bindApproval(second.planId, authority.policyApprovalId, second.snapshotFingerprint);
  coordinator.claim(second.planId);
  coordinator.executing(second.planId);
  coordinator.receipt(second.planId, verifiedReceipt("receipt-cycle-2"));

  const continuation = coordinator.continuation(jobId, { fingerprint: "snapshot-after-cycle-2", revision: "3" }, 2);
  assert.equal(continuation.jobId, jobId);
  assert.equal(continuation.batchCount, 2);
  assert.equal(continuation.createdIdBindings[0]?.createdId, "layer-created-1");
  assert.equal(continuation.settledBatches.length, 2);
  assert.deepEqual(continuation.blockers, []);
  assert.ok(continuation.capabilities?.operationFamilies.length);
  assert.ok(continuation.capabilities?.stableCore.includes("set_layer_name"));
  const capabilityKeys = [...JSON.stringify(continuation.capabilities).matchAll(/"([^"]+)":/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(capabilityKeys, /\b(?:job|stage|receipt|approval|retry|resume)\b/i, "capability disclosure contains schemas and descriptions, never workflow lifecycle state");
  const serialized = JSON.stringify(continuation);
  assert.doesNotMatch(serialized, /prompt|reasoning|secret|toolArguments/i);
});

test("apply receipts remain structural while read-only visual and temporal observations stay explicit", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value = plan("receipt-observations");
  ready(coordinator, value);
  coordinator.receipt(value.planId, verifiedReceipt("receipt-observations-1"));
  assert.deepEqual(Object.values(coordinator.workflowStore.getState().observations), [], "apply receipts do not promote visual or temporal claims");
  const jobId = jobIdOf(coordinator, value.planId);
  const { stageId } = batchOf(coordinator, value.planId);
  coordinator.recordObservation(jobId, { evidenceId: "observation-visual-1", jobId, stageId, kind: "visual", basis: "headless frame measurement", observedFingerprint: "snapshot-after-receipt-observations-1", recordedAt: at.toISOString() });
  coordinator.recordObservation(jobId, { evidenceId: "observation-temporal-1", jobId, stageId, kind: "temporal", basis: "headless temporal measurement", observedFingerprint: "snapshot-after-receipt-observations-1", recordedAt: at.toISOString() });
  const observations = Object.values(coordinator.workflowStore.getState().observations);
  assert.deepEqual(observations.map((entry) => entry.kind).sort(), ["temporal", "visual"]);
  assert.deepEqual(coordinator.projection().observations.map((entry) => entry.kind).sort(), ["temporal", "visual"]);
  assert.equal(coordinator.batchForPlan(value.planId)?.verification.state, "verified");

  const unavailable = new WorkflowCoordinator({ now: () => at });
  const unavailablePlan = plan("receipt-observations-unavailable");
  ready(unavailable, unavailablePlan);
  unavailable.receipt(unavailablePlan.planId, { planId: unavailablePlan.planId, status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied" });
  assert.deepEqual(Object.values(unavailable.workflowStore.getState().observations), []);
  assert.equal(unavailable.batchForPlan(unavailablePlan.planId)?.verification.state, "applied_unverified");
});

test("admission carries typed postcondition contracts and settlement retains host-enforced evidence", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const value: ActionPlan = { ...plan("verification-contract"), postconditions: [{ code: "FRAME_MEASURED", description: "A visual frame measurement matches the requested appearance." }] };
  assert.equal(coordinator.admitPlan(value, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  const batch = batchOf(coordinator, value.planId);
  const admission = present(batch.admission ?? undefined, "admission");
  assert.deepEqual(admission.postconditions?.map((entry) => [entry.kind, entry.required]), [["structural", true]]);
  coordinator.queue(value.planId);
  coordinator.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.claim(value.planId);
  coordinator.executing(value.planId);
  coordinator.receipt(value.planId, {
    ...verifiedReceipt("verification-contract-receipt"),
    postconditions: [{ postconditionId: present(admission.postconditions?.[0], "postcondition").postconditionId, kind: "structural", state: "passed", basis: "fixture structural readback", observedFingerprint: "snapshot-after-verification-contract-receipt" }],
  });
  assert.equal(coordinator.batchForPlan(value.planId)?.verification.postconditions?.[0]?.state, "passed");
});

test("host-enforced evidence from a receipt is retained and projected", () => {
  const host = new WorkflowCoordinator({ now: () => at });
  const hostPlan: ActionPlan = { ...plan("host-evidence"), selectionFingerprint: "workflow-selection", operations: [{ type: "set_project_settings", snapshotFingerprint: "snapshot-before", selectionFingerprint: "workflow-selection", settings: { linearBlending: true } }] };
  assert.equal(host.admitPlan(hostPlan, { jobId: "host-job", undoGroups: 1, authority }).ok, true);
  host.queue(hostPlan.planId);
  host.bindApproval(hostPlan.planId, authority.policyApprovalId, hostPlan.snapshotFingerprint);
  host.claim(hostPlan.planId);
  host.executing(hostPlan.planId);
  host.receipt(hostPlan.planId, { planId: hostPlan.planId, receiptId: "host-evidence-receipt", status: "executed", postcondition: "passed", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after-host-evidence", verification: { state: "exact", steps: [{ operation: "set_project_settings", verificationState: "applied_unverified", observed: false, hostVerification: "project-settings-read-back", basis: "project-settings-host-read-back" }] } });
  const hostEvidence = present(Object.values(host.workflowStore.getState().hostEvidence)[0], "host evidence");
  assert.equal(Object.keys(host.workflowStore.getState().hostEvidence).length, 1);
  assert.equal(hostEvidence.kind, "host_evidence");
  const hostProjection = host.projection();
  assert.equal(hostProjection.hostEvidence.length, 1);
  assert.equal(present(hostProjection.hostEvidence[0], "projected evidence").operationId, hostEvidence.operationId);
  assert.equal(present(hostProjection.batches[0]?.receipt ?? undefined, "projected receipt").hostEvidence.length, 1);
  assert.equal(host.batchForPlan(hostPlan.planId)?.verification.state, "verified");
});

test("duplicate creator bindings across verified batches are poisoned instead of resolving dependents", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const creator = (planId: string, snapshotFingerprint = "snapshot-before"): ActionPlan => ({
    ...plan(planId, "Renamed", snapshotFingerprint),
    operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint, selectionFingerprint: "selection-1" }, layerType: "text", name: "Created", text: "Created" }],
  });
  const first = creator("duplicate-binding-first");
  ready(coordinator, first);
  const jobId = jobIdOf(coordinator, first.planId);
  coordinator.receipt(first.planId, verifiedReceipt("duplicate-binding-receipt-1", { "__new__:layer": "layer-created-1" }, "create_layer", { layerId: "layer-created-1" }));
  const second = creator("duplicate-binding-second", "snapshot-after-duplicate-binding-receipt-1");
  assert.equal(coordinator.admitPlan(second, { jobId: "job-1", undoGroups: 1, authority }).ok, true);
  coordinator.queue(second.planId);
  coordinator.bindApproval(second.planId, authority.policyApprovalId, second.snapshotFingerprint);
  coordinator.claim(second.planId);
  coordinator.executing(second.planId);
  coordinator.receipt(second.planId, verifiedReceipt("duplicate-binding-receipt-2", { "__new__:layer": "layer-created-2" }, "create_layer", { layerId: "layer-created-2" }));
  const continuation = coordinator.continuation(jobId, { fingerprint: "snapshot-after-duplicates", revision: "3" }, 2);
  assert.deepEqual(continuation.createdIdBindings, [], "a later creator cannot shadow the earlier placeholder identity");
});

test("creator bindings reject invented placeholders and mismatched readback ids", () => {
  for (const [label, created, stepId] of [
    ["invented-placeholder", { "__new__:invented": "layer-created-1" }, "layer-created-1"],
    ["mismatched-readback", { "__new__:layer": "layer-invented-1" }, "layer-created-1"],
  ] as const) {
    const coordinator = new WorkflowCoordinator({ now: () => at });
    const value = {
      ...plan(`creator-${label}`),
      operations: [{ type: "create_layer", target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, layerType: "text", name: "Created", text: "Created" }],
    } satisfies ActionPlan;
    ready(coordinator, value);
    const jobId = jobIdOf(coordinator, value.planId);
    coordinator.receipt(value.planId, verifiedReceipt(`receipt-${label}`, created, "create_layer", { layerId: stepId }));
    const continuation = coordinator.continuation(jobId, { fingerprint: `snapshot-after-${label}`, revision: "2" }, 1);
    assert.deepEqual(continuation.createdIdBindings, [], label);
  }
});

test("continuation provider blockers are bounded and redact host script details", () => {
  const coordinator = new WorkflowCoordinator({ now: () => at });
  const jobId = coordinator.openJob("goal-redaction", "Create a title safely");
  coordinator.recordProviderFailure(jobId, "PROVIDER_FAILED", "#target aftereffects; app.project.activeItem.name = 'secret'; token=x", true);
  const continuation = coordinator.continuation(jobId, { fingerprint: "snapshot-redaction", revision: "1" }, 1);
  const serialized = JSON.stringify(continuation);
  assert.doesNotMatch(serialized, /#target|app\.project|token=x|secret/i);
  assert.match(serialized, /redacted-host-detail/);
});

test("sidecar diagnostics do not retain suffixes of quoted assignment secrets", () => {
  const diagnostic = safeWorkflowDiagnostic(`provider failed token="quoted secret with spaces and suffix" password='another quoted value'`);
  assert.doesNotMatch(diagnostic, /quoted secret|another quoted value|suffix/i);
  assert.match(diagnostic, /token=\[redacted\]/i);
  assert.match(diagnostic, /password=\[redacted\]/i);
});

test("failed, unverified, or uncertain creators cannot unlock a dependent workflow batch", () => {
  const creators: Array<{ label: string; receipt: StoredReceipt; blocker: RegExp }> = [
    {
      label: "failed",
      receipt: { receiptId: "receipt-failed-creator", status: "rejected", postcondition: "not_run", mayHaveMutated: true, mutationState: "partial-applied", hostError: { code: "HOST_ABORTED", message: "the host stopped after a partial write" } },
      blocker: /failed/,
    },
    {
      label: "applied-unverified",
      receipt: { receiptId: "receipt-unverified-creator", status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after-unverified", verification: { state: "applied_unverified", basis: "no panel readback" } },
      blocker: /applied_unverified/,
    },
    {
      label: "uncertain",
      receipt: { receiptId: "receipt-uncertain-creator", status: "unknown", postcondition: "unknown", mayHaveMutated: true, mutationState: "mutation-unknown", verification: { state: "unknown", basis: "lost host receipt" } },
      blocker: /unknown/,
    },
  ];
  for (const creator of creators) {
    const coordinator = new WorkflowCoordinator({ now: () => at });
    const first = plan(`${creator.label}-creator`);
    ready(coordinator, first);
    const jobId = jobIdOf(coordinator, first.planId);
    coordinator.receipt(first.planId, creator.receipt);
    const dependent = coordinator.admitPlan(plan(`dependent-after-${creator.label}`), { jobId: "job-1", undoGroups: 1, authority });
    assert.equal(refusalCode(dependent), "ILLEGAL_TRANSITION", creator.label);
    const continuation = coordinator.continuation(jobId, { fingerprint: `snapshot-${creator.label}`, revision: "2" }, 1);
    assert.equal(continuation.createdIdBindings.length, 0, creator.label);
    assert.ok(continuation.blockers.some((blocker) => creator.blocker.test(blocker)), creator.label);
  }
});

test("blocked terminal receipt classes release the lane for an unrelated job while retaining evidence", () => {
  const cases: Array<{ label: string; settle: (coordinator: WorkflowCoordinator, planId: string) => void }> = [
    { label: "pre-dispatch", settle: (coordinator, planId) => coordinator.rejectBeforeApply(planId, { planId, status: "rejected", postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied" }) },
    { label: "failed", settle: (coordinator, planId) => coordinator.receipt(planId, { planId, status: "rejected", postcondition: "failed", mayHaveMutated: true, mutationState: "partial-applied", completedOperations: ["set_layer_name"] }) },
    { label: "uncertain", settle: (coordinator, planId) => coordinator.receipt(planId, { planId, status: "unknown", postcondition: "unknown", mayHaveMutated: true, mutationState: "mutation-unknown" }) },
    { label: "unverified", settle: (coordinator, planId) => coordinator.receipt(planId, { planId, status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "snapshot-after" }) },
  ];
  for (const { label, settle } of cases) {
    const coordinator = new WorkflowCoordinator({ now: () => at });
    const first = plan(`terminal-${label}`);
    assert.equal(coordinator.admitPlan(first, { jobId: `prior-${label}`, undoGroups: 1, authority }).ok, true);
    coordinator.queue(first.planId);
    if (label !== "pre-dispatch") {
      coordinator.bindApproval(first.planId, authority.policyApprovalId, first.snapshotFingerprint);
      coordinator.claim(first.planId);
      coordinator.executing(first.planId);
    }
    settle(coordinator, first.planId);
    assert.equal(coordinator.projection().activeJobId, null, label);
    const next = plan(`next-${label}`);
    const admitted = coordinator.admitPlan(next, { jobId: `next-job-${label}`, undoGroups: 1, authority });
    assert.equal(admitted.ok, true, label);
    assert.equal(coordinator.projection().batches.length, 2, label);
  }
});
