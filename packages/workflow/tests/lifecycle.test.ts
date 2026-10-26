// Tests the reducer through full job, stage and batch lifecycles, including cancellation, repair and undo.

import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { applyWorkflowEvent, createInMemoryWorkflowStore, replayWorkflowEvents, serializeWorkflowState } from "../src/index.js";
import { at, op, dimensionsFor, event, digestFor, authorityEvents, baseEvents, claimedState, executingState, receipt, throwsCode, createWorkflowStateForTest, parsedObject, present } from "./fixtures.js";

test("models a legal job, stage, admitted batch, receipt, and guarded undo", () => {
  const events = [
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "batch-1-execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "batch-1-receipt"),
    event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "batch-1-undo-request"),
    event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-undo-claim"),
    event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "batch-1-undo-execute"),
    event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "undo-receipt-1", status: "executed", verification: "restored", receivedAt: at, restoredFingerprint: "snap-1" } }, "batch-1-undo-receipt"),
  ];
  const state = replayWorkflowEvents(events);
  const batch = present(state.batches["batch-1"]);
  assert.equal(state.jobs["job-1"]?.status, "active");
  assert.equal(state.stages["stage-1"]?.status, "active");
  assert.equal(batch.lifecycle, "settled");
  assert.equal(batch.execution.state, "executed");
  assert.equal(batch.verification.state, "verified");
  assert.equal(batch.recovery.state, "undone");
  assert.equal(batch.recovery.lineage?.restoredFingerprint, "snap-1");
  assert.equal(state.activeDispatchLease, null);
  assert.equal(state.operations["batch-1:op:0"]?.status, "verified");
  assert.equal(batch.admission?.operations[0]?.payload.type, "set_layer_name");
});

test("admission freezes the digest, snapshot identity, and typed operation payload", () => {
  const state = replayWorkflowEvents(baseEvents());
  const admission = present(state.batches["batch-1"]?.admission);
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.operations), true);
  assert.equal(Object.isFrozen(admission.operations[0]), true);
  assert.equal(Object.isFrozen(admission.operations[0]?.payload), true);
  assert.throws(() => Reflect.apply(Array.prototype.push, admission.operations, [{}]), TypeError);
  throwsCode(() => applyWorkflowEvent(state, event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-1", ordinal: 1, payload: op("Late") }, "op-2-propose")), "IMMUTABLE_ADMISSION");
});

test("enforces dependencies and exactly one active dispatch lane", () => {
  const first = baseEvents();
  const withSnapshot = (name: string, snapshotFingerprint: string): ActionPlanV2Operation => ({
    type: "set_layer_name",
    target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint, selectionFingerprint: "sel-1" },
    name,
  });
  const postApplyOperation = withSnapshot("Animated", "snap-2");
  const secondProposal = [
    event("batch.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", summary: "Animate the title", dependencies: ["batch-1"] }, "batch-2-propose"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", ordinal: 0, payload: postApplyOperation }, "op-2-propose"),
    ...authorityEvents("job-1", "batch-2", "batch-2", "snap-2"),
  ];
  const third = [
    event("batch.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-3", summary: "Independent change", dependencies: [] }, "batch-3-propose"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-3", ordinal: 0, payload: op("Independent") }, "op-3-propose"),
    ...authorityEvents("job-1", "batch-3", "batch-3"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-3", digest: digestFor("batch-3", { payloads: [op("Independent")] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-3", undoUnitCount: 1, dimensions: dimensionsFor("batch-3") }, "batch-3-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-3" }, "batch-3-queue"),
  ];
  const queued = replayWorkflowEvents([...first, ...secondProposal, ...third]);
  throwsCode(() => applyWorkflowEvent(queued, event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", digest: digestFor("batch-2", { payloads: [postApplyOperation], snapshotFingerprint: "snap-2", dependencies: ["batch-1"] }), snapshotFingerprint: "snap-2", undoUnitId: "undo-batch-2", undoUnitCount: 1, dimensions: dimensionsFor("batch-2") }, "batch-2-admit-before-dependency")), "DEPENDENCY_BLOCKED");
  const firstClaimed = applyWorkflowEvent(queued, event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-claim"));
  throwsCode(() => applyWorkflowEvent(firstClaimed, event("batch.claimed", { jobId: "job-1", batchId: "batch-3" }, "batch-3-claim-lane-busy")), "DISPATCH_LANE_BUSY");
  const firstSettled = applyWorkflowEvent(applyWorkflowEvent(firstClaimed, event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "batch-1-execute")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "batch-1-receipt"));
  const staleOperation = withSnapshot("Stale", "snap-1");
  const staleBatch = [
    event("batch.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-stale", summary: "Stale descendant", dependencies: ["batch-1"] }, "batch-stale-propose"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-stale", ordinal: 0, payload: staleOperation }, "batch-stale-operation"),
    ...authorityEvents("job-1", "batch-stale", "batch-stale", "snap-1"),
  ];
  const staleQueued = replayWorkflowEvents([...first, ...staleBatch, ...secondProposal, ...third]);
  const staleFirstClaimed = applyWorkflowEvent(staleQueued, event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-claim-stale-check"));
  const staleFirstSettled = applyWorkflowEvent(applyWorkflowEvent(staleFirstClaimed, event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "batch-1-execute-stale-check")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "batch-1-stale-check-receipt" }) }, "batch-1-receipt-stale-check"));
  const staleAdmission = event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-stale", digest: digestFor("batch-stale", { payloads: [staleOperation], snapshotFingerprint: "snap-1", dependencies: ["batch-1"] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-stale", undoUnitCount: 1, dimensions: dimensionsFor("batch-stale") }, "batch-stale-admit-stale-snapshot");
  throwsCode(() => applyWorkflowEvent(staleFirstSettled, staleAdmission), "DEPENDENCY_BLOCKED");
  const secondAdmitted = applyWorkflowEvent(firstSettled, event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", digest: digestFor("batch-2", { payloads: [postApplyOperation], snapshotFingerprint: "snap-2", dependencies: ["batch-1"] }), snapshotFingerprint: "snap-2", undoUnitId: "undo-batch-2", undoUnitCount: 1, dimensions: dimensionsFor("batch-2") }, "batch-2-admit-after-dependency"));
  const secondClaimed = applyWorkflowEvent(applyWorkflowEvent(secondAdmitted, event("batch.queued", { jobId: "job-1", batchId: "batch-2" }, "batch-2-queue")), event("batch.claimed", { jobId: "job-1", batchId: "batch-2" }, "batch-2-claim-after-dependency"));
  assert.deepEqual(secondClaimed.activeDispatchLease, { kind: "apply", jobId: "job-1", batchId: "batch-2" });
});

