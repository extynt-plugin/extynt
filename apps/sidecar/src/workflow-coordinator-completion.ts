// Checks a model's completion proposal against the job's recorded receipts and observations, and builds the events that complete the job.

import { decode, fallback, literal, object, string, union } from "@extynt/decode";
import {
  type WorkflowBatch, type WorkflowCompletionProposal, type WorkflowCriterionEvidence, type WorkflowEvent, type WorkflowId,
  type WorkflowJob, type WorkflowContinuationSnapshot, type WorkflowState, type WorkflowStage,
  workflowGoalDigest,
  stageBatchesConfirmed,
} from "@extynt/workflow";
import { EVENT_ID_RE, eventId } from "./workflow-coordinator-types.js";

/** A refused completion or transition, with the code and message the model is shown. */
export type CompletionFailure = { readonly ok: false; readonly code: string; readonly message: string };

/** The outcome of a completion proposal: accepted, already completed, or a failure. */
export type CompletionResult = CompletionFailure | { readonly ok: true; readonly alreadyCompleted?: boolean };

interface CompletionRequest {
  readonly state: WorkflowState;
  readonly jobId: WorkflowId;
  readonly current: WorkflowJob;
  readonly proposal: WorkflowCompletionProposal;
  readonly snapshot: WorkflowContinuationSnapshot | undefined;
}

interface CompletionPrepared {
  readonly ok: true;
  readonly ids: readonly string[];
  readonly evidence: ReadonlyMap<string, WorkflowCriterionEvidence>;
}

interface CompletionValidation {
  readonly ids: readonly string[];
  readonly declared: ReadonlySet<string>;
  readonly snapshot: WorkflowContinuationSnapshot;
}

type CompletionValidated = CompletionValidation & { readonly ok: true };

interface CitedReceipt {
  readonly evidence: WorkflowCriterionEvidence;
  readonly receiptId: string;
  readonly batchId: string;
  readonly order: readonly [number, number];
  readonly observedFingerprint: string | undefined;
}

interface EvidenceLedger {
  readonly evidenceByCriterion: Map<string, WorkflowCriterionEvidence>;
  readonly cited: CitedReceipt[];
  readonly observed: Set<string>;
}

interface EvidenceRow {
  readonly state: WorkflowState;
  readonly jobId: WorkflowId;
  readonly evidence: WorkflowCriterionEvidence;
  readonly validation: CompletionValidation;
  readonly ledger: EvidenceLedger;
}

const referenceId = string({ pattern: EVENT_ID_RE });

const evidenceRow = object({
  criterionId: string(),
  reference: fallback(union(
    object({ kind: literal("observation"), evidenceId: referenceId }),
    object({ kind: literal("batch_receipt"), batchId: referenceId, receiptId: referenceId }),
  ), undefined),
});

/** A failed result carrying `code` and `message`. */
export function completionFailure(code: string, message: string): CompletionFailure {
  return { ok: false, code, message };
}

function criteriaProblem(declared: ReadonlySet<string>, ids: readonly string[]): CompletionFailure | undefined {
  const malformed = new Set(ids).size !== ids.length || ids.some((criterionId) => !declared.has(criterionId) || !EVENT_ID_RE.test(criterionId));
  if (malformed) return completionFailure("COMPLETION_UNSUPPORTED", `Completion criteria must be unique and declared. Expected: ${[...declared].join(", ")}.`);
  if (ids.length !== declared.size || [...declared].some((criterionId) => !ids.includes(criterionId))) return completionFailure("COMPLETION_UNSATISFIED", "The completion proposal does not cover every declared criterion.");
  return undefined;
}

function completionProposalProblem(current: WorkflowJob, proposal: WorkflowCompletionProposal): string | undefined {
  if (!/^[a-f0-9]{64}$/.test(proposal.goalDigest)) return "goalDigest is missing or not 64 lowercase hex characters; copy goalDigest exactly from the sidecar continuation brief.";
  if (proposal.goalDigest !== workflowGoalDigest(current.goalSummary)) return "goalDigest does not match this job's retained original goal; copy goalDigest exactly from the sidecar continuation brief (do not recompute it).";
  if (proposal.criterionIds.length < 1 || proposal.criterionIds.length > 64) return `criterionIds must list every declared criterion (1-64 ids). Expected: ${current.successCriteria.map((criterion) => criterion.criterionId).join(", ")}.`;
  if (proposal.evidence.length > 64) return "evidence must be an array of at most 64 rows, one per declared criterion.";
  return undefined;
}

