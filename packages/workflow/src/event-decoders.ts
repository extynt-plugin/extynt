// Decoders that turn untrusted event JSON into exact workflow events and admission dimensions; the reducer's own checks then judge the values.

import { array, boolean, jsonObject, literal, number, object, optional, refine, string, taggedUnion } from "@extynt/decode";
import type { AnyDecoder, Decoder, JsonObject, Shape } from "@extynt/decode";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import type { WorkflowAuthorityEvidenceKind } from "./admission-types.js";
import { isBoundedText, isTimestamp } from "./assertions.js";
import type { WorkflowEvent } from "./events.js";
import { isWorkflowId } from "./identity.js";
import { MAX_WORKFLOW_SUMMARY_LENGTH, WORKFLOW_ENGINE_ID } from "./limits.js";

const verificationKind = literal("structural", "host_evidence", "visual", "temporal");
const mutationState = literal("none", "applied", "may_have_mutated", "unknown");
const verificationState = literal("not_requested", "verified", "applied_unverified", "failed", "unknown");

const AUTHORITY_KINDS: readonly WorkflowAuthorityEvidenceKind[] = ["validator", "target_resolver", "host_profile", "verifier_contract", "mutation_classification", "recovery_audit", "policy_decision"];

const evidenceId: Decoder<string> = refine(string(), isWorkflowId, "a bounded workflow id");
const basis: Decoder<string> = refine(string(), (text): text is string => isBoundedText(text, MAX_WORKFLOW_SUMMARY_LENGTH), "bounded text");

/** Decoder that hands the input on untouched, for values a later check judges. */
export const PASSTHROUGH: AnyDecoder = { run: (input) => input };

function isOperationPayload(payload: JsonObject): payload is JsonObject & ActionPlanV2Operation {
  return typeof payload.type === "string";
}

const operationPayload: Decoder<ActionPlanV2Operation> = refine(jsonObject, isOperationPayload, "a typed operation");

/** Decoder for the seven admission dimensions with their enumerations and bounded evidence identity. */
export const ADMISSION_DIMENSIONS = object({
  schemaValue: object({ evidenceId, basis, state: literal("valid", "invalid") }),
  targetDependency: object({ evidenceId, basis, state: literal("resolved", "unresolved", "unknown") }),
  hostCapability: object({ evidenceId, basis, state: literal("supported", "probationary", "unknown", "unavailable", "regressed") }),
  verificationCapability: object({ evidenceId, basis, state: literal("exact", "partial", "intrinsically_unobservable") }),
  mutationBehavior: object({ evidenceId, basis, state: literal("idempotent", "ensuring", "creating", "destructive", "external") }),
  recovery: object({ evidenceId, basis, state: literal("fully_undoable", "partially_undoable", "not_undoable") }),
  policy: object({ evidenceId, basis, decision: literal("automatic", "manual"), approvalId: optional(string()) }),
});

const readback = object({ targetLayerId: optional(string()), expected: optional(string()), observed: optional(string()) });

const outcome = object({
  operationId: string(),
  ordinal: number(),
  type: string(),
  outcome: literal("confirmed", "host_confirmed", "coerced_equivalent", "applied_unconfirmed", "readback_mismatch", "rejected_before_apply", "failed_during_apply", "applied_before_failure", "not_attempted", "unknown"),
  mutation: mutationState,
  verification: verificationState,
  mayHaveMutated: boolean(),
  basis: optional(string()),
  observedFingerprint: optional(string()),
  readback: optional(readback),
});

const postconditionContract = object({ postconditionId: string(), kind: verificationKind, description: string(), required: boolean() });

const postconditionEvidence = object({
  postconditionId: string(),
  kind: verificationKind,
  state: literal("passed", "failed", "unavailable", "not_evaluated"),
  basis: string(),
  observedFingerprint: optional(string()),
});

const hostEvidence = object({
  evidenceId: string(),
  jobId: string(),
  batchId: string(),
  operationId: optional(string()),
  kind: verificationKind,
  basis: string(),
  observedFingerprint: optional(string()),
  recordedAt: string(),
});

const createdBinding = object({ placeholder: string(), createdId: string(), operationId: string(), readbackField: string(), observedFingerprint: string() });

const receipt = object({
  receiptId: string(),
  receivedAt: string(),
  execution: literal("executed", "rejected_before_apply", "failed_during_apply", "unknown"),
  mutation: mutationState,
  mayHaveMutated: boolean(),
  verification: verificationState,
  verificationBasis: optional(string()),
  observedFingerprint: optional(string()),
  postconditions: optional(array(postconditionEvidence)),
  hostEvidence: optional(array(hostEvidence)),
  outcomes: array(outcome),
  createdBindings: optional(array(createdBinding)),
});

const undoReceipt = object({
  receiptId: string(),
  status: literal("executed", "rejected", "unknown"),
  receivedAt: string(),
  restoredFingerprint: optional(string()),
  basis: optional(string()),
  verification: literal("restored", "mismatch", "undo_unverified", "unavailable", "unknown"),
});

const criterion = object({ criterionId: string(), description: string(), requiredEvidenceKind: optional(verificationKind) });

const authorityEvidence = object({
  evidenceId: string(),
  kind: literal(...AUTHORITY_KINDS),
  jobId: string(),
  batchId: string(),
  snapshotFingerprint: string(),
  basis: string(),
  recordedAt: string(),
});