test("cancellation blocks future dispatch but late evidence settles a claimed batch", () => {
  const queued = replayWorkflowEvents(baseEvents());
  const cancelled = applyWorkflowEvent(queued, event("job.cancelled", { jobId: "job-1" }, "job-1-cancel"));
  assert.equal(cancelled.jobs["job-1"]?.status, "cancelled");
  assert.equal(cancelled.batches["batch-1"]?.lifecycle, "cancelled");
  throwsCode(() => applyWorkflowEvent(cancelled, event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "late-claim")), "ILLEGAL_TRANSITION");

  const claimed = claimedState();
  const requested = applyWorkflowEvent(claimed, event("job.cancelled", { jobId: "job-1" }, "job-1-cancel-after-claim"));
  assert.equal(requested.batches["batch-1"]?.lifecycle, "claimed");
  assert.equal(requested.batches["batch-1"]?.cancelRequested, true);
  const settled = applyWorkflowEvent(applyWorkflowEvent(requested, event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "batch-1-execute-late")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "batch-1-receipt-late"));
  assert.equal(settled.batches["batch-1"]?.lifecycle, "settled");
  assert.equal(settled.batches["batch-1"]?.verification.state, "verified");
  assert.equal(settled.jobs["job-1"]?.status, "cancelled");
});

test("a verified late reconciliation can reclaim a released blocked job only after an unrelated lease ends", () => {
  const { observedFingerprint: _lostFingerprint, ...lostReceipt } = receipt({ receiptId: "lost", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown", verificationBasis: "host receipt lost" });
  const uncertain = applyWorkflowEvent(
    applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: lostReceipt }, "lost-receipt")),
    event("job.opened", { jobId: "job-2", engineId: "workflow-v1", title: "Unrelated job", goalSummary: "Unrelated work", successCriteria: [] }, "job-2-open"),
  );
  assert.equal(uncertain.jobs["job-1"]?.status, "blocked");
  assert.equal(uncertain.activeJobId, "job-2", "an uncertain settled job releases the authoring lane while retaining its evidence");

  const reconciled = applyWorkflowEvent(uncertain, event("batch.reconciled", { jobId: "job-1", batchId: "batch-1", priorReceiptId: "lost", receipt: receipt({ receiptId: "late-verified", observedFingerprint: "snap-late" }) }, "late-reconcile"));
  assert.equal(reconciled.batches["batch-1"]?.verification.state, "verified");
  assert.equal(reconciled.jobs["job-1"]?.status, "blocked", "late evidence is authoritative but does not reopen work under another owner");
  throwsCode(() => applyWorkflowEvent(reconciled, event("job.reopenedAfterReconciliation", { jobId: "job-1", batchId: "batch-1" }, "reopen-while-job-2-active")), "DISPATCH_LANE_BUSY");

  const released = applyWorkflowEvent(reconciled, event("job.blocked", { jobId: "job-2", reason: "workflow:test-stop" }, "job-2-blocked"));
  assert.equal(released.activeJobId, null);
  const reopened = applyWorkflowEvent(released, event("job.reopenedAfterReconciliation", { jobId: "job-1", batchId: "batch-1" }, "reopen-after-release"));
  assert.equal(reopened.jobs["job-1"]?.status, "active");
  assert.equal(reopened.activeJobId, "job-1");
  assert.equal(reopened.jobs["job-1"]?.blocker, null);
});

