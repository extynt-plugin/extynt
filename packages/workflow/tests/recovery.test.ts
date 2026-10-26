// Tests restart recovery classification of batches and jobs.

import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkflowEvent, classifyWorkflowRecovery, replayWorkflowEvents } from "../src/index.js";
import { at, event, baseEvents, executingState, receipt, throwsCode } from "./fixtures.js";

test("completed jobs can reacquire the engine only for guarded undo", () => {
  const settled = applyWorkflowEvent(applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "complete-receipt")), event("stage.completed", { jobId: "job-1", stageId: "stage-1" }, "complete-stage"));
  const completed = applyWorkflowEvent(settled, event("job.completed", { jobId: "job-1" }, "complete-job"));
  assert.equal(completed.activeJobId, null);
  const reopened = applyWorkflowEvent(completed, event("job.undoOpened", { jobId: "job-1" }, "undo-opened"));
  const undone = replayWorkflowEvents([
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "reclaim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "reexecute"),
  ]);
  void undone;
  assert.equal(reopened.activeJobId, "job-1");
  const requested = applyWorkflowEvent(reopened, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "post-completion-undo-request"));
  const claimed = applyWorkflowEvent(requested, event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "post-completion-undo-claim"));
  const executingUndo = applyWorkflowEvent(claimed, event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "post-completion-undo-execute"));
  const final = applyWorkflowEvent(executingUndo, event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "post-completion-undo-receipt", status: "executed", verification: "undo_unverified", receivedAt: at } }, "post-completion-undo-receipt-event"));
  assert.equal(final.batches["batch-1"]?.recovery.state, "undo_unverified");
});

function completedThenNewTurn() {
  const settled = applyWorkflowEvent(applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "turn-receipt")), event("stage.completed", { jobId: "job-1", stageId: "stage-1" }, "turn-stage"));
  const completed = applyWorkflowEvent(settled, event("job.completed", { jobId: "job-1" }, "turn-complete"));
  return applyWorkflowEvent(completed, event("job.opened", { jobId: "job-2", engineId: "workflow-v1", title: "Undo turn", goalSummary: "undo the last change", successCriteria: [] }, "turn-two-open"));
}

test("a new turn's job that holds no host work lets the last job's batch be undone without giving up the engine", () => {
  const turn = completedThenNewTurn();
  assert.equal(turn.activeJobId, "job-2");
  const requested = applyWorkflowEvent(turn, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "borrowed-undo-request"));
  assert.equal(requested.activeJobId, "job-2", "the turn keeps the engine");
  const claimed = applyWorkflowEvent(requested, event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "borrowed-undo-claim"));
  assert.deepEqual(claimed.activeDispatchLease, { kind: "undo", jobId: "job-1", batchId: "batch-1" });
  const executing = applyWorkflowEvent(claimed, event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "borrowed-undo-execute"));
  const restored = applyWorkflowEvent(executing, event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "borrowed-undo-receipt", status: "executed", verification: "restored", restoredFingerprint: "snap-1", receivedAt: at } }, "borrowed-undo-settle"));
  assert.equal(restored.batches["batch-1"]?.recovery.state, "undone");
  assert.equal(restored.activeDispatchLease, null);
  assert.equal(restored.activeJobId, "job-2");
});

test("the borrowed undo waits while the owning turn holds a host lease", () => {
  const busy = replayWorkflowEvents([
    ...baseEvents(),
    event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "busy-claim"),
    event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "busy-execute"),
    event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "busy-receipt"),
    event("stage.completed", { jobId: "job-1", stageId: "stage-1" }, "busy-stage"),
    event("job.completed", { jobId: "job-1" }, "busy-complete"),
    ...baseEvents("job-2", "stage-2", "batch-2"),
    event("batch.claimed", { jobId: "job-2", batchId: "batch-2" }, "busy-claim-2"),
  ]);
  assert.equal(busy.activeDispatchLease?.jobId, "job-2");
  throwsCode(() => applyWorkflowEvent(busy, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "busy-undo-request")), "ILLEGAL_TRANSITION");
});

