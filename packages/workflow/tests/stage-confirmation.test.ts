// Tests when a stage counts as confirmed by its batches.

import test from "node:test";
import assert from "node:assert/strict";
import { stageBatchesConfirmed } from "../src/index.js";
import type { WorkflowBatch, WorkflowOperation, WorkflowReceipt, WorkflowState } from "../src/index.js";
import { createWorkflowState, hasPendingRecovery } from "../src/state.js";

function batch(verification: "verified" | "failed" | "applied_unverified", outcome: "confirmed" | "readback_mismatch" = "confirmed", operationId = "op:0"): WorkflowBatch {
  const receipt: WorkflowReceipt = {
    receiptId: "receipt:a", receivedAt: "2026-10-13T00:00:00.000Z", execution: "executed", mutation: "applied", mayHaveMutated: true, verification,
    outcomes: [{ operationId, ordinal: 0, type: "set_layer_attribute", outcome, mutation: "applied", verification, mayHaveMutated: true }],
  };
  return {
    batchId: "batch-a", jobId: "job-a", stageId: "stage-a", lifecycle: "settled", summary: "A batch.", dependencies: [], operationIds: [operationId], admission: null, approval: null,
    execution: { state: "executed", mutation: "applied", mayHaveMutated: true, receiptId: receipt.receiptId, receivedAt: receipt.receivedAt, receipt, receiptHistory: [receipt] },
    verification: { state: verification, basis: null, observedFingerprint: null },
    recovery: { state: "none", dispatch: "idle", mayHaveMutated: false, undoReceiptId: null, lineage: null, receipt: null, verification: null },
    cancelRequested: false, createdAt: receipt.receivedAt, updatedAt: receipt.receivedAt,
  };
}

function attribute(operationId: string, layerId: string, role: "three-d" | "shy" = "three-d"): WorkflowOperation {
  return { operationId, batchId: "batch-a", ordinal: 0, type: "set_layer_attribute", status: "verified", outcome: null, payload: { type: "set_layer_attribute", target: { compositionId: "comp-1", layerId, snapshotFingerprint: "s", selectionFingerprint: "f" }, role, value: true } };
}

const operations = (...rows: WorkflowOperation[]) => Object.fromEntries(rows.map((row) => [row.operationId, row]));
const mismatchedOn = (layerId: string) => ({ batch: batch("failed", "readback_mismatch", "op:bad"), op: attribute("op:bad", layerId) });
const verifiedOn = (layerId: string, role: "three-d" | "shy" = "three-d") => ({ batch: batch("verified", "confirmed", "op:fix"), op: attribute("op:fix", layerId, role) });

test("a readback mismatch stops holding the stage open once a later verified batch corrects the same target", () => {
  const bad = mismatchedOn("16"), same = verifiedOn("16"), other = verifiedOn("20"), ops = operations(bad.op, same.op);
  assert.equal(stageBatchesConfirmed([batch("verified"), bad.batch], () => false, ops), false, "an unrepaired mismatch still blocks the stage");
  assert.equal(stageBatchesConfirmed([batch("verified"), bad.batch, same.batch], () => false, ops), true, "the verified correction of the same target carries the stage");
  assert.equal(stageBatchesConfirmed([batch("verified"), bad.batch, other.batch], () => false, operations(bad.op, other.op)), false, "a verified batch on another layer is not a repair");
  assert.equal(stageBatchesConfirmed([batch("verified"), bad.batch, verifiedOn("16", "shy").batch], () => false, operations(bad.op, verifiedOn("16", "shy").op)), false, "another attribute of the same layer is not a repair");
  assert.equal(stageBatchesConfirmed([batch("verified"), batch("failed"), same.batch], () => false, ops), false, "a failure that is not a readback mismatch is not repairable this way");
  assert.equal(stageBatchesConfirmed([batch("verified"), bad.batch, batch("applied_unverified")], () => false, ops), false, "an unproven follow-up is not a repair");
});

test("a repaired readback mismatch keeps its blocked undo but no longer counts as pending recovery", () => {
  const bad = mismatchedOn("16"), same = verifiedOn("16"), other = verifiedOn("20");
  const blocked: WorkflowBatch = { ...bad.batch, recovery: { ...bad.batch.recovery, state: "blocked" } };
  const state = (rows: WorkflowOperation[], batches: WorkflowBatch[]): WorkflowState => ({ ...createWorkflowState(), operations: operations(...rows), batches: Object.fromEntries(batches.map((b, i) => [`b${i}`, b])) });
  assert.equal(hasPendingRecovery(state([bad.op], [blocked]), ["b0"]), true, "an unrepaired mismatch is pending");
  assert.equal(hasPendingRecovery(state([bad.op, same.op], [blocked, same.batch]), ["b0", "b1"]), false, "a verified correction of the same target repairs it");
  assert.equal(hasPendingRecovery(state([bad.op, other.op], [blocked, other.batch]), ["b0", "b1"]), true, "an unrelated verified batch does not");
});
