// Tests receipt, postcondition and host-evidence validation.

import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { applyWorkflowEvent, computeWorkflowBatchDigest, replayWorkflowEvents } from "../src/index.js";
import { at, op, dimensionsFor, event, digestFor, authorityEvents, baseEvents, executingState, receipt, throwsCode } from "./fixtures.js";

test("created bindings are rejected unless the receipt is verified", () => {
  const executing = executingState();
  throwsCode(() => applyWorkflowEvent(executing, event("batch.receipt", {
    jobId: "job-1",
    batchId: "batch-1",
    receipt: receipt({ receiptId: "unverified-binding", verification: "applied_unverified", verificationBasis: "no readback", createdBindings: [{ placeholder: "__new__:layer", createdId: "layer-created-1", operationId: "batch-1:op:0", readbackField: "layerId", observedFingerprint: "snap-2" }] }),
  }, "unverified-binding-event")), "INVALID_RECEIPT");
});

test("receipts retain correlated host evidence in the workflow ledger", () => {
  const evidence = { evidenceId: "host-evidence-1", jobId: "job-1", batchId: "batch-1", operationId: "batch-1:op:0", kind: "structural" as const, basis: "fresh readback", observedFingerprint: "snap-2", recordedAt: at };
  const settled = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ hostEvidence: [evidence] }) }, "host-evidence-receipt"));
  assert.deepEqual(settled.hostEvidence["host-evidence-1"], evidence);
  throwsCode(() => applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ hostEvidence: [{ ...evidence, jobId: "other-job" }] }) }, "host-evidence-wrong-owner")), "WRONG_OWNER");
});

test("verified receipts must pass every required admitted postcondition", () => {
  const contract = { postconditionId: "readback-layer-name", kind: "structural" as const, description: "The layer name matches the requested value.", required: true };
  const events = baseEvents().slice(0, 11);
  const admitted = event("batch.admitted", {
    jobId: "job-1", stageId: "stage-1", batchId: "batch-1",
    digest: computeWorkflowBatchDigest({ jobId: "job-1", stageId: "stage-1", batchId: "batch-1", dependencies: [], snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1"), postconditions: [contract], operations: [{ operationId: "batch-1:op:0", ordinal: 0, type: "set_layer_name", payload: op() }] }),
    snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1"), postconditions: [contract],
  }, "postcondition-admit");
  const executing = replayWorkflowEvents([
    ...events,
    admitted,
    event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "postcondition-queue"),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "postcondition-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "postcondition-execute"),
  ]);
  const passed = { postconditionId: contract.postconditionId, kind: contract.kind, state: "passed" as const, basis: "fresh structural readback", observedFingerprint: "snap-2" };
  const settled = applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ postconditions: [passed] }) }, "postcondition-pass"));
  assert.equal(settled.batches["batch-1"]?.verification.postconditions?.[0]?.state, "passed");
  throwsCode(() => applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "postcondition-missing", postconditions: [] }) }, "postcondition-missing")), "INVALID_RECEIPT");
});

test("reducer correlates created bindings to the admitted creator, exact readback, and receipt snapshot", () => {
  const creator: ActionPlanV2Operation = {
    type: "create_layer",
    target: { compositionId: "comp-1", layerId: "__new__:layer", snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" },
    layerType: "text",
    name: "Title",
    text: "Title",
  };
  const events = [
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: creator }, "binding-adversarial-operation"),
    ...authorityEvents("job-1", "batch-1", "binding-adversarial"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: digestFor("batch-1", { payloads: [creator] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1") }, "binding-adversarial-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "binding-adversarial-queue"),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "binding-adversarial-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "binding-adversarial-execute"),
  ];
  const executing = replayWorkflowEvents(events);
  const validOutcome = { operationId: "batch-1:op:0", ordinal: 0, type: "create_layer", outcome: "confirmed" as const, mutation: "applied" as const, verification: "verified" as const, mayHaveMutated: true, basis: "fresh-readback" };
  const validBinding = { placeholder: "__new__:layer", createdId: "layer-created-1", operationId: "batch-1:op:0", readbackField: "layerId", observedFingerprint: "snap-2" };
  const valid = applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ createdBindings: [validBinding], outcomes: [validOutcome] }) }, "binding-valid"));
  assert.equal(valid.batches["batch-1"]?.execution.receipt?.createdBindings?.[0]?.operationId, "batch-1:op:0");

  for (const [label, binding] of [
    ["invented-placeholder", { ...validBinding, placeholder: "__new__:invented" }],
    ["wrong-operation", { ...validBinding, operationId: "batch-1:op:99" }],
    ["wrong-readback", { ...validBinding, readbackField: "compositionId" }],
    ["wrong-snapshot", { ...validBinding, observedFingerprint: "other-snapshot" }],
  ] as const) {
    throwsCode(() => applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: `binding-${label}`, createdBindings: [binding], outcomes: [validOutcome] }) }, `binding-${label}`)), "INVALID_RECEIPT");
  }
});