test("stopping authoring leaves a settled batch available for guarded undo", () => {
  const settled = applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "cancelled-apply-receipt"));
  const cancelled = applyWorkflowEvent(settled, event("job.cancelled", { jobId: "job-1" }, "cancelled-authoring"));
  assert.equal(cancelled.activeJobId, null);
  const requested = applyWorkflowEvent(cancelled, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "cancelled-undo-request"));
  assert.equal(requested.activeJobId, "job-1");
  const claimed = applyWorkflowEvent(requested, event("batch.undoClaimed", { jobId: "job-1", batchId: "batch-1" }, "cancelled-undo-claim"));
  const executing = applyWorkflowEvent(claimed, event("batch.undoExecuting", { jobId: "job-1", batchId: "batch-1" }, "cancelled-undo-execute"));
  const restored = applyWorkflowEvent(executing, event("batch.undoReceipt", { jobId: "job-1", batchId: "batch-1", receipt: { receiptId: "cancelled-undo-receipt", status: "executed", verification: "restored", restoredFingerprint: "snap-1", receivedAt: at } }, "cancelled-undo-settle"));
  assert.equal(restored.batches["batch-1"]?.recovery.state, "undone");
});

test("restart classifications describe required explicit action and never authorize dispatch", () => {
  const safe = classifyWorkflowRecovery(replayWorkflowEvents(baseEvents()));
  assert.equal(safe.automaticDispatchResumeSupported, false);
  assert.deepEqual(safe.batches[0], {
    batchId: "batch-1",
    disposition: "safe_to_resume",
    reason: "batch has no durable host claim",
    action: "fresh_explicit_authorization",
    automaticDispatch: false,
  });
  const { observedFingerprint: _lostFingerprint, ...lostReceipt } = receipt({ receiptId: "lost", execution: "unknown", mutation: "unknown", mayHaveMutated: true, verification: "unknown" });
  const uncertain = classifyWorkflowRecovery(applyWorkflowEvent(executingState(), event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: lostReceipt }, "recovery-uncertain")));
  assert.equal(uncertain.batches[0]?.action, "explicit_reconciliation");
  assert.equal(uncertain.batches[0]?.automaticDispatch, false);
});

test("A4 rejects malformed receipt rows, cross-stage criterion evidence, and pending undo completion", () => {
  const executing = executingState();
  throwsCode(() => applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: Object.assign({}, receipt({ receiptId: "missing-rows", verificationBasis: "readback" }), { outcomes: undefined }) }, "missing-rows-event")), "INVALID_EVENT");
  const settled = applyWorkflowEvent(executing, event("batch.receipt", { jobId: "job-1", batchId: "batch-1", receipt: receipt() }, "pending-recovery-receipt"));
  const undoRequested = applyWorkflowEvent(settled, event("batch.undoRequested", { jobId: "job-1", batchId: "batch-1", expectedFingerprint: "snap-2" }, "pending-recovery-request"));
  throwsCode(() => applyWorkflowEvent(undoRequested, event("stage.completed", { jobId: "job-1", stageId: "stage-1" }, "pending-recovery-stage-complete")), "ILLEGAL_TRANSITION");

  const criteriaState = replayWorkflowEvents([
    event("job.opened", { jobId: "criterion-job", engineId: "workflow-v1", title: "Criteria", goalSummary: "Cross-stage evidence", successCriteria: [] }, "criterion-job-open"),
    event("stage.opened", { jobId: "criterion-job", stageId: "stage-a", title: "A", purpose: "A", successCriteria: [] }, "stage-a-open"),
    event("stage.opened", { jobId: "criterion-job", stageId: "stage-b", title: "B", purpose: "B", successCriteria: [{ criterionId: "criterion-b", description: "B evidence" }] }, "stage-b-open"),
    event("observation.recorded", { jobId: "criterion-job", evidence: { evidenceId: "observation-a", jobId: "criterion-job", stageId: "stage-a", kind: "structural", basis: "stage-a evidence", recordedAt: at } }, "observation-a-recorded"),
  ]);
  throwsCode(() => applyWorkflowEvent(criteriaState, event("criterion.satisfied", { jobId: "criterion-job", scope: "stage", stageId: "stage-b", criterionId: "criterion-b", reference: { kind: "observation", evidenceId: "observation-a" } }, "cross-stage-missing")), "WRONG_OWNER");
});
