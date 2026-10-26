// Tests that the presentation keeps each batch status distinct.

import assert from "node:assert/strict";
import test from "node:test";
import { presentWorkflowState, replayWorkflowEvents } from "../src/index.js";
import { baseEvents, event, executingState, present, receipt } from "./fixtures.js";

function projected(events: ReturnType<typeof baseEvents>) {
  return presentWorkflowState(replayWorkflowEvents(events), "job-1");
}

function projectedBatch(events: ReturnType<typeof baseEvents>) {
  const batch = projected(events).batches[0];
  assert.ok(batch);
  return batch;
}

test("workflow presentation keeps planned, admitted, executing, applied, verified, uncertain, blocked, and undone distinct", () => {
  assert.equal(projectedBatch(baseEvents().slice(0, 3)).status, "planned");
  assert.equal(projectedBatch(baseEvents()).status, "admitted");
  assert.equal(present(presentWorkflowState(executingState(), "job-1").batches[0]).status, "executing");

  const verified = [...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "presentation-claim"), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "presentation-execute"), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "presentation-verified")];
  assert.equal(projectedBatch(verified).status, "verified");
  assert.deepEqual(projectedBatch(verified).verificationCoverage, { applied: true, readback: true, visual: false, temporal: false });
  const applied = [...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "applied-claim"), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "applied-execute"), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt({ receiptId: "applied", verification: "applied_unverified", verificationBasis: "readback unavailable" }) }, "applied-receipt")];
  assert.equal(projectedBatch(applied).status, "applied");
  assert.deepEqual(projectedBatch(applied).verificationCoverage, { applied: true, readback: false, visual: false, temporal: false });
  const { observedFingerprint: _uncertainFingerprint, ...uncertainReceipt } = receipt({ receiptId: "uncertain", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown" });
  const uncertain = [...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "uncertain-claim"), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "uncertain-execute"), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: uncertainReceipt }, "uncertain-receipt")];
  assert.equal(projectedBatch(uncertain).status, "uncertain");
  const { verificationBasis: _rejectedBasis, observedFingerprint: _rejectedFingerprint, ...rejectedReceipt } = receipt({ receiptId: "rejected", execution: "rejected_before_apply", mutation: "none", mayHaveMutated: false, verification: "not_requested" });
  const blocked = [...baseEvents(), event("batch.rejected", { jobId: "job-1", batchId: "batch-1", receipt: rejectedReceipt }, "blocked-receipt")];
  assert.equal(projectedBatch(blocked).status, "blocked");
  const undone = [...verified, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "undo-request"), event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "undo-claim"), event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "undo-execute"), event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "undo-receipt", status: "executed" as const, receivedAt: "2026-09-20T12:00:00.000Z", restoredFingerprint: "snap-1", verification: "restored" as const } }, "undo-receipt")];
  assert.equal(projectedBatch(undone).status, "undone");
});

test("presentation exposes guarded controls and never advertises automatic retry or resume", () => {
  const verified = [...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "controls-claim"), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "controls-execute"), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "controls-receipt")];
  const view = projected(verified);
  assert.equal(view.job.activeStageId, "stage-1");
  assert.equal(view.job.verifiedBatches, 1);
  assert.equal(view.job.readbackVerifiedBatches, 1);
  assert.equal(view.job.visuallyVerifiedBatches, 0);
  assert.equal(view.job.temporallyVerifiedBatches, 0);
  assert.equal(view.job.undoableBatches, 1);
  assert.equal(view.batches[0]?.canRequestUndo, true);
  assert.equal(view.batches[0]?.receiptId, "receipt-1");
  assert.equal(view.batches[0]?.undoLineage, null);
  assert.equal(view.batches[0]?.canReconcile, false);
  assert.equal(view.batches[0]?.automaticRetry, false);
  assert.equal(view.automaticDispatchResumeSupported, false);
});

test("uncertain presentation offers reconciliation but not undo or retry", () => {
  const { observedFingerprint: _lostFingerprint, ...lostReceipt } = receipt({ receiptId: "lost", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown" });
  const events = [...baseEvents(), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "reconcile-claim"), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "reconcile-execute"), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: lostReceipt }, "reconcile-receipt")];
  const view = projected(events);
  assert.equal(view.batches[0]?.canReconcile, true);
  assert.equal(view.batches[0]?.canRequestUndo, false);
  assert.equal(view.job.uncertainBatches, 1);
});
