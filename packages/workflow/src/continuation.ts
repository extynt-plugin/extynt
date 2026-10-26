// Continuation projection: the compact, redacted, read-only view of settled evidence and blockers that seeds the next model cycle.

import type { WorkflowCapabilityDisclosure } from "./admission-types.js";
import { assert } from "./assertions.js";
import { validateWorkflowCapabilityDisclosure } from "./capability-disclosure.js";
import type { WorkflowContinuationBatchEvidence, WorkflowContinuationInput, WorkflowContinuationOperationEvidence, WorkflowContinuationReceiptEvidence, WorkflowContinuationSnapshot } from "./continuation-types.js";
import { continuationCreatedBindings } from "./created-bindings.js";
import type { WorkflowOperationOutcome, WorkflowReceipt } from "./evidence-types.js";
import type { WorkflowId } from "./identity.js";
import { workflowGoalDigest } from "./identity.js";
import { MAX_WORKFLOW_CONTINUATION_BATCHES, MAX_WORKFLOW_CONTINUATION_BLOCKERS, MAX_WORKFLOW_GOAL_LENGTH, MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_OPERATIONS_PER_BATCH, WORKFLOW_SCHEMA_VERSION } from "./limits.js";
import { redactWorkflowText } from "./redaction.js";
import type { WorkflowBatch, WorkflowJob, WorkflowStage, WorkflowState } from "./state-types.js";
import { workflowVerificationCoverage } from "./verification-coverage.js";

/** Optional inputs of a continuation projection. */
export interface WorkflowContinuationOptions {
  readonly cycle?: number;
  readonly capabilities?: WorkflowCapabilityDisclosure;
}

const MAX_REPORTED_CYCLE = 1024;
const READBACK_TEXT_LIMIT = 512;
const OPEN_LIFECYCLES: ReadonlySet<string> = new Set(["settled", "cancelled"]);
const FINGERPRINT_LIMIT = MAX_WORKFLOW_ID_LENGTH * 4;

function continuationReadback(readback: NonNullable<WorkflowOperationOutcome["readback"]>): NonNullable<WorkflowContinuationOperationEvidence["readback"]> {
  return {
    ...(readback.targetLayerId ? { targetLayerId: redactWorkflowText(readback.targetLayerId, MAX_WORKFLOW_ID_LENGTH) } : {}),
    ...(readback.expected !== undefined ? { expected: redactWorkflowText(readback.expected, READBACK_TEXT_LIMIT) } : {}),
    ...(readback.observed !== undefined ? { observed: redactWorkflowText(readback.observed, READBACK_TEXT_LIMIT) } : {}),
  };
}

function continuationOutcome(row: WorkflowOperationOutcome): WorkflowContinuationOperationEvidence {
  return {
    operationId: row.operationId,
    ordinal: row.ordinal,
    type: row.type,
    outcome: row.outcome,
    mutation: row.mutation,
    verification: row.verification,
    mayHaveMutated: row.mayHaveMutated,
    ...(row.basis ? { basis: redactWorkflowText(row.basis) } : {}),
    ...(row.observedFingerprint ? { observedFingerprint: redactWorkflowText(row.observedFingerprint, FINGERPRINT_LIMIT) } : {}),
    ...(row.readback ? { readback: continuationReadback(row.readback) } : {}),
  };
}

function continuationReceipt(receipt: WorkflowReceipt | null): WorkflowContinuationReceiptEvidence | null {
  if (!receipt) return null;
  return {
    receiptId: redactWorkflowText(receipt.receiptId, FINGERPRINT_LIMIT),
    execution: receipt.execution,
    mutation: receipt.mutation,
    verification: receipt.verification,
    mayHaveMutated: receipt.mayHaveMutated,
    receivedAt: receipt.receivedAt,
    outcomes: receipt.outcomes.slice(0, MAX_WORKFLOW_OPERATIONS_PER_BATCH).map(continuationOutcome),
  };
}

function continuationBatch(batch: WorkflowBatch): WorkflowContinuationBatchEvidence {
  return {
    batchId: batch.batchId,
    stageId: batch.stageId,
    ...(batch.admission?.sourcePlanId ? { sourcePlanId: batch.admission.sourcePlanId } : {}),
    lifecycle: batch.lifecycle,
    execution: batch.execution.state,
    mutation: batch.execution.mutation,
    verification: batch.verification.state,
    verificationCoverage: workflowVerificationCoverage(batch),
    receipt: continuationReceipt(batch.execution.receipt),
  };
}

function continuationStage(state: WorkflowState, job: WorkflowJob): WorkflowStage {
  const stage = job.stageIds.map((stageId) => state.stages[stageId]).filter((candidate): candidate is WorkflowStage => candidate !== undefined).at(-1);
  assert(stage !== undefined, "NOT_FOUND", `Workflow job ${job.jobId} has no stage for continuation.`);
  return stage;
}

