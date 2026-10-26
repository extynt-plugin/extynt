// Stage confirmation: whether a stage's settled batches stand as its evidence.

import type { OperationLookup } from "./readback-repair.js";
import { readbackRepaired } from "./readback-repair.js";
import type { WorkflowBatch } from "./state-types.js";

type MaybeBatch = WorkflowBatch | undefined;

function settled(batch: MaybeBatch): batch is WorkflowBatch {
  return batch?.lifecycle === "settled";
}

function safeRejected(batch: WorkflowBatch): boolean {
  return batch.execution.state === "rejected_before_apply" && batch.execution.mutation === "none" && !batch.execution.mayHaveMutated;
}

function visuallyConfirmed(batch: WorkflowBatch, visuallyObserved: (batch: WorkflowBatch) => boolean): boolean {
  return batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "applied_unverified" && visuallyObserved(batch);
}

/** Whether a stage's settled batches stand as its evidence: a readback-mismatch batch is the one failure a repair cycle can answer, so once a later batch in the same stage settles verified that repair is the stage's evidence, while anything uncertain, unsettled or failed without a repair still holds the stage open. */
export function stageBatchesConfirmed(batches: readonly MaybeBatch[], visuallyObserved: (batch: WorkflowBatch) => boolean, operations: OperationLookup): boolean {
  const hasEvidence = batches.some((batch) => settled(batch) && (batch.verification.state === "verified" || visuallyObserved(batch)));
  return hasEvidence && batches.every((batch, index) => settled(batch) && (
    batch.verification.state === "verified" || visuallyConfirmed(batch, visuallyObserved) || safeRejected(batch) || readbackRepaired(batches, index, operations)
  ));
}
