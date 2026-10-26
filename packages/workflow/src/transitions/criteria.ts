// Criteria transitions: recording observations and satisfying job or stage criteria with evidence the reducer itself can verify.

import { assert, boundedText, id, timestamp } from "../assertions.js";
import { signature } from "../canonical-json.js";
import type { WorkflowVerificationKind } from "../evidence-types.js";
import { frozenCopy } from "../frozen-state.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import { MAX_WORKFLOW_ID_LENGTH, MAX_WORKFLOW_SUMMARY_LENGTH } from "../limits.js";
import { batch, job, own, setRecord, stage } from "../state.js";
import type { WorkflowCriterionEvidence, WorkflowObservationEvidence, WorkflowSuccessCriterion } from "../state-types.js";
import type { EventOf, Transition, TransitionSlice } from "../transition-table.js";
import { receiptVerificationKinds } from "../verification-coverage.js";

type CriterionEvent = EventOf<"criterion.satisfied">;

function assertObservationOptionals(evidence: WorkflowObservationEvidence): void {
  if (evidence.observedFingerprint) boundedText(evidence.observedFingerprint, "observation fingerprint", MAX_WORKFLOW_ID_LENGTH * 4);
  if (evidence.captureId !== undefined) id(evidence.captureId, "observation captureId");
  if (evidence.compositionId !== undefined) boundedText(evidence.compositionId, "observation compositionId", MAX_WORKFLOW_ID_LENGTH);
  if (evidence.time !== undefined) assert(Number.isFinite(evidence.time) && evidence.time >= 0, "INVALID_EVENT", "Observation time is invalid.");
}

const recordObservation: Transition<"observation.recorded"> = (next, event) => {
  const evidence = event.evidence;
  id(evidence.evidenceId, "observation evidenceId");
  own(job(next, event.jobId), event.jobId, "Job");
  assert(evidence.jobId === event.jobId, "WRONG_OWNER", "Observation evidence belongs to another job.");
  if (evidence.stageId) own(stage(next, evidence.stageId), event.jobId, "Stage");
  assert(!next.observations[evidence.evidenceId], "DUPLICATE_EVENT_CONFLICT", "Observation evidence identity is immutable.");
  boundedText(evidence.basis, "observation basis", MAX_WORKFLOW_SUMMARY_LENGTH);
  timestamp(evidence.recordedAt);
  assertObservationOptionals(evidence);
  assert(evidence.kind === "structural" || Boolean(evidence.observedFingerprint), "INVALID_EVENT", "Visual and temporal observations must identify the rendered snapshot they inspected.");
  next.observations = setRecord(next.observations, evidence.evidenceId, frozenCopy(evidence));
  return next;
};

function assertSameStage(event: CriterionEvent, evidenceStageId: string | undefined): void {
  if (event.scope === "stage") assert(evidenceStageId === event.stageId, "WRONG_OWNER", "Stage criteria must reference evidence from the same stage.");
}

function observationKind(next: MutableWorkflowState, event: CriterionEvent, evidenceId: string): WorkflowVerificationKind {
  const observation = next.observations[evidenceId];
  assert(observation !== undefined && observation.jobId === event.jobId, "INVALID_EVENT", "Criterion observation evidence is missing or owned by another job.");
  assertSameStage(event, observation.stageId);
  return observation.kind;
}

function batchReceiptKind(next: MutableWorkflowState, event: CriterionEvent, reference: { readonly batchId: string; readonly receiptId: string }, requiredKind: WorkflowVerificationKind | undefined): WorkflowVerificationKind {
  const evidenceBatch = own(batch(next, reference.batchId), event.jobId, "Batch");
  assertSameStage(event, evidenceBatch.stageId);
  const receipt = evidenceBatch.execution.receiptHistory.find((candidate) => candidate.receiptId === reference.receiptId && candidate.verification === "verified");
  assert(receipt !== undefined, "INVALID_EVENT", "Criterion batch evidence must reference a verified receipt.");
  if (requiredKind !== undefined) assert(receiptVerificationKinds(receipt).has(requiredKind), "INVALID_EVENT", `Criterion ${event.criterionId} requires ${requiredKind} evidence, but the referenced receipt does not carry it.`);
  return requiredKind ?? "structural";
}