function validateCompletionInputs(request: CompletionRequest): CompletionValidated | CompletionFailure {
  const { current, proposal, snapshot } = request;
  const malformed = completionProposalProblem(current, proposal);
  if (malformed) return completionFailure("COMPLETION_UNSUPPORTED", malformed);
  if (!snapshot || snapshot.fingerprint.length === 0) return completionFailure("COMPLETION_SNAPSHOT_UNPAIRED", "Completion requires a current snapshot paired with every verified receipt it relies on.");
  const declared = new Set(current.successCriteria.map((criterion) => criterion.criterionId));
  const ids = [...proposal.criterionIds];
  return criteriaProblem(declared, ids) ?? { ok: true, ids, declared, snapshot };
}

function compareOrder(left: readonly [number, number], right: readonly [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function citedByCriterion(cited: readonly CitedReceipt[]): Map<string, CitedReceipt[]> {
  const grouped = new Map<string, CitedReceipt[]>();
  for (const row of cited) grouped.set(row.evidence.criterionId, [...(grouped.get(row.evidence.criterionId) ?? []), row]);
  return grouped;
}

function newestOf(rows: readonly CitedReceipt[]): CitedReceipt | undefined {
  return rows.reduce<CitedReceipt | undefined>((latest, candidate) => (!latest || compareOrder(candidate.order, latest.order) > 0 ? candidate : latest), undefined);
}

function newestReceiptFailure(ledger: EvidenceLedger, snapshot: WorkflowContinuationSnapshot): CompletionFailure | undefined {
  const newest = newestOf(ledger.cited);
  if (!newest) return undefined;
  if (newest.observedFingerprint !== snapshot.fingerprint) return completionFailure("COMPLETION_SNAPSHOT_UNPAIRED", `The project changed after receipt ${newest.receiptId} (batch ${newest.batchId}), the newest receipt you cited, so it cannot back completion. The newest receipt you cite must be the most recent verified batch receipt, observed at the current snapshot; earlier verified batch receipts of this job may be cited alongside it.`);
  for (const [criterionId, rows] of citedByCriterion(ledger.cited)) {
    const latest = newestOf(rows);
    if (!ledger.observed.has(criterionId) && latest) ledger.evidenceByCriterion.set(criterionId, latest.evidence);
  }
  return undefined;
}

function verifyObservationEvidence(row: EvidenceRow, evidenceId: string): CompletionFailure | undefined {
  const { state, jobId, evidence, validation, ledger } = row;
  const observation = state.observations[evidenceId];
  const criterion = state.jobs[jobId]?.successCriteria.find((candidate) => candidate.criterionId === evidence.criterionId);
  const matches = observation !== undefined && observation.jobId === jobId && !(criterion?.requiredEvidenceKind && observation.kind !== criterion.requiredEvidenceKind);
  if (!matches) return completionFailure("COMPLETION_UNSATISFIED", "Completion evidence does not point to a matching typed observation in this job.");
  if (observation.observedFingerprint !== validation.snapshot.fingerprint) return completionFailure("COMPLETION_SNAPSHOT_UNPAIRED", "The current snapshot changed after the recorded observation; capture and inspect the current state before completing. Only an observation taken at the current snapshot can back completion.");
  ledger.evidenceByCriterion.set(evidence.criterionId, evidence);
  ledger.observed.add(evidence.criterionId);
  return undefined;
}

function verifiedEvidenceBatch(batch: WorkflowBatch, jobId: WorkflowId): boolean {
  return batch.jobId === jobId && batch.lifecycle === "settled" && batch.verification.state === "verified" && batch.recovery.state !== "undone" && batch.recovery.state !== "undo_unverified";
}

function verifiedReceiptOf(state: WorkflowState, jobId: WorkflowId, batchId: string, receiptId: string) {
  const batch = state.batches[batchId];
  const receipt = batch?.execution.receiptHistory.find((candidate) => candidate.receiptId === receiptId && candidate.verification === "verified");
  return batch && receipt && verifiedEvidenceBatch(batch, jobId) ? { batch, receipt } : undefined;
}

function verifyReceiptEvidence(row: EvidenceRow, reference: { readonly batchId: string; readonly receiptId: string }): CompletionFailure | undefined {
  const { state, jobId, evidence, ledger } = row;
  const found = verifiedReceiptOf(state, jobId, reference.batchId, reference.receiptId);
  if (!found) return completionFailure("COMPLETION_UNSATISFIED", `Completion evidence does not point to a verified receipt in this job: receipt ${reference.receiptId} (batch ${reference.batchId}) is unknown, belongs to another job, was not verified, or was undone. Cite only verified, not undone batch receipts of this job.`);
  if (ledger.cited.some((cited) => cited.evidence.criterionId === evidence.criterionId && cited.receiptId === reference.receiptId)) return undefined;
  const batchIndex = state.jobs[jobId]?.batchIds.indexOf(reference.batchId) ?? -1;
  const order: readonly [number, number] = [batchIndex, found.batch.execution.receiptHistory.indexOf(found.receipt)];
  ledger.cited.push({ evidence, receiptId: reference.receiptId, batchId: reference.batchId, order, observedFingerprint: found.receipt.observedFingerprint });
  ledger.evidenceByCriterion.set(evidence.criterionId, evidence);
  return undefined;
}

function verifyCompletionEvidenceRow(row: EvidenceRow): CompletionFailure | undefined {
  const { evidence, validation } = row;
  const read = decode(evidenceRow, evidence);
  if (!read.ok || !validation.declared.has(read.value.criterionId)) return completionFailure("COMPLETION_UNSUPPORTED", `Completion evidence rows must name a declared criterion; ${read.ok ? read.value.criterionId : "a row"} is undeclared. Expected: ${[...validation.declared].join(", ")}.`);
  const reference = read.value.reference;
  if (reference?.kind === "observation") return verifyObservationEvidence(row, reference.evidenceId);
  if (reference?.kind === "batch_receipt") return verifyReceiptEvidence(row, reference);
  return completionFailure("COMPLETION_UNSUPPORTED", "evidence.reference must be {kind:\"batch_receipt\", batchId, receiptId} or {kind:\"observation\", evidenceId} using ids from the sidecar brief.");
}

function verifyCompletionEvidence(request: CompletionRequest, validation: CompletionValidation): ReadonlyMap<string, WorkflowCriterionEvidence> | CompletionFailure {
  const ledger: EvidenceLedger = { evidenceByCriterion: new Map(), cited: [], observed: new Set() };
  for (const evidence of request.proposal.evidence) {
    const failure = verifyCompletionEvidenceRow({ state: request.state, jobId: request.jobId, evidence, validation, ledger });
    if (failure) return failure;
  }
  const failure = newestReceiptFailure(ledger, validation.snapshot);
  if (failure) return failure;
  return ledger.evidenceByCriterion.size === validation.declared.size ? ledger.evidenceByCriterion : completionFailure("COMPLETION_UNSATISFIED", "Every declared criterion requires verified structured evidence.");
}

function completionStateReady(state: WorkflowState, current: WorkflowJob): CompletionFailure | null {
  if (current.stageIds.some((stageId) => state.stages[stageId]?.status !== "completed")) return completionFailure("COMPLETION_UNSATISFIED", "Every workflow stage must complete before the job can complete.");
  if (state.activeDispatchLease?.jobId === current.jobId) return completionFailure("COMPLETION_BLOCKED", "The host dispatch lane is still active.");
  return null;
}

/** The events that mark each criterion satisfied and the job completed. */
export function completionEvents(jobId: WorkflowId, prepared: CompletionPrepared, at: string): WorkflowEvent[] {
  const events: WorkflowEvent[] = prepared.ids.map((criterionId) => {
    const criterionEvidence = prepared.evidence.get(criterionId);
    if (!criterionEvidence) throw new Error(`completion evidence for ${criterionId} is missing`);
    return { eventId: eventId("criterion.satisfied", `${jobId}:${criterionId}`), at, type: "criterion.satisfied", jobId, scope: "job", criterionId, reference: criterionEvidence.reference };
  });
  events.push({ eventId: eventId("job.completed", jobId), at, type: "job.completed", jobId });
  return events;
}

/** Validates the proposal, its evidence and the job's state, returning the criteria and evidence to record or the refusal. */
export function completionPreparation(request: CompletionRequest): CompletionPrepared | CompletionFailure {
  const validation = validateCompletionInputs(request);
  if (!validation.ok) return validation;
  const evidence = verifyCompletionEvidence(request, validation);
  if ("ok" in evidence) return evidence;
  return completionStateReady(request.state, request.current) ?? { ok: true, ids: validation.ids, evidence };
}

/** Whether every batch of the stage is settled and confirmed, so the stage may complete before the next one opens. */
export function stageReadyForContinuation(state: WorkflowState, currentStage: WorkflowStage): boolean {
  const batches = currentStage.batchIds.map((batchId) => state.batches[batchId]);
  const visuallyObserved = (candidate: WorkflowBatch): boolean => candidate.verification.observedFingerprint !== null && Object.values(state.observations).some((evidence) => evidence.stageId === currentStage.stageId && evidence.kind === "visual" && evidence.observedFingerprint === candidate.verification.observedFingerprint);
  return stageBatchesConfirmed(batches, visuallyObserved, state.operations);
}
