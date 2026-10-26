// Admission transitions: recording authority evidence and sealing a proposed batch into an immutable, digest-bound contract.

import { validateAdmissionDimensions, validateAuthorityForAdmission, validateOperationPayloads } from "../admission-validation.js";
import type { WorkflowAdmission, WorkflowAdmittedOperation, WorkflowBatchDigestInput } from "../admission-types.js";
import { assert, boundedText, id, timestamp } from "../assertions.js";
import { computeWorkflowBatchDigest } from "../canonical-json.js";
import { frozenCopy, clone } from "../frozen-state.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_OPERATIONS_PER_BATCH, MAX_WORKFLOW_SUMMARY_LENGTH } from "../limits.js";
import { allDependenciesVerified, assertProgressAllowed, batch, job, own, setRecord, stage, updateOperationStatuses } from "../state.js";
import type { WorkflowBatch } from "../state-types.js";
import { validatePostconditionContracts } from "../verification.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";

const FINGERPRINT_MAX = MAX_WORKFLOW_ID_LENGTH * 4;

const recordAuthority: Transition<"authority.recorded"> = (next, event) => {
  const evidence = event.evidence;
  id(evidence.evidenceId, "evidenceId");
  own(job(next, event.jobId), event.jobId, "Job");
  assert(evidence.jobId === event.jobId, "WRONG_OWNER", "Authority evidence belongs to another job.");
  own(batch(next, evidence.batchId), event.jobId, "Batch");
  boundedText(evidence.snapshotFingerprint, "authority snapshot fingerprint", FINGERPRINT_MAX);
  boundedText(evidence.basis, "authority basis", MAX_WORKFLOW_SUMMARY_LENGTH);
  timestamp(evidence.recordedAt);
  assert(!next.authorityEvidence[evidence.evidenceId], "DUPLICATE_EVENT_CONFLICT", `Authority evidence ${evidence.evidenceId} is immutable.`);
  next.authorityEvidence = setRecord(next.authorityEvidence, evidence.evidenceId, frozenCopy(evidence));
  return next;
};

function assertAdmissible(next: MutableWorkflowState, event: EventOf<"batch.admitted">, current: WorkflowBatch): void {
  assert(current.stageId === event.stageId, "WRONG_OWNER", "Admission stage does not match its batch.");
  assert(current.lifecycle === "proposed", "ILLEGAL_TRANSITION", "Only a proposed batch can be admitted.");
  assert(current.operationIds.length > 0, "ILLEGAL_TRANSITION", "An empty batch cannot be admitted.");
  assert(current.operationIds.length <= MAX_WORKFLOW_OPERATIONS_PER_BATCH, "LIMIT_EXCEEDED", "The workflow operation limit has been reached.");
  assert(current.dependencies.every((dependencyId) => next.batches[dependencyId] !== undefined), "DEPENDENCY_BLOCKED", "All dependencies must exist before admission.");
  assert(allDependenciesVerified(next, current), "DEPENDENCY_BLOCKED", "Every dependency must already be settled and verified before admission.");
}

function assertDependenciesAtSnapshot(next: MutableWorkflowState, event: EventOf<"batch.admitted">, current: WorkflowBatch): void {
  assert(current.dependencies.every((dependencyId) => next.batches[dependencyId]?.execution.receipt?.observedFingerprint === event.snapshotFingerprint), "DEPENDENCY_BLOCKED", "A batch snapshot must match every dependency's verified post-apply snapshot.");
  assert(!Object.values(next.batches).some((candidate) => candidate.admission?.undoUnitId === event.undoUnitId), "INVALID_UNDO_UNIT", `Undo unit ${event.undoUnitId} is already assigned to another workflow batch.`);
}

function admittedOperations(next: MutableWorkflowState, current: WorkflowBatch): readonly WorkflowAdmittedOperation[] {
  return current.operationIds.map((operationId) => {
    const operation = next.operations[operationId];
    assert(operation !== undefined, "NOT_FOUND", `Operation ${operationId} does not exist.`);
    return { operationId: operation.operationId, ordinal: operation.ordinal, type: operation.type, payload: operation.payload };
  });
}