test("receipt evidence dimensions reject contradictions and compare complete duplicates", () => {
  const executing = executingState();
  throwsCode(() => applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ execution: "rejected_before_apply", verification: "verified", verificationBasis: "impossible", observedFingerprint: "snap-2" }) }, "contradictory")), "INVALID_RECEIPT");
  const settled = applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "first-receipt"));
  throwsCode(() => applyWorkflowEvent(settled, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receivedAt: "2026-09-20T12:00:01.000Z" }) }, "same-id-different-time")), "DUPLICATE_EVENT_CONFLICT");
  const undoRequested = applyWorkflowEvent(settled, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "undo-request"));
  const undoClaimed = applyWorkflowEvent(undoRequested, event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "undo-claim"));
  const undoReceipt = { receiptId: "undo-1", status: "executed" as const, verification: "restored" as const, receivedAt: at, restoredFingerprint: "snap-1", basis: "host-readback" };
  const undone = applyWorkflowEvent(applyWorkflowEvent(undoClaimed, event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "undo-execute")), event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: undoReceipt }, "undo-receipt"));
  throwsCode(() => applyWorkflowEvent(undone, event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { ...undoReceipt, basis: "different" } }, "undo-conflict")), "DUPLICATE_EVENT_CONFLICT");
});