test("a blocked job can be cancelled after releasing its lease without touching an unrelated owner", () => {
  const uncertain = applyWorkflowEvent(
    applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "blocked-cancel-receipt", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown", verificationBasis: "host receipt lost" }) }, "blocked-cancel-receipt")),
    event("job.opened", { jobId: "job-2", engineId: "workflow-v1", title: "Unrelated job", goalSummary: "Unrelated work", successCriteria: [] }, "blocked-cancel-job-2"),
  );
  const cancelled = applyWorkflowEvent(uncertain, event("job.cancelled", { jobId: "job-1" }, "blocked-cancel-job-1"));
  assert.equal(cancelled.jobs["job-1"]?.status, "cancelled");
  assert.equal(cancelled.activeJobId, "job-2");
  assert.equal(cancelled.batches["batch-1"]?.execution.state, "unknown");
});

test("keeps rejected, failed, uncertain, and applied-unverified evidence distinct", () => {
  const { verificationBasis: _rejectedBasis, observedFingerprint: _rejectedFingerprint, ...rejectedEvidence } = receipt({ receiptId: "rejected", execution: "rejected_before_apply", mutation: "none", mayHaveMutated: false, verification: "not_requested" });
  const rejected = applyWorkflowEvent(applyWorkflowEvent(claimedState(), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute-rejected")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: rejectedEvidence }, "receipt-rejected"));
  assert.equal(rejected.batches["batch-1"]?.execution.state, "rejected_before_apply");
  assert.equal(rejected.batches["batch-1"]?.execution.mayHaveMutated, false);
  assert.equal(rejected.batches["batch-1"]?.recovery.state, "none");
});

test("keeps an uncertain receipt blocked and mutated-possible", () => {
  const { observedFingerprint: _uncertainFingerprint, ...uncertainEvidence } = receipt({ receiptId: "uncertain", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown", verificationBasis: "host-hop-timeout" });
  const uncertain = applyWorkflowEvent(applyWorkflowEvent(claimedState(), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute-uncertain")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: uncertainEvidence }, "receipt-uncertain"));
  assert.equal(uncertain.batches["batch-1"]?.execution.state, "unknown");
  assert.equal(uncertain.batches["batch-1"]?.execution.mayHaveMutated, true);
  assert.equal(uncertain.batches["batch-1"]?.recovery.state, "blocked");
});

test("keeps an applied-unverified receipt executed with recovery available", () => {
  const unverified = applyWorkflowEvent(applyWorkflowEvent(claimedState(), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute-unverified")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "unverified", verification: "applied_unverified", verificationBasis: "verification-unavailable" }) }, "receipt-unverified"));
  assert.equal(unverified.batches["batch-1"]?.execution.state, "executed");
  assert.equal(unverified.batches["batch-1"]?.verification.state, "applied_unverified");
  assert.equal(unverified.batches["batch-1"]?.recovery.state, "available");
});

test("an explicit repair transition reopens the latest settled failed batch for authoring", () => {
  const rejected = applyWorkflowEvent(
    executingState(),
    event("batch.receipt", {
      jobId: "job-1",
      batchId: "batch-1",
      receipt: receipt({ receiptId: "repairable-rejection", execution: "rejected_before_apply", mutation: "none", mayHaveMutated: false, verification: "not_requested", verificationBasis: "INVALID_VALUE: ensure_shape_stroke groupId" }),
    }, "repairable-rejection-receipt"),
  );
  assert.equal(rejected.jobs["job-1"]?.status, "blocked");
  assert.equal(rejected.activeJobId, null);
  const reopened = applyWorkflowEvent(rejected, event("job.reopenedForRepair", { jobId: "job-1", batchId: "batch-1" }, "repairable-rejection-reopen"));
  assert.equal(reopened.jobs["job-1"]?.status, "active");
  assert.equal(reopened.jobs["job-1"]?.blocker, null);
  assert.equal(reopened.stages["stage-1"]?.status, "active");
  assert.equal(reopened.activeJobId, "job-1");
});

test("a repair transition also reopens an executed batch with failed readback verification", () => {
  const readbackFailed = applyWorkflowEvent(
    executingState(),
    event("batch.receipt", {
      jobId: "job-1",
      batchId: "batch-1",
      receipt: receipt({ receiptId: "readback-mismatch", execution: "executed", mutation: "applied", mayHaveMutated: true, verification: "failed", verificationBasis: "shape-host-readback-mismatch", observedFingerprint: "after-partial" }),
    }, "readback-mismatch-receipt"),
  );
  assert.equal(readbackFailed.jobs["job-1"]?.status, "blocked");
  assert.equal(readbackFailed.activeJobId, null);
  const reopened = applyWorkflowEvent(readbackFailed, event("job.reopenedForRepair", { jobId: "job-1", batchId: "batch-1" }, "readback-mismatch-reopen"));
  assert.equal(reopened.jobs["job-1"]?.status, "active");
  assert.equal(reopened.jobs["job-1"]?.blocker, null);
  assert.equal(reopened.stages["stage-1"]?.status, "active");
  assert.equal(reopened.activeJobId, "job-1");
});

test("a repair transition refuses uncertain execution, partial apply, and unverified evidence", () => {
  const cases = [
    (() => { const { observedFingerprint: _observed, ...value } = receipt({ receiptId: "repair-unknown", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown", verificationBasis: "host receipt lost" }); return value; })(),
    (() => { const { observedFingerprint: _observed, ...value } = receipt({ receiptId: "repair-partial", execution: "failed_during_apply", mutation: "may_have_mutated", mayHaveMutated: true, verification: "failed", verificationBasis: "host stopped during apply" }); return value; })(),
    receipt({ receiptId: "repair-unverified", execution: "executed", mutation: "applied", mayHaveMutated: true, verification: "applied_unverified", verificationBasis: "readback unavailable" }),
  ];
  for (const [index, failedReceipt] of cases.entries()) {
    const failed = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: failedReceipt }, `repair-illegal-${index}-receipt`));
    throwsCode(() => applyWorkflowEvent(failed, event("job.reopenedForRepair", { jobId: "job-1", batchId: "batch-1" }, `repair-illegal-${index}-reopen`)), "ILLEGAL_TRANSITION");
  }
});

test("duplicate events and receipts are idempotent, conflicting identities are rejected", () => {
  const admitted = replayWorkflowEvents(baseEvents());
  const duplicate = applyWorkflowEvent(admitted, present(baseEvents().at(-1)));
  assert.deepEqual(duplicate, admitted);
  throwsCode(() => applyWorkflowEvent(admitted, Object.assign({}, present(baseEvents().at(-1)), { summary: "different" })), "DUPLICATE_EVENT_CONFLICT");

  const settled = applyWorkflowEvent(applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "receipt-original")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "receipt-replayed-with-new-event-id"));
  assert.equal(settled.batches["batch-1"]?.execution.receiptId, "receipt-1");
  throwsCode(() => applyWorkflowEvent(settled, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ verificationBasis: "different" }) }, "receipt-conflict")), "DUPLICATE_EVENT_CONFLICT");
});

test("stable IDs, undo-unit uniqueness, stage completion, and job completion are enforced", () => {
  const completed = replayWorkflowEvents([
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "receipt"),
    event("stage.completed", { jobId: "job-1", stageId: "stage-1" }, "stage-complete"),
    event("job.completed", { jobId: "job-1" }, "job-complete"),
  ]);
  assert.equal(completed.jobs["job-1"]?.status, "completed");
  assert.equal(completed.stages["stage-1"]?.status, "completed");
  const anotherBatch = [
    event("batch.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", summary: "Second", dependencies: [] }, "second-propose"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", ordinal: 0, payload: op("Second") }, "second-op"),
    ...authorityEvents("job-1", "batch-2", "batch-2", "snap-2"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", digest: digestFor("batch-2", { payloads: [op("Second")], snapshotFingerprint: "snap-2" }), snapshotFingerprint: "snap-2", undoUnitId: "undo-batch-1", undoUnitCount: 1, dimensions: dimensionsFor("batch-2") }, "second-admit"),
  ];
  throwsCode(() => replayWorkflowEvents([...baseEvents(), ...anotherBatch]), "INVALID_UNDO_UNIT");
});

test("state is serializable and replayable without transcript authority", () => {
  const events = [
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "receipt"),
  ];
  const state = replayWorkflowEvents(events);
  const serialized = serializeWorkflowState(state);
  throwsCode(() => applyWorkflowEvent(Object.assign({}, createWorkflowStateForTest(), parsedObject(serialized)), present(events[0])), "INVALID_EVENT");
  assert.deepEqual(replayWorkflowEvents(events), state);
  assert.equal(serialized.includes("prompt"), false);
  assert.equal(serialized.includes("reasoning"), false);

  const store = createInMemoryWorkflowStore();
  assert.equal(store.resumeSupported, false);
  for (const nextEvent of events) store.append(nextEvent);
  assert.deepEqual(store.getState(), state);
  assert.equal(store.listEvents("job-1").length, events.length);
  assert.deepEqual(store.loadJob("job-1"), state.jobs["job-1"]);
  assert.equal(parsedObject(store.serialize()).resumeSupported, false);
});

test("engine identity is immutable and cancellation retains ownership through an in-flight claim", () => {
  const claimed = claimedState();
  throwsCode(() => applyWorkflowEvent(createWorkflowStateForTest(), Object.assign({}, event("job.opened", { jobId: "wrong-engine", engineId: "workflow-v1", title: "Nope", goalSummary: "Nope", successCriteria: [] }, "wrong-engine-open"), { engineId: "workflow-v0" })), "ILLEGAL_TRANSITION");
  const cancelled = applyWorkflowEvent(claimed, event("job.cancelled", { jobId: "job-1" }, "cancel-in-flight"));
  assert.equal(cancelled.activeJobId, "job-1");
  throwsCode(() => applyWorkflowEvent(cancelled, event("job.opened", { jobId: "job-2", engineId: "workflow-v1", title: "Second", goalSummary: "Wait", successCriteria: [] }, "job-2-open")), "DISPATCH_LANE_BUSY");
  const settled = applyWorkflowEvent(applyWorkflowEvent(cancelled, event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "execute-after-cancel")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "receipt-after-cancel"));
  assert.equal(settled.activeJobId, null);
  assert.equal(applyWorkflowEvent(settled, event("job.opened", { jobId: "job-2", engineId: "workflow-v1", title: "Second", goalSummary: "Now allowed", successCriteria: [] }, "job-2-open-after-settle")).activeJobId, "job-2");
});

test("the apply and undo operations share one host lease", () => {
  const queuedSecond = replayWorkflowEvents([
    ...baseEvents(),
    event("batch.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", summary: "Second", dependencies: [] }, "batch-2-propose"),
    event("operation.proposed", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", ordinal: 0, payload: op("Second") }, "batch-2-operation"),
    ...authorityEvents("job-1", "batch-2", "batch-2"),
    event("batch.admitted", { jobId: "job-1", stageId: "stage-1", batchId: "batch-2", digest: digestFor("batch-2", { payloads: [op("Second")] }), snapshotFingerprint: "snap-1", undoUnitId: "undo-batch-2", undoUnitCount: 1, dimensions: dimensionsFor("batch-2") }, "batch-2-admit"),
    event("batch.queued", { jobId: "job-1", batchId: "batch-2" }, "batch-2-queue"),
  ]);
  const firstSettled = applyWorkflowEvent(applyWorkflowEvent(applyWorkflowEvent(queuedSecond, event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-claim")), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "batch-1-execute")), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "batch-1-receipt"));
  const undoClaimed = applyWorkflowEvent(applyWorkflowEvent(firstSettled, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "batch-1-undo")), event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-undo-claim"));
  assert.deepEqual(undoClaimed.activeDispatchLease, { kind: "undo", jobId: "job-1", batchId: "batch-1" });
  throwsCode(() => applyWorkflowEvent(undoClaimed, event("batch.claimed", { jobId: "job-1", batchId: "batch-2" }, "batch-2-claim")), "DISPATCH_LANE_BUSY");
  throwsCode(() => applyWorkflowEvent(undoClaimed, event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "undo-1", status: "executed", verification: "restored", receivedAt: at, restoredFingerprint: "snap-1" } }, "undo-without-execute")), "ILLEGAL_TRANSITION");
  const undoExecuting = applyWorkflowEvent(undoClaimed, event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "undo-execute"));
  const undoSettled = applyWorkflowEvent(undoExecuting, event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "undo-1", status: "executed", verification: "restored", receivedAt: at, restoredFingerprint: "snap-1" } }, "undo-receipt"));
  assert.equal(undoSettled.activeDispatchLease, null);
});
