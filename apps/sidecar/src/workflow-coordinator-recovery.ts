// Rebuilds the in-memory plan records and stored plans a restarted sidecar resumes from the durable workflow state.

import type { ActionPlan } from "@extynt/action-plan";
import type { PlanStatus, StoredPlan, StoredReceipt } from "@extynt/mcp-server";
import type { WorkflowBatch, WorkflowState } from "@extynt/workflow";
import type { WorkflowPlanRecord } from "./workflow-coordinator-types.js";

function recoveredPlan(batch: WorkflowBatch): ActionPlan | null {
  const admission = batch.admission;
  if (!admission?.sourcePlanId) return null;
  return {
    schemaVersion: "0.2",
    planId: admission.sourcePlanId,
    snapshotFingerprint: admission.snapshotFingerprint,
    summary: batch.summary,
    operations: admission.operations.map((operation) => operation.payload),
    requiresApproval: true,
  };
}

const RECOVERY_STATUSES: Partial<Record<WorkflowBatch["recovery"]["state"], PlanStatus>> = {
  undone: "undone",
  undo_unverified: "undo_unverified",
  unknown: "undo_unverified",
  requested: "undo_requested",
};
const VERIFICATION_STATUSES: Partial<Record<WorkflowBatch["verification"]["state"], PlanStatus>> = {
  verified: "verified",
  applied_unverified: "applied_unverified",
};
const LIFECYCLE_STATUSES: Partial<Record<WorkflowBatch["lifecycle"], PlanStatus>> = {
  settled: "failed",
  executing: "applying",
  claimed: "applying",
};

function recoveredStatus(batch: WorkflowBatch): PlanStatus {
  if (batch.lifecycle === "cancelled") return "cancelled";
  const recovery = RECOVERY_STATUSES[batch.recovery.state];
  if (recovery) return recovery;
  const verification = VERIFICATION_STATUSES[batch.verification.state];
  if (verification) return verification;
  const lifecycle = LIFECYCLE_STATUSES[batch.lifecycle];
  if (lifecycle) return lifecycle;
  if (batch.approval) return "approved";
  if (batch.lifecycle === "queued") return "presented";
  return "prepared";
}

const EXECUTION_STATUSES: Readonly<Record<NonNullable<WorkflowBatch["execution"]["receipt"]>["execution"], string>> = {
  executed: "executed",
  unknown: "unknown",
  rejected_before_apply: "rejected",
  failed_during_apply: "rejected",
};

function recoveredReceipt(batch: WorkflowBatch): StoredReceipt | undefined {
  const receipt = batch.execution.receipt;
  if (!receipt) return undefined;
  return {
    receiptId: receipt.receiptId,
    planId: batch.admission?.sourcePlanId ?? "recovered-plan",
    receivedAt: receipt.receivedAt,
    status: EXECUTION_STATUSES[receipt.execution],
    postcondition: receipt.verification === "verified" ? "passed" : receipt.verification,
    mayHaveMutated: receipt.mayHaveMutated,
    mutationState: receipt.mutation,
    ...(receipt.observedFingerprint ? { afterFingerprint: receipt.observedFingerprint } : {}),
  };
}

interface RecoveredWorkflowPlan {
  readonly coordinator: WorkflowPlanRecord;
  readonly stored: StoredPlan;
}

/** Rebuilds a plan record and stored plan for every batch whose admission names its source plan. */
export function recoverWorkflowPlans(state: WorkflowState): readonly RecoveredWorkflowPlan[] {
  const recovered: RecoveredWorkflowPlan[] = [];
  for (const batch of Object.values(state.batches)) {
    const plan = recoveredPlan(batch);
    if (!plan) continue;
    const receipt = recoveredReceipt(batch);
    const coordinator: WorkflowPlanRecord = {
      planId: plan.planId,
      jobId: batch.jobId,
      stageId: batch.stageId,
      batchId: batch.batchId,
      plan,
      receiptSequence: batch.execution.receiptHistory.length,
      undoSequence: batch.recovery.receipt ? 1 : 0,
    };
    const stored: StoredPlan = {
      plan,
      jobId: batch.jobId,
      status: recoveredStatus(batch),
      ...(receipt ? { receipt } : {}),
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
    recovered.push({ coordinator, stored });
  }
  return recovered;
}