function digestInput(event: EventOf<"batch.admitted">, current: WorkflowBatch, operations: readonly WorkflowAdmittedOperation[]): WorkflowBatchDigestInput {
  return {
    jobId: event.jobId,
    stageId: event.stageId,
    batchId: event.batchId,
    dependencies: current.dependencies,
    snapshotFingerprint: event.snapshotFingerprint,
    ...(event.sourcePlanId === undefined ? {} : { sourcePlanId: event.sourcePlanId }),
    ...(event.sourcePlanDigest === undefined ? {} : { sourcePlanDigest: event.sourcePlanDigest }),
    undoUnitId: event.undoUnitId,
    undoUnitCount: 1,
    dimensions: event.dimensions,
    ...(event.postconditions ? { postconditions: event.postconditions } : {}),
    operations,
  };
}

function sealAdmission(event: EventOf<"batch.admitted">, operations: readonly WorkflowAdmittedOperation[]): WorkflowAdmission {
  return {
    digest: event.digest,
    ...(event.sourcePlanId ? { sourcePlanId: event.sourcePlanId } : {}),
    ...(event.sourcePlanDigest ? { sourcePlanDigest: event.sourcePlanDigest } : {}),
    snapshotFingerprint: event.snapshotFingerprint,
    undoUnitId: event.undoUnitId,
    undoUnitCount: 1,
    dimensions: clone(event.dimensions),
    ...(event.postconditions ? { postconditions: frozenCopy(event.postconditions) } : {}),
    operations: frozenCopy(operations),
    admittedAt: event.at,
  };
}

function assertEventContents(next: MutableWorkflowState, event: EventOf<"batch.admitted">): void {
  id(event.undoUnitId, "undoUnitId");
  assert(event.undoUnitCount === 1, "INVALID_UNDO_UNIT", "A workflow batch must prove exactly one host undo unit; split a multi-undo legacy plan before admission.");
  boundedText(event.digest, "digest", FINGERPRINT_MAX);
  boundedText(event.snapshotFingerprint, "snapshotFingerprint", FINGERPRINT_MAX);
  validateAdmissionDimensions(event.dimensions);
  validatePostconditionContracts(event.postconditions);
  validateAuthorityForAdmission({ state: next, dimensions: event.dimensions, jobId: event.jobId, batchId: event.batchId, snapshotFingerprint: event.snapshotFingerprint });
}

const admitBatch: Transition<"batch.admitted"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  const currentStage = own(stage(next, event.stageId), event.jobId, "Stage");
  assertProgressAllowed(job(next, event.jobId), currentStage);
  assertEventContents(next, event);
  assertAdmissible(next, event, current);
  assertDependenciesAtSnapshot(next, event, current);
  const operations = admittedOperations(next, current);
  validateOperationPayloads(operations.map((operation) => operation.payload), event.snapshotFingerprint);
  if (event.sourcePlanId !== undefined) id(event.sourcePlanId, "sourcePlanId");
  assert(event.digest === computeWorkflowBatchDigest(digestInput(event, current, operations)), "INVALID_EVENT", "Batch digest does not match the canonical admitted contents.");
  next.batches = setRecord(next.batches, event.batchId, { ...current, lifecycle: "admitted", admission: sealAdmission(event, operations), updatedAt: event.at });
  updateOperationStatuses(next, current, "admitted");
  return next;
};

/**
 * Authority evidence and batch admission. A verified dependency's receipt is the only durable statement of the host
 * state a descendant may target, so admission requires every dependency's post-apply snapshot to equal the batch's.
 */
export const ADMISSION_TRANSITIONS = {
  "authority.recorded": recordAuthority,
  "batch.admitted": admitBatch,
} satisfies TransitionSlice;