function unresolvedCriteria(job: WorkflowJob): WorkflowContinuationInput["unresolvedCriteria"] {
  return job.successCriteria
    .filter((criterion) => !job.satisfiedCriteria[criterion.criterionId])
    .slice(0, MAX_WORKFLOW_CONTINUATION_BLOCKERS)
    .map((criterion) => ({
      criterionId: redactWorkflowText(criterion.criterionId),
      description: redactWorkflowText(criterion.description),
      ...(criterion.requiredEvidenceKind ? { requiredEvidenceKind: criterion.requiredEvidenceKind } : {}),
    }));
}

function supersededSafeRejection(current: WorkflowBatch, jobBatches: readonly WorkflowBatch[]): boolean {
  if (current.execution.state !== "rejected_before_apply" || current.execution.mutation !== "none" || current.execution.mayHaveMutated) return false;
  const index = jobBatches.findIndex((candidate) => candidate.batchId === current.batchId);
  return jobBatches.slice(index + 1).some((candidate) => candidate.stageId === current.stageId && candidate.lifecycle === "settled" && candidate.verification.state === "verified");
}

function jobBlockers(state: WorkflowState, job: WorkflowJob): string[] {
  const blockers: string[] = [];
  if (job.status === "blocked" || job.status === "cancelled" || job.status === "completed") blockers.push(`job:${job.status}`);
  const lease = state.activeDispatchLease;
  if (lease && lease.jobId === job.jobId) blockers.push(`dispatch:${lease.kind}:${lease.batchId}`);
  return blockers;
}

function batchBlockers(settled: readonly WorkflowBatch[], jobBatches: readonly WorkflowBatch[]): string[] {
  const unverified = settled.filter((current) => current.verification.state !== "verified" && !supersededSafeRejection(current, jobBatches));
  const unfinished = jobBatches.filter((candidate) => !OPEN_LIFECYCLES.has(candidate.lifecycle));
  return [
    ...unverified.map((current) => `batch:${current.batchId}:settled:${current.execution.state}:${current.verification.state}`),
    ...unfinished.map((current) => `batch:${current.batchId}:lifecycle:${current.lifecycle}`),
  ];
}

function continuationBlockers(state: WorkflowState, job: WorkflowJob, settled: readonly WorkflowBatch[], jobBatches: readonly WorkflowBatch[]): readonly string[] {
  const blockers = [...jobBlockers(state, job), ...batchBlockers(settled, jobBatches)];
  return [...new Set(blockers)].slice(0, MAX_WORKFLOW_CONTINUATION_BLOCKERS).map((value) => redactWorkflowText(value));
}

function reportedCycle(job: WorkflowJob, requested: number | undefined): number {
  const cycle = requested ?? job.providerCycle;
  return Number.isInteger(cycle) && cycle >= 0 ? Math.min(MAX_REPORTED_CYCLE, cycle) : job.providerCycle;
}

function continuationSnapshot(snapshot: WorkflowContinuationSnapshot): WorkflowContinuationSnapshot {
  return { fingerprint: redactWorkflowText(snapshot.fingerprint, FINGERPRINT_LIMIT), revision: snapshot.revision ? redactWorkflowText(snapshot.revision, FINGERPRINT_LIMIT) : null };
}

/** Projects only settled execution evidence and bounded blockers for the next model call; the reducer stays the authority and this read-only projection can neither create a binding nor change lifecycle state. */
export function buildWorkflowContinuationInput(state: WorkflowState, jobId: WorkflowId, snapshot: WorkflowContinuationSnapshot, options: WorkflowContinuationOptions = {}): WorkflowContinuationInput {
  const job = state.jobs[jobId];
  assert(job !== undefined, "NOT_FOUND", `Workflow job ${jobId} does not exist.`);
  const stage = continuationStage(state, job);
  assert(snapshot.fingerprint.length > 0, "INVALID_EVENT", "Continuation snapshot fingerprint is required.");
  const jobBatches = job.batchIds.map((batchId) => state.batches[batchId]).filter((candidate): candidate is WorkflowBatch => candidate !== undefined);
  const settled = jobBatches.filter((batch) => batch.lifecycle === "settled" || batch.lifecycle === "cancelled");
  const activeCandidate = [...jobBatches].reverse().find((batch) => !OPEN_LIFECYCLES.has(batch.lifecycle));
  const input = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    jobId,
    goalSummary: redactWorkflowText(job.goalSummary, MAX_WORKFLOW_GOAL_LENGTH),
    goalDigest: workflowGoalDigest(job.goalSummary),
    stageId: stage.stageId,
    stageStatus: stage.status,
    cycle: reportedCycle(job, options.cycle),
    batchCount: jobBatches.length,
    snapshot: continuationSnapshot(snapshot),
    activeBatch: activeCandidate ? continuationBatch(activeCandidate) : null,
    settledBatches: settled.slice(-MAX_WORKFLOW_CONTINUATION_BATCHES).map(continuationBatch),
    createdIdBindings: continuationCreatedBindings(settled),
    unresolvedCriteria: unresolvedCriteria(job),
    blockers: continuationBlockers(state, job, settled, jobBatches),
    limits: { ...job.constraints },
  } satisfies WorkflowContinuationInput;
  if (options.capabilities === undefined) return input;
  validateWorkflowCapabilityDisclosure(options.capabilities);
  return { ...input, capabilities: options.capabilities };
}
