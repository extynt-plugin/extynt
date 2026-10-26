// Test that the model-facing continuation is compact: no capability index, and only place, kind and layer for a clean outcome.

import test from "node:test";
import assert from "node:assert/strict";
import type { WorkflowContinuationInput, WorkflowContinuationOperationEvidence } from "@extynt/workflow";
import { modelContinuation } from "../src/workflow-contract.js";
import { present } from "./agent-test-support.js";
import { workflowCapabilityDisclosure } from "../src/workflow-capabilities.js";

const outcome = (ordinal: number, extra: Partial<WorkflowContinuationOperationEvidence> = {}): WorkflowContinuationOperationEvidence => ({ operationId: `wf-batch-a:op:${ordinal}`, ordinal, type: "create_layer", outcome: "confirmed", mutation: "applied", verification: "verified", mayHaveMutated: true, basis: "layer-exists-name-type", readback: { targetLayerId: String(10 + ordinal), expected: `Layer ${ordinal}` }, ...extra });
const continuation: WorkflowContinuationInput = {
  schemaVersion: "0.1", jobId: "job-a", goalSummary: "Build it.", goalDigest: "d", stageId: "stage-a", stageStatus: "active", cycle: 1, batchCount: 1, snapshot: { fingerprint: "f", revision: "1" }, activeBatch: null,
  settledBatches: [{ batchId: "wf-batch-a", stageId: "stage-a", lifecycle: "settled", execution: "executed", mutation: "applied", verification: "verified", verificationCoverage: { applied: true, readback: true, visual: false, temporal: false },
    receipt: { receiptId: "receipt:a", execution: "executed", mutation: "applied", verification: "verified", mayHaveMutated: true, receivedAt: "2026-10-13T00:00:00.000Z", outcomes: [outcome(0), outcome(1, { outcome: "readback_mismatch", verification: "failed", readback: { targetLayerId: "11", expected: "A", observed: "B" } })] } }],
  createdIdBindings: [], unresolvedCriteria: [], blockers: [], limits: { maxStages: 1, maxBatches: 1, maxOperations: 1 }, capabilities: workflowCapabilityDisclosure(),
};

test("the model's continuation leaves out the capability index and keeps only place, kind and layer of a clean outcome", () => {
  const compact = modelContinuation(continuation);
  assert.equal("capabilities" in compact, false);
  const batch = present(compact.settledBatches[0], "settled batch");
  const receipt = present(batch.receipt ?? undefined, "receipt");
  assert.equal(batch.batchId, "wf-batch-a");
  assert.equal(receipt.receiptId, "receipt:a", "completion cites the receipt by id");
  assert.deepEqual(receipt.outcomes[0], { ordinal: 0, type: "create_layer", layerId: "10" });
  const mismatch = present(receipt.outcomes[1], "mismatched outcome");
  assert.equal("readback" in mismatch ? mismatch.readback?.observed : undefined, "B", "a mismatch keeps every field for the repair");
  assert.ok(JSON.stringify(compact).length * 3 < JSON.stringify(continuation).length);
});