test("completion requires evidence-backed job and stage criteria and verified non-cancelled batches", () => {
  const criteriaEvents = [
    event("job.opened", { jobId: "job-criteria", engineId: "workflow-v1", title: "Criteria job", goalSummary: "Prove explicit completion", successCriteria: [{ criterionId: "job-verified", description: "The job evidence is recorded" }] }, "criteria-job-open"),
    event("stage.opened", { jobId: "job-criteria", stageId: "stage-criteria", title: "Stage", purpose: "Verify the resulting host state", successCriteria: [{ criterionId: "stage-verified", description: "The stage evidence is recorded" }] }, "criteria-stage-open"),
    event("batch.proposed", { jobId: "job-criteria", stageId: "stage-criteria", batchId: "batch-criteria", summary: "A verified operation", dependencies: [] }, "criteria-batch-propose"),
    event("operation.proposed", { jobId: "job-criteria", stageId: "stage-criteria", batchId: "batch-criteria", ordinal: 0, payload: op() }, "criteria-operation-propose"),
    ...authorityEvents("job-criteria", "batch-criteria"),
    event("batch.admitted", { jobId: "job-criteria", stageId: "stage-criteria", batchId: "batch-criteria", digest: digestFor("batch-criteria", { payloads: [op()], snapshotFingerprint: "snap-1", dependencies: [], jobId: "job-criteria", stageId: "stage-criteria" }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-criteria", undoUnitCount: 1, dimensions: dimensionsFor("batch-criteria") }, "criteria-batch-admit"),
    event("batch.queued", { jobId: "job-criteria", batchId: "batch-criteria" }, "criteria-batch-queue"),
    event("batch.claimed", { jobId: "job-criteria", batchId: "batch-criteria" }, "criteria-batch-claim"),
    event("batch.executing", { jobId: "job-criteria", batchId: "batch-criteria" }, "criteria-batch-execute"),
    event("batch.receipt", { jobId: "job-criteria", batchId: "batch-criteria", receipt: receipt({ receiptId: "criteria-receipt" }) }, "criteria-batch-receipt"),
  ];
  const settled = replayWorkflowEvents(criteriaEvents);
  throwsCode(() => applyWorkflowEvent(settled, event("stage.completed", { jobId: "job-criteria", stageId: "stage-criteria" }, "criteria-stage-too-early")), "ILLEGAL_TRANSITION");
  const stageSatisfied = applyWorkflowEvent(settled, event("criterion.satisfied", { jobId: "job-criteria", scope: "stage", stageId: "stage-criteria", criterionId: "stage-verified", reference: { kind: "batch_receipt", batchId: "batch-criteria", receiptId: "criteria-receipt" } }, "criteria-stage-evidence"));
  const stageComplete = applyWorkflowEvent(stageSatisfied, event("stage.completed", { jobId: "job-criteria", stageId: "stage-criteria" }, "criteria-stage-complete"));
  throwsCode(() => applyWorkflowEvent(stageComplete, event("job.completed", { jobId: "job-criteria" }, "criteria-job-too-early")), "ILLEGAL_TRANSITION");
  const jobSatisfied = applyWorkflowEvent(stageComplete, event("criterion.satisfied", { jobId: "job-criteria", scope: "job", criterionId: "job-verified", reference: { kind: "batch_receipt", batchId: "batch-criteria", receiptId: "criteria-receipt" } }, "criteria-job-evidence"));
  assert.equal(applyWorkflowEvent(jobSatisfied, event("job.completed", { jobId: "job-criteria" }, "criteria-job-complete")).jobs["job-criteria"]?.status, "completed");

  const cancelled = applyWorkflowEvent(replayWorkflowEvents(baseEvents()), event("job.cancelled", { jobId: "job-1" }, "criteria-cancelled"));
  throwsCode(() => applyWorkflowEvent(cancelled, event("stage.completed", { jobId: "job-1", stageId: "stage-1" }, "cancelled-stage-complete")), "ILLEGAL_TRANSITION");
});

test("a visual acceptance criterion cannot be satisfied by structural or write-receipt evidence", () => {
  throwsCode(() => replayWorkflowEvents([
    event("job.opened", { jobId: "unbound-visual-job", engineId: "workflow-v1", title: "Unbound visual", goalSummary: "Reject unbound visual evidence.", successCriteria: [] }, "unbound-visual-open"),
    event("observation.recorded", { jobId: "unbound-visual-job", evidence: { evidenceId: "unbound-frame", jobId: "unbound-visual-job", kind: "visual", basis: "a frame with no snapshot identity", recordedAt: at } }, "unbound-frame-recorded"),
  ]), "INVALID_EVENT");
  const opened = replayWorkflowEvents([
    event("job.opened", { jobId: "visual-job", engineId: "workflow-v1", title: "Visual validation", goalSummary: "Validate the rendered frame.", successCriteria: [{ criterionId: "frame-looks-right", description: "The rendered frame matches the art direction.", requiredEvidenceKind: "visual" }] }, "visual-job-open"),
    event("observation.recorded", { jobId: "visual-job", evidence: { evidenceId: "structure-only", jobId: "visual-job", kind: "structural", basis: "host property read-back", recordedAt: at } }, "structure-only-recorded"),
    event("observation.recorded", { jobId: "visual-job", evidence: { evidenceId: "render-reviewed", jobId: "visual-job", kind: "visual", basis: "product owner reviewed a rendered frame", observedFingerprint: "snap-render", recordedAt: at } }, "render-reviewed-recorded"),
  ]);
  throwsCode(() => applyWorkflowEvent(opened, event("criterion.satisfied", { jobId: "visual-job", scope: "job", criterionId: "frame-looks-right", reference: { kind: "observation", evidenceId: "structure-only" } }, "visual-wrong-kind")), "INVALID_EVENT");
  const satisfied = applyWorkflowEvent(opened, event("criterion.satisfied", { jobId: "visual-job", scope: "job", criterionId: "frame-looks-right", reference: { kind: "observation", evidenceId: "render-reviewed" } }, "visual-right-kind"));
  assert.equal(satisfied.jobs["visual-job"]?.satisfiedCriteria["frame-looks-right"]?.evidenceKind, "visual");
});

test("legacy structural read-back cannot masquerade as passed visual or temporal evidence", () => {
  const contract = { postconditionId: "rendered-frame", kind: "visual" as const, description: "Review the rendered frame.", required: true };
  const payload = op();
  const events = [
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload }, "legacy-visual-operation"),
    ...authorityEvents("job-1", "batch-1", "legacy-visual"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: computeWorkflowBatchDigest({ jobId: "job-1", stageId: "stage-1", batchId: "batch-1", dependencies: [], snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1"), postconditions: [contract], operations: [{ operationId: "batch-1:op:0", ordinal: 0, type: payload.type, payload }] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1"), postconditions: [contract] }, "legacy-visual-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "legacy-visual-queue"),
  ];
  const executing = executingState(events);
  throwsCode(() => applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "legacy-visual-receipt", postconditions: [{ postconditionId: "rendered-frame", kind: "visual", state: "passed", basis: "legacy receipt structural readback", observedFingerprint: "snap-2" }] }) }, "legacy-visual-receipt-event")), "INVALID_RECEIPT");
});

