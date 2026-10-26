// Restart recovery: a descriptive classification of every batch after a process restart; it never authorizes a host dispatch.

import type { WorkflowBatchRecoveryClassification, WorkflowRecoveryReport } from "./continuation-types.js";
import { UNDISPATCHED_LIFECYCLES } from "./state.js";
import type { WorkflowBatch, WorkflowState } from "./state-types.js";

type Classification = WorkflowBatchRecoveryClassification;

const UNCERTAIN_RECOVERY: ReadonlySet<string> = new Set(["unknown", "undo_unverified", "blocked"]);

function classification(batch: WorkflowBatch, disposition: Classification["disposition"], reason: string, action: Classification["action"]): Classification {
  return { batchId: batch.batchId, disposition, reason, action, automaticDispatch: false };
}

function blocked(batch: WorkflowBatch, reason: string, action: Classification["action"] = "explicit_reconciliation"): Classification {
  return classification(batch, "blocked_uncertain", reason, action);
}

function classifyRecoveryDispatch(batch: WorkflowBatch): Classification | undefined {
  if (batch.recovery.dispatch === "claimed" || batch.recovery.dispatch === "executing") return blocked(batch, `recovery dispatch ${batch.recovery.dispatch} may have reached the host`, "user_review");
  if (batch.recovery.state === "requested") return classification(batch, "safe_to_resume", "undo was requested but not claimed", "fresh_explicit_authorization");
  if (UNCERTAIN_RECOVERY.has(batch.recovery.state)) return blocked(batch, `recovery evidence is ${batch.recovery.state}`);
  return undefined;
}

function classifySettled(batch: WorkflowBatch): Classification {
  if (batch.verification.state === "verified" && batch.execution.state === "executed") return classification(batch, "settled", "verified receipt is authoritative", "none");
  return blocked(batch, `settled evidence is ${batch.execution.state}/${batch.verification.state}`);
}

function classifyApply(batch: WorkflowBatch): Classification {
  if (batch.lifecycle === "cancelled") return classification(batch, "settled", "batch was cancelled before dispatch", "none");
  if (batch.lifecycle === "claimed" || batch.lifecycle === "executing" || batch.execution.state === "applying") return blocked(batch, `apply dispatch ${batch.lifecycle} may have reached the host`);
  if (UNDISPATCHED_LIFECYCLES.has(batch.lifecycle)) return classification(batch, "safe_to_resume", "batch has no durable host claim", "fresh_explicit_authorization");
  return batch.lifecycle === "settled" ? classifySettled(batch) : blocked(batch, `unsupported lifecycle ${batch.lifecycle}`);
}

/** Classifies one batch by its durable dispatch and settlement evidence. */
export function classifyWorkflowBatchRecovery(batch: WorkflowBatch): WorkflowBatchRecoveryClassification {
  return classifyRecoveryDispatch(batch) ?? classifyApply(batch);
}

/** Classifies every batch of a state in batch-id order. */
export function classifyWorkflowRecovery(state: WorkflowState): WorkflowRecoveryReport {
  const batches = Object.values(state.batches)
    .sort((left, right) => left.batchId.localeCompare(right.batchId))
    .map(classifyWorkflowBatchRecovery);
  return { resumeSupported: state.resumeSupported, automaticDispatchResumeSupported: false, batches };
}
