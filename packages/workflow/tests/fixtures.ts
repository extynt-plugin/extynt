// Shared builders for the workflow tests: events, receipts, admission dimensions and states.

import assert from "node:assert/strict";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { applyWorkflowEvent, computeWorkflowBatchDigest, replayWorkflowEvents, WorkflowTransitionError } from "../src/index.js";
import type { WorkflowEvent, WorkflowOperationOutcome, WorkflowOperationOutcomeKind, WorkflowReceipt, WorkflowState } from "../src/index.js";
import { decodeOrThrow, jsonObject } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";
import type { EventOf, EventType } from "../src/transition-table.js";

export const at = "2026-09-20T12:00:00.000Z";

export const op = (name = "Hero"): ActionPlanV2Operation => ({
  type: "set_layer_name",
  target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" },
  name,
});

export function dimensionsFor(batchId: string) {
  return {
    schemaValue: { state: "valid" as const, evidenceId: `${batchId}-ev-0`, basis: "action-plan validator" },
    targetDependency: { state: "resolved" as const, evidenceId: `${batchId}-ev-1`, basis: "target resolver" },
    hostCapability: { state: "supported" as const, evidenceId: `${batchId}-ev-2`, basis: "host profile" },
    verificationCapability: { state: "exact" as const, evidenceId: `${batchId}-ev-3`, basis: "verifier contract" },
    mutationBehavior: { state: "ensuring" as const, evidenceId: `${batchId}-ev-4`, basis: "mutation classifier" },
    recovery: { state: "fully_undoable" as const, evidenceId: `${batchId}-ev-5`, basis: "recovery audit" },
    policy: { decision: "automatic" as const, evidenceId: `${batchId}-ev-6`, basis: "policy decision" },
  };
}

function carriesType<T extends EventType>(candidate: { readonly type: EventType }, type: T): candidate is EventOf<T> {
  return candidate.type === type;
}

export function event<T extends EventType>(type: T, fields: Omit<EventOf<T>, "type" | "eventId" | "at">, eventId: string): EventOf<T> {
  const built = { type, eventId, at, ...fields };
  assert.ok(carriesType(built, type), "the built event carries its declared type");
  return built;
}

export interface DigestOptions {
  payloads?: ActionPlanV2Operation[];
  snapshotFingerprint?: string;
  dependencies?: string[];
  jobId?: string;
  stageId?: string;
}
export function digestFor(batchId: string, options: DigestOptions = {}): string {
  const payloads = options.payloads ?? [op()];
  return computeWorkflowBatchDigest({
    jobId: options.jobId ?? "job-1", stageId: options.stageId ?? "stage-1", batchId, dependencies: options.dependencies ?? [],
    snapshotFingerprint: options.snapshotFingerprint ?? "snap-1", undoUnitId: `undo-${batchId}`, undoUnitCount: 1,
    dimensions: dimensionsFor(batchId), operations: payloads.map((payload, ordinal) => ({ operationId: `${batchId}:op:${ordinal}`, ordinal, type: payload.type, payload })),
  });
}

export function authorityEvents(jobId: string, batchId: string, prefix = batchId, snapshotFingerprint = "snap-1"): WorkflowEvent[] {
  return (["validator", "target_resolver", "host_profile", "verifier_contract", "mutation_classification", "recovery_audit", "policy_decision"] as const).map((kind, index) => event("authority.recorded", { jobId, evidence: { evidenceId: `${batchId}-ev-${index}`, kind, jobId, batchId, snapshotFingerprint, basis: kind, recordedAt: at } }, `${prefix}-authority-${index}`));
}

export function baseEvents(jobId = "job-1", stageId = "stage-1", batchId = "batch-1"): WorkflowEvent[] {
  return [
    event("job.opened", { jobId, engineId: "workflow-v1", title: "Build title", goalSummary: "Create and verify a bounded title treatment.", successCriteria: [] }, `${jobId}-open`),
    event("stage.opened", { jobId, stageId, title: "Composition", purpose: "Execute the composition change", successCriteria: [] }, `${stageId}-open`),
    event("batch.proposed", { jobId, stageId, batchId, summary: "Create the title", dependencies: [] }, `${batchId}-propose`),
    event("operation.proposed", { jobId, stageId, batchId, ordinal: 0, payload: op() }, `${batchId}-operation-propose`),
    ...authorityEvents(jobId, batchId),
    event("batch.admitted", { jobId, stageId, batchId, digest: digestFor(batchId, { jobId, stageId }), snapshotFingerprint: "snap-1", undoUnitId: `undo-${batchId}`, undoUnitCount: 1, dimensions: dimensionsFor(batchId) }, `${batchId}-admit`),
    event("batch.queued", { jobId, batchId }, `${batchId}-queue`),
  ];
}

export function claimedState(events = baseEvents()): WorkflowState {
  return applyWorkflowEvent(replayWorkflowEvents(events), event("batch.claimed", { jobId: "job-1", batchId: "batch-1" }, "batch-1-claim"));
}

export function executingState(events = baseEvents()): WorkflowState {
  return applyWorkflowEvent(claimedState(events), event("batch.executing", { jobId: "job-1", batchId: "batch-1" }, "batch-1-execute"));
}

function outcomeKind(result: WorkflowReceipt): WorkflowOperationOutcomeKind {
  if (result.execution === "executed") return result.verification === "verified" ? "confirmed" : result.verification === "failed" ? "readback_mismatch" : "applied_unconfirmed";
  if (result.execution === "rejected_before_apply" || result.execution === "unknown") return result.execution;
  return "failed_during_apply";
}

function defaultOutcome(result: WorkflowReceipt): WorkflowOperationOutcome {
  return {
    operationId: result.receiptId === "criteria-receipt" ? "batch-criteria:op:0" : "batch-1:op:0",
    ordinal: 0,
    type: "set_layer_name",
    outcome: outcomeKind(result),
    mutation: result.mutation,
    verification: result.verification,
    mayHaveMutated: result.mayHaveMutated,
    ...(result.verificationBasis === undefined ? {} : { basis: result.verificationBasis }),
    ...(result.observedFingerprint === undefined ? {} : { observedFingerprint: result.observedFingerprint }),
  };
}

export function receipt(overrides: Partial<WorkflowReceipt> = {}): WorkflowReceipt {
  const result: WorkflowReceipt = {
    receiptId: "receipt-1",
    receivedAt: at,
    execution: "executed",
    mutation: "applied",
    mayHaveMutated: true,
    verification: "verified",
    verificationBasis: "fresh-readback",
    observedFingerprint: "snap-2",
    outcomes: [],
    ...overrides,
  };
  return { ...result, outcomes: result.outcomes.length > 0 ? result.outcomes : [defaultOutcome(result)] };
}

export function throwsCode(action: () => void, code: WorkflowTransitionError["code"]): void {
  assert.throws(action, (error) => error instanceof WorkflowTransitionError && error.code === code);
}

export function createWorkflowStateForTest(): WorkflowState {
  return replayWorkflowEvents([]);
}


export function parsedObject(serialized: string): JsonObject {
  return decodeOrThrow(jsonObject, JSON.parse(serialized));
}

export function present<T>(value: T | null | undefined, what = "value"): T {
  assert.ok(value !== undefined && value !== null, `expected ${what} to be present`);
  return value;
}