function referencedKind(next: MutableWorkflowState, event: CriterionEvent, criterion: WorkflowSuccessCriterion): WorkflowVerificationKind {
  const reference = event.reference;
  const evidenceKind = reference.kind === "observation"
    ? observationKind(next, event, reference.evidenceId)
    : batchReceiptKind(next, event, reference, criterion.requiredEvidenceKind);
  if (criterion.requiredEvidenceKind !== undefined) assert(evidenceKind === criterion.requiredEvidenceKind, "INVALID_EVENT", `Criterion ${event.criterionId} requires ${criterion.requiredEvidenceKind} evidence.`);
  return evidenceKind;
}

function assertImmutable(prior: WorkflowCriterionEvidence | undefined, evidence: WorkflowCriterionEvidence): void {
  assert(!prior || signature(prior) === signature(evidence), "DUPLICATE_EVENT_CONFLICT", "Criterion satisfaction evidence is immutable.");
}

function satisfyJobCriterion(next: MutableWorkflowState, event: CriterionEvent, evidence: WorkflowCriterionEvidence): MutableWorkflowState {
  const currentJob = job(next, event.jobId);
  assert(currentJob.successCriteria.some((criterion) => criterion.criterionId === event.criterionId), "ILLEGAL_TRANSITION", `Job criterion ${event.criterionId} is not declared.`);
  assert(currentJob.status !== "cancelled" && currentJob.status !== "completed", "ILLEGAL_TRANSITION", "A cancelled or completed job cannot satisfy new criteria.");
  assertImmutable(currentJob.satisfiedCriteria[event.criterionId], evidence);
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, satisfiedCriteria: setRecord(currentJob.satisfiedCriteria, event.criterionId, evidence), updatedAt: event.at });
  return next;
}

function satisfyStageCriterion(next: MutableWorkflowState, event: CriterionEvent, evidence: WorkflowCriterionEvidence): MutableWorkflowState {
  assert(event.stageId !== undefined, "INVALID_EVENT", "A stage criterion requires a stageId.");
  const currentStage = own(stage(next, event.stageId), event.jobId, "Stage");
  assert(currentStage.successCriteria.some((criterion) => criterion.criterionId === event.criterionId), "ILLEGAL_TRANSITION", `Stage criterion ${event.criterionId} is not declared.`);
  assert(currentStage.status !== "cancelled" && currentStage.status !== "completed", "ILLEGAL_TRANSITION", "A cancelled or completed stage cannot satisfy new criteria.");
  assertImmutable(currentStage.satisfiedCriteria[event.criterionId], evidence);
  next.stages = setRecord(next.stages, event.stageId, { ...currentStage, satisfiedCriteria: setRecord(currentStage.satisfiedCriteria, event.criterionId, evidence), updatedAt: event.at });
  return next;
}

function declaredCriteria(next: MutableWorkflowState, event: CriterionEvent): readonly WorkflowSuccessCriterion[] {
  if (event.scope === "job") return job(next, event.jobId).successCriteria;
  return event.stageId ? stage(next, event.stageId).successCriteria : [];
}

const satisfyCriterion: Transition<"criterion.satisfied"> = (next, event) => {
  job(next, event.jobId);
  id(event.criterionId, "criterionId");
  const criterion = declaredCriteria(next, event).find((candidate) => candidate.criterionId === event.criterionId);
  assert(criterion !== undefined, "ILLEGAL_TRANSITION", `Criterion ${event.criterionId} is not declared.`);
  const evidenceKind = referencedKind(next, event, criterion);
  const evidence: WorkflowCriterionEvidence = {
    criterionId: event.criterionId,
    reference: event.reference,
    ...(criterion.requiredEvidenceKind ? { evidenceKind } : {}),
    satisfiedAt: event.at,
  };
  return event.scope === "job" ? satisfyJobCriterion(next, event, evidence) : satisfyStageCriterion(next, event, evidence);
};

export const CRITERIA_TRANSITIONS = {
  "observation.recorded": recordObservation,
  "criterion.satisfied": satisfyCriterion,
} satisfies TransitionSlice;
