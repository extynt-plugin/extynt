// Shared fixtures for the workflow coordinator tests: a renaming plan, its authority, a ready-to-receipt coordinator and a verified receipt.

import type { StoredReceipt } from "@extynt/mcp-server";
import assert from "node:assert/strict";
import type { ActionPlan } from "@extynt/action-plan";
import { type JsonValue } from "@extynt/decode";
import type { WorkflowBatch } from "@extynt/workflow";
import type { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import type { AdmissionResult } from "../src/workflow-coordinator-admission.js";
import { present } from "./agent-test-support.js";

/** The fixed clock the coordinator fixtures run on. */
export const at = new Date("2026-09-20T12:00:00.000Z");
/** The sealed authority record that admits the fixture plans. */
export const authority = {
  hostProfileId: "profile-fixture",
  hostBasis: "complete fixture host profile",
  hostSupported: true,
  verificationBasis: "sealed action-plan verification report",
  exactVerification: true,
  targetResolved: true,
  policyApprovalId: "approval-ref:fixture",
} as const;

/** A one-operation plan that renames the fixture layer. */
export function plan(planId: string, name = "Renamed", snapshotFingerprint = "snapshot-before"): ActionPlan {
  return {
    schemaVersion: "0.2",
    planId,
    snapshotFingerprint,
    selectionFingerprint: "selection-1",
    freshness: { revision: "1", capturedAt: at.toISOString() },
    summary: "Rename fixture layer",
    requiresApproval: true,
    operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint, selectionFingerprint: "selection-1" }, name }],
  };
}

/** Admits, queues, approves, claims and starts executing a plan so a receipt can land. */
export function ready(coordinator: WorkflowCoordinator, value = plan("plan-1"), jobId = "job-1"): void {
  assert.equal(coordinator.admitPlan(value, { jobId, undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
  coordinator.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.claim(value.planId);
  coordinator.executing(value.planId);
}

/** An executed receipt with exact read-back verification for one operation. */
export function verifiedReceipt(receiptId: string, created?: Readonly<Record<string, string>>, operation = "set_layer_name", stepFields: Readonly<Record<string, JsonValue>> = {}): StoredReceipt {
  return {
    receiptId,
    planId: "ignored-by-coordinator",
    status: "executed",
    postcondition: "passed",
    mayHaveMutated: true,
    mutationState: "applied",
    afterFingerprint: `snapshot-after-${receiptId}`,
    ...(created ? { created } : {}),
    verification: {
      state: "exact",
      basis: "headless fixture readback",
      steps: [{ operation, verificationState: "exact", observed: true, basis: "headless fixture readback", ...stepFields }],
    },
  };
}

/** The batch a plan was admitted into. */
export function batchOf(coordinator: WorkflowCoordinator, planId: string): WorkflowBatch {
  return present(coordinator.batchForPlan(planId) ?? undefined, "batch");
}

/** The id of the batch a plan was admitted into. */
export function batchIdOf(coordinator: WorkflowCoordinator, planId: string): string {
  return present(coordinator.batchIdForPlan(planId) ?? undefined, "batch id");
}

/** The id of the job a plan was admitted into. */
export function jobIdOf(coordinator: WorkflowCoordinator, planId: string): string {
  return present(coordinator.jobIdForPlan(planId) ?? undefined, "job id");
}

/** The refusal code of an admission that must have been refused. */
export function refusalCode(result: AdmissionResult): string {
  if (result.ok) throw new Error("expected the admission to be refused");
  return result.code;
}
