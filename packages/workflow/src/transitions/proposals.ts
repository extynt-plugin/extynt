// Proposal transitions: opening a batch inside an active stage and appending its ordered operations.

import { assert, boundedText, id, uniqueIds } from "../assertions.js";
import { MAX_WORKFLOW_DEPENDENCIES_PER_BATCH, MAX_WORKFLOW_OPERATIONS_PER_BATCH, MAX_WORKFLOW_SUMMARY_LENGTH } from "../limits.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { INITIAL_EXECUTION, INITIAL_RECOVERY, INITIAL_VERIFICATION, assertProgressAllowed, batch, job, own, setRecord, stage } from "../state.js";
import type { WorkflowBatch, WorkflowOperation } from "../state-types.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";

function assertDependencies(next: MutableWorkflowState, event: EventOf<"batch.proposed">, dependencies: readonly string[]): void {
  for (const dependencyId of dependencies) {
    const dependency = next.batches[dependencyId];
    assert(dependency !== undefined, "DEPENDENCY_BLOCKED", `Dependency ${dependencyId} does not exist.`);
    assert(dependency.jobId === event.jobId, "WRONG_OWNER", `Dependency ${dependencyId} belongs to another job.`);
    assert(dependencyId !== event.batchId, "DEPENDENCY_BLOCKED", "A batch cannot depend on itself.");
  }
}

const proposeBatch: Transition<"batch.proposed"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  const currentStage = own(stage(next, event.stageId), event.jobId, "Stage");
  id(event.batchId, "batchId");
  boundedText(event.summary, "summary", MAX_WORKFLOW_SUMMARY_LENGTH);
  const dependencies = uniqueIds(event.dependencies ?? [], "dependencies", MAX_WORKFLOW_DEPENDENCIES_PER_BATCH);
  assert(!next.batches[event.batchId], "ILLEGAL_TRANSITION", `Batch ${event.batchId} already exists.`);
  assertProgressAllowed(currentJob, currentStage);
  assert(currentStage.status === "active" || currentStage.status === "open", "ILLEGAL_TRANSITION", "A batch can only be proposed in an active stage.");
  assertDependencies(next, event, dependencies);
  assert(currentJob.batchIds.length < currentJob.constraints.maxBatches, "LIMIT_EXCEEDED", "The job batch limit has been reached.");
  const value: WorkflowBatch = {
    batchId: event.batchId,
    jobId: event.jobId,
    stageId: event.stageId,
    lifecycle: "proposed",
    summary: event.summary,
    dependencies,
    operationIds: [],
    admission: null,
    approval: null,
    execution: INITIAL_EXECUTION,
    verification: INITIAL_VERIFICATION,
    recovery: INITIAL_RECOVERY,
    cancelRequested: false,
    createdAt: event.at,
    updatedAt: event.at,
  };
  next.batches = setRecord(next.batches, event.batchId, value);
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, status: "active", batchIds: [...currentJob.batchIds, event.batchId], updatedAt: event.at });
  next.stages = setRecord(next.stages, event.stageId, { ...currentStage, status: "active", batchIds: [...currentStage.batchIds, event.batchId], updatedAt: event.at });
  return next;
};

function jobOperationCount(next: MutableWorkflowState, batchIds: readonly string[]): number {
  return batchIds.reduce((count, batchId) => count + (next.batches[batchId]?.operationIds.length ?? 0), 0);
}

const proposeOperation: Transition<"operation.proposed"> = (next, event) => {
  const currentBatch = own(batch(next, event.batchId), event.jobId, "Batch");
  const currentStage = own(stage(next, event.stageId), event.jobId, "Stage");
  assertProgressAllowed(job(next, event.jobId), currentStage);
  assert(currentBatch.stageId === event.stageId, "WRONG_OWNER", "Operation stage does not match its batch.");
  assert(currentBatch.lifecycle === "proposed", "IMMUTABLE_ADMISSION", "Operations cannot be added after admission.");
  assert(currentBatch.operationIds.length < MAX_WORKFLOW_OPERATIONS_PER_BATCH, "LIMIT_EXCEEDED", "The workflow operation limit has been reached.");
  assert(Number.isInteger(event.ordinal) && event.ordinal === currentBatch.operationIds.length, "INVALID_EVENT", "Operation ordinals must be contiguous and zero-based.");
  const currentJob = job(next, event.jobId);
  assert(jobOperationCount(next, currentJob.batchIds) < currentJob.constraints.maxOperations, "LIMIT_EXCEEDED", "The job operation limit has been reached.");
  const operationId = `${event.batchId}:op:${event.ordinal}`;
  const operation: WorkflowOperation = { operationId, batchId: event.batchId, ordinal: event.ordinal, type: event.payload.type, payload: event.payload, status: "proposed", outcome: null };
  next.operations = setRecord(next.operations, operationId, operation);
  next.batches = setRecord(next.batches, event.batchId, { ...currentBatch, operationIds: [...currentBatch.operationIds, operationId], updatedAt: event.at });
  return next;
};

export const PROPOSAL_TRANSITIONS = {
  "batch.proposed": proposeBatch,
  "operation.proposed": proposeOperation,
} satisfies TransitionSlice;