test("preserves per-operation receipt truth and allows executed readback mismatch", () => {
  const twoOps = [
    ...baseEvents().slice(0, 3),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 0, payload: op("A") }, "row-op-0"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 1, payload: op("B") }, "row-op-1"),
    ...authorityEvents("job-1", "batch-1"),
  ];
  const admitted = event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", digest: digestFor("batch-1", { payloads: [op("A"), op("B")] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-1") }, "row-admit");
  const executing = applyWorkflowEvent(replayWorkflowEvents([...twoOps, admitted, event("batch.queued", { jobId: "job-1", batchId: "batch-1" }, "row-queue"), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "row-claim")]), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "row-execute"));
  const settled = applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "row-receipt", receivedAt: at, execution: "executed", mutation: "applied", mayHaveMutated: true, verification: "failed", verificationBasis: "readback", observedFingerprint: "snap-other", outcomes: [
    { operationId: "batch-1:op:0", ordinal: 0, type: "set_layer_name", outcome: "applied_before_failure", mutation: "applied", verification: "failed", mayHaveMutated: true },
    { operationId: "batch-1:op:1", ordinal: 1, type: "set_layer_name", outcome: "readback_mismatch", mutation: "applied", verification: "failed", mayHaveMutated: true },
  ] } }, "row-receipt-event"));
  assert.equal(settled.operations["batch-1:op:0"]?.outcome, "applied_before_failure");
  assert.equal(settled.operations["batch-1:op:1"]?.outcome, "readback_mismatch");
  assert.equal(settled.batches["batch-1"]?.verification.state, "failed");
  assert.equal(settled.batches["batch-1"]?.execution.receiptHistory.length, 1);
});

test("reconciliation is explicit, preserves receipt history, and does not clear another blocker", () => {
  const uncertain = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "uncertain-receipt", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown", verificationBasis: "host-hop-timeout", observedFingerprint: "snap-2" }) }, "uncertain-receipt-event"));
  throwsCode(() => applyWorkflowEvent(uncertain, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "ordinary-late" }) }, "ordinary-late")), "ILLEGAL_TRANSITION");
  throwsCode(() => applyWorkflowEvent(uncertain, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "wrong", receipt: receipt({ receiptId: "reconciled", verification: "verified" }) }, "wrong-prior-2")), "INVALID_RECEIPT");
  const good = applyWorkflowEvent(uncertain, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "uncertain-receipt", receipt: receipt({ receiptId: "reconciled", verification: "verified" }) }, "right-reconcile"));
  assert.equal(good.batches["batch-1"]?.execution.receiptHistory.length, 2);
  assert.equal(good.batches["batch-1"]?.execution.receiptHistory[0]?.receiptId, "uncertain-receipt");
  const failed = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "failed-receipt", verification: "failed", verificationBasis: "mismatch", observedFingerprint: "bad" }) }, "failed-receipt-event"));
  throwsCode(() => applyWorkflowEvent(failed, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "failed-receipt", receipt: receipt({ receiptId: "forbidden-reconcile", verification: "verified" }) }, "forbidden-reconcile")), "ILLEGAL_TRANSITION");
  const knownPostconditionFailure = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "known-postcondition-failure", execution: "executed", mutation: "applied", mayHaveMutated: true, verification: "failed", verificationBasis: "readback mismatch", observedFingerprint: "bad" }) }, "known-postcondition-failure-event"));
  throwsCode(() => applyWorkflowEvent(knownPostconditionFailure, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "known-postcondition-failure", receipt: receipt({ receiptId: "forbidden-postcondition-reconcile", verification: "verified" }) }, "forbidden-postcondition-reconcile")), "ILLEGAL_TRANSITION");
});

test("receipt reconciliation rejects reuse of any earlier receipt identity", () => {
  const first = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "receipt-1", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown", verificationBasis: "host-hop-timeout", observedFingerprint: "snap-2" }) }, "receipt-first"));
  const second = applyWorkflowEvent(first, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "receipt-1", receipt: receipt({ receiptId: "receipt-2" }) }, "receipt-second"));
  throwsCode(() => applyWorkflowEvent(second, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "receipt-2", receipt: receipt({ receiptId: "receipt-1" }) }, "receipt-reuse")), "DUPLICATE_EVENT_CONFLICT");
});
