// Dispatch transitions: queueing, approval binding, claiming the apply lease, starting execution and cancellation of an unsettled batch.

import { assert, boundedText, id } from "../assertions.js";
import { signature } from "../canonical-json.js";
import type { WorkflowAdmission, WorkflowApprovalBinding } from "../admission-types.js";
import { MAX_WORKFLOW_ID_LENGTH } from "../limits.js";
import { leaseOwns } from "../ownership.js";
import {
  allDependenciesVerified,
  assertProgressAllowed,
  batch,
  job,
  own,
  setRecord,
  stage,
  UNDISPATCHED_LIFECYCLES,
  updateOperationStatuses,
} from "../state.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";

const DIGEST_MAX = MAX_WORKFLOW_ID_LENGTH * 4;

const queueBatch: Transition<"batch.queued"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assertProgressAllowed(job(next, event.jobId), stage(next, current.stageId));
  assert(current.lifecycle === "admitted", "ILLEGAL_TRANSITION", "Only an admitted batch can be queued.");
  assert(!current.cancelRequested, "ILLEGAL_TRANSITION", "A cancelled batch cannot queue future work.");
  next.batches = setRecord(next.batches, event.batchId, {
    ...current,
    lifecycle: "queued",
    execution: { ...current.execution, state: "queued" },
    updatedAt: event.at,
  });
  return next;
};

function assertApprovalMatches(event: EventOf<"batch.approvalBound">, admission: WorkflowAdmission): void {
  boundedText(event.sourcePlanDigest, "source plan digest", DIGEST_MAX);
  boundedText(event.digest, "approval digest", DIGEST_MAX);
  boundedText(event.snapshotFingerprint, "approval snapshot fingerprint", DIGEST_MAX);
  assert(event.digest === admission.digest && event.snapshotFingerprint === admission.snapshotFingerprint, "INVALID_EVENT", "Approval must bind to the sealed batch digest and execution snapshot.");
  assert(!admission.sourcePlanDigest || event.sourcePlanDigest === admission.sourcePlanDigest, "INVALID_EVENT", "Approval must bind to the immutable source action-plan digest.");
}

const bindApproval: Transition<"batch.approvalBound"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(current.lifecycle === "queued", "ILLEGAL_TRANSITION", "Approval can only bind to a queued batch.");
  assert(current.admission !== null, "ILLEGAL_TRANSITION", "Approval requires an admitted batch.");
  id(event.approvalId, "approvalId");
  assertApprovalMatches(event, current.admission);
  const approval: WorkflowApprovalBinding = {
    approvalId: event.approvalId,
    sourcePlanDigest: event.sourcePlanDigest,
    digest: event.digest,
    snapshotFingerprint: event.snapshotFingerprint,
    approvedAt: event.at,
  };
  if (current.approval) assert(signature(current.approval) === signature(approval), "DUPLICATE_EVENT_CONFLICT", "Approval binding is immutable.");
  else next.batches = setRecord(next.batches, event.batchId, { ...current, approval, updatedAt: event.at });
  return next;
};

const claimBatch: Transition<"batch.claimed"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assertProgressAllowed(job(next, event.jobId), stage(next, current.stageId));
  assert(current.lifecycle === "queued", "ILLEGAL_TRANSITION", "Only a queued batch can be claimed.");
  assert(current.admission?.dimensions.policy.decision === "automatic" || current.approval !== null, "ILLEGAL_TRANSITION", "A manually governed batch must carry a real approval binding before dispatch.");
  assert(!current.cancelRequested, "ILLEGAL_TRANSITION", "A cancelled batch cannot dispatch future work.");
  assert(allDependenciesVerified(next, current), "DEPENDENCY_BLOCKED", "A batch cannot dispatch until every dependency is verified.");
  assert(next.activeDispatchLease === null, "DISPATCH_LANE_BUSY", `The ${next.activeDispatchLease?.kind ?? "host"} dispatch lease is busy.`);
  next.activeDispatchLease = { kind: "apply", jobId: event.jobId, batchId: event.batchId };
  next.batches = setRecord(next.batches, event.batchId, {
    ...current,
    lifecycle: "claimed",
    execution: { ...current.execution, state: "claimed" },
    updatedAt: event.at,
  });
  return next;
};

const executeBatch: Transition<"batch.executing"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(current.lifecycle === "claimed", "ILLEGAL_TRANSITION", "Only a claimed batch can start execution.");
  assert(leaseOwns(next, "apply", event.jobId, event.batchId), "DISPATCH_LANE_BUSY", "The batch does not own the apply dispatch lease.");
  next.batches = setRecord(next.batches, event.batchId, {
    ...current,
    lifecycle: "executing",
    execution: { ...current.execution, state: "applying" },
    updatedAt: event.at,
  });
  return next;
};

const cancelBatch: Transition<"batch.cancelRequested"> = (next, event) => {
  const current = own(batch(next, event.batchId), event.jobId, "Batch");
  assert(current.lifecycle !== "settled" && current.lifecycle !== "cancelled", "ILLEGAL_TRANSITION", "A settled batch cannot be cancelled.");
  const beforeDispatch = UNDISPATCHED_LIFECYCLES.has(current.lifecycle);
  next.batches = setRecord(next.batches, event.batchId, beforeDispatch
    ? { ...current, lifecycle: "cancelled", cancelRequested: true, execution: { ...current.execution, state: "not_started" }, updatedAt: event.at }
    : { ...current, cancelRequested: true, updatedAt: event.at });
  if (beforeDispatch) updateOperationStatuses(next, current, "cancelled");
  return next;
};

export const DISPATCH_TRANSITIONS = {
  "batch.queued": queueBatch,
  "batch.approvalBound": bindApproval,
  "batch.claimed": claimBatch,
  "batch.executing": executeBatch,
  "batch.cancelRequested": cancelBatch,
} satisfies TransitionSlice;