const observationEvidence = object({
  evidenceId: string(),
  jobId: string(),
  stageId: optional(string()),
  kind: literal("structural", "visual", "temporal"),
  basis: string(),
  observedFingerprint: optional(string()),
  captureId: optional(string()),
  compositionId: optional(string()),
  time: optional(number()),
  recordedAt: string(),
});

const criterionReference = taggedUnion("kind", {
  batch_receipt: object({ kind: literal("batch_receipt"), batchId: string(), receiptId: string() }),
  observation: object({ kind: literal("observation"), evidenceId: string() }),
});

const constraints = object({ maxStages: number(), maxBatches: number(), maxOperations: number() });

const eventId: Decoder<string> = refine(string(), isWorkflowId, "a bounded workflow id");
const eventAt: Decoder<string> = refine(string(), isTimestamp, "a strict ISO-8601 UTC timestamp");

function variant<Type extends string, Fields extends Shape>(type: Type, fields: Fields) {
  return object({ type: literal(type), eventId, at: eventAt, jobId: eventId, ...fields });
}

const batchFields = { batchId: string() };
const ownedFields = { batchId: string(), stageId: string() };
const receiptFields = { batchId: string(), receipt };
const undoReceiptFields = { batchId: string(), receipt: undoReceipt };

const EVENT_VARIANTS = {
  "job.opened": variant("job.opened", { engineId: literal(WORKFLOW_ENGINE_ID), title: string(), goalSummary: string(), constraints: optional(constraints), successCriteria: array(criterion), requestId: optional(string()), autoApply: optional(boolean()) }),
  "job.undoOpened": variant("job.undoOpened", {}),
  "job.blocked": variant("job.blocked", { reason: string() }),
  "job.providerCycleClosed": variant("job.providerCycleClosed", { cycle: number() }),
  "job.providerFailureRecorded": variant("job.providerFailureRecorded", { code: string(), message: string(), afterSeal: boolean() }),
  "job.providerFailureCleared": variant("job.providerFailureCleared", {}),
  "job.reopenedForContinuation": variant("job.reopenedForContinuation", {}),
  "job.reopenedAfterReconciliation": variant("job.reopenedAfterReconciliation", batchFields),
  "job.reopenedForRepair": variant("job.reopenedForRepair", batchFields),
  "job.reopenedForObservation": variant("job.reopenedForObservation", batchFields),
  "job.completed": variant("job.completed", {}),
  "job.cancelled": variant("job.cancelled", {}),
  "stage.opened": variant("stage.opened", { stageId: string(), title: string(), purpose: string(), successCriteria: array(criterion) }),
  "stage.completed": variant("stage.completed", { stageId: string() }),
  "batch.proposed": variant("batch.proposed", { ...ownedFields, summary: string(), dependencies: optional(array(string())) }),
  "operation.proposed": variant("operation.proposed", { ...ownedFields, ordinal: number(), payload: operationPayload }),
  "authority.recorded": variant("authority.recorded", { evidence: authorityEvidence }),
  "batch.admitted": variant("batch.admitted", {
    ...ownedFields,
    digest: string(),
    sourcePlanId: optional(string()),
    sourcePlanDigest: optional(string()),
    snapshotFingerprint: string(),
    undoUnitId: string(),
    undoUnitCount: literal(1),
    dimensions: ADMISSION_DIMENSIONS,
    postconditions: optional(array(postconditionContract)),
  }),
  "batch.approvalBound": variant("batch.approvalBound", { ...batchFields, approvalId: string(), sourcePlanDigest: string(), digest: string(), snapshotFingerprint: string() }),
  "batch.queued": variant("batch.queued", batchFields),
  "batch.claimed": variant("batch.claimed", batchFields),
  "batch.executing": variant("batch.executing", batchFields),
  "batch.cancelRequested": variant("batch.cancelRequested", batchFields),
  "batch.rejected": variant("batch.rejected", receiptFields),
  "batch.abandonedBeforeApply": variant("batch.abandonedBeforeApply", receiptFields),
  "batch.receipt": variant("batch.receipt", receiptFields),
  "batch.reconciled": variant("batch.reconciled", { ...receiptFields, priorReceiptId: string() }),
  "batch.undoRequested": variant("batch.undoRequested", { ...batchFields, expectedFingerprint: string() }),
  "batch.undoClaimed": variant("batch.undoClaimed", batchFields),
  "batch.undoExecuting": variant("batch.undoExecuting", batchFields),
  "batch.undoRejected": variant("batch.undoRejected", undoReceiptFields),
  "batch.undoReceipt": variant("batch.undoReceipt", undoReceiptFields),
  "batch.undoReconciled": variant("batch.undoReconciled", { ...undoReceiptFields, priorReceiptId: string() }),
  "observation.recorded": variant("observation.recorded", { evidence: observationEvidence }),
  "criterion.satisfied": variant("criterion.satisfied", { scope: literal("job", "stage"), stageId: optional(string()), criterionId: string(), reference: criterionReference }),
};

/** Decoder for any workflow event; the output carries exactly the fields of its variant. */
export const WORKFLOW_EVENT: Decoder<WorkflowEvent> = taggedUnion("type", EVENT_VARIANTS);
