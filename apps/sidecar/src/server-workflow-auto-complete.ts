// The sidecar's own completion: which of the job's features the project shows, what evidence its criteria lack, and a proposal citing receipts and observations.
import { receiptVerificationKinds, workflowGoalDigest, type WorkflowCompletionProposal, type WorkflowId, type WorkflowState } from "@extynt/workflow";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { primeRequestMissing } from "./decision-prime.js";
import { coverageRefusal, missingFeatures } from "./request-coverage.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { filmRefusal } from "./server-workflow-film-gate.js";
import { frameRefusal } from "./server-workflow-frame-gate.js";

type Evidence = WorkflowCompletionProposal["evidence"][number];
type Observation = WorkflowState["observations"][string];
type FrameKind = "visual" | "temporal";
interface Criterion { readonly criterionId: string; readonly requiredEvidenceKind?: string | undefined }
interface ReceiptRef { readonly batchId: string; readonly receiptId: string }
interface HeldEvidence { readonly current: readonly Observation[]; readonly receipt: ReceiptRef | undefined; readonly receiptPaired: boolean }
interface CitationContext { readonly state: WorkflowState; readonly held: HeldEvidence; readonly satisfiedAt: string }

interface CoverageDeps {
  readonly state: Pick<SidecarState, "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
}

/** What completing a job needs: coverage reads, the clock, the plan store and the sidecar action log. */
export interface OwnCompletionDeps {
  readonly state: Pick<SidecarState, "workflowCoordinator" | "now" | "plans"> & Partial<Pick<SidecarState, "workflowSidecarActions" | "options">>;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
}

/** The sidecar's completion verdict: done, or a refusal code and the words the model acts on. */
export type OwnCompletion = { ok: true } | { ok: false; code: string; message: string };

const FRAME_ANSWERABLE: ReadonlySet<string> = new Set(["COMPLETION_SNAPSHOT_UNPAIRED", "COMPLETION_UNSATISFIED"]);
const NOTHING_HELD: HeldEvidence = { current: [], receipt: undefined, receiptPaired: false };

function undone(state: WorkflowState, batchId: string): boolean {
  const recovery = state.batches[batchId]?.recovery.state;
  return recovery === "undone" || recovery === "undo_unverified";
}

function verifiedReceiptOf(state: WorkflowState, batchId: string): ReceiptRef | undefined {
  const batch = state.batches[batchId];
  if (batch?.lifecycle !== "settled" || batch.verification.state !== "verified" || undone(state, batchId)) return undefined;
  const receipt = [...batch.execution.receiptHistory].reverse().find((candidate) => candidate.verification === "verified");
  return receipt ? { batchId, receiptId: receipt.receiptId } : undefined;
}

function newestVerifiedReceipt(state: WorkflowState, jobId: WorkflowId): ReceiptRef | undefined {
  const batchIds = [...(state.jobs[jobId]?.batchIds ?? [])].reverse();
  return batchIds.map((batchId) => verifiedReceiptOf(state, batchId)).find((ref) => ref !== undefined);
}

function receiptPaired(state: WorkflowState, receipt: ReceiptRef | undefined, fingerprint: string): boolean {
  return !!receipt && state.batches[receipt.batchId]?.execution.receiptHistory.find((row) => row.receiptId === receipt.receiptId)?.observedFingerprint === fingerprint;
}

function heldEvidence(state: WorkflowState, jobId: WorkflowId, fingerprint: string): HeldEvidence {
  const receipt = newestVerifiedReceipt(state, jobId);
  return { current: Object.values(state.observations).filter((row) => row.jobId === jobId && row.observedFingerprint === fingerprint), receipt, receiptPaired: receiptPaired(state, receipt, fingerprint) };
}

const seconds = (time: number | undefined): string => `${Math.round((time ?? 0) * 100) / 100} s`;

function observedFrames(current: readonly Observation[]): string {
  const frames = current.filter((row) => row.kind === "visual" && row.time !== undefined);
  return frames.length ? ` Frames observed at the current project: ${frames.map((row) => `${row.compositionId ?? "?"} at ${seconds(row.time)}`).join(", ")}.` : "";
}

function temporalGap(current: readonly Observation[]): string {
  const times = new Set(current.filter((row) => row.kind === "visual" && row.time !== undefined).map((row) => row.time));
  if (times.size < 2) return `needs a temporal observation: two frames of the current project at different times that measurably differ, and ${times.size ? "only one time has been observed" : "none has been observed yet"}.${observedFrames(current)} Capture the composition before the motion and after it and check both with ae_observe_frame`;
  return `needs a temporal observation, and the frames observed at the current project measured the same picture at every time, so they do not show the motion.${observedFrames(current)} Capture times where the animation visibly differs (before its first keyframe and after its last) and check them with ae_observe_frame, or make sure the motion is really keyed`;
}

function receiptNote(held: HeldEvidence): string {
  return held.receipt && !held.receiptPaired ? ` The newest verified receipt (batch ${held.receipt.batchId}) was read before the project last changed, so it cannot stand in.` : "";
}

function evidenceGap(kind: string, held: HeldEvidence): string {
  if (kind === "verified receipt") return "needs a verified batch receipt taken at the current project, and there is none yet. Seal the queued work with ae_queue_finish";
  if (kind === "temporal") return temporalGap(held.current);
  return `needs a ${kind} observation taken at the current project, and there is none yet.${observedFrames(held.current)} Capture one frame with ae_capture_composition_frame and check it with ae_observe_frame`;
}

function missingEvidence(criterion: Criterion, held: HeldEvidence = NOTHING_HELD): OwnCompletion {
  const gap = evidenceGap(criterion.requiredEvidenceKind ?? "verified receipt", held);
  return { ok: false, code: "COMPLETION_EVIDENCE_MISSING", message: `Criterion ${criterion.criterionId} ${gap}, then call ae_workflow_complete again with no arguments.${receiptNote(held)}` };
}

function receiptCarries(state: WorkflowState, receipt: ReceiptRef, kind: string | undefined): boolean {
  if (kind === undefined) return true;
  const row = state.batches[receipt.batchId]?.execution.receiptHistory.find((candidate) => candidate.receiptId === receipt.receiptId);
  return !!row && [...receiptVerificationKinds(row)].some((carried) => carried === kind);
}

function evidenceFor(criterion: Criterion, context: CitationContext): Evidence | undefined {
  const { current, receipt } = context.held;
  const { criterionId } = criterion;
  const observed = current.find((row) => row.kind === criterion.requiredEvidenceKind) ?? (receipt || criterion.requiredEvidenceKind !== undefined ? undefined : current[0]);
  if (observed) return { criterionId, reference: { kind: "observation", evidenceId: observed.evidenceId }, satisfiedAt: context.satisfiedAt };
  if (!receipt || !receiptCarries(context.state, receipt, criterion.requiredEvidenceKind)) return undefined;
  return { criterionId, reference: { kind: "batch_receipt", batchId: receipt.batchId, receiptId: receipt.receiptId }, satisfiedAt: context.satisfiedAt };
}

function citedEvidence(criteria: readonly Criterion[], context: CitationContext): Evidence[] | OwnCompletion {
  const evidence: Evidence[] = [];
  for (const criterion of criteria) {
    const row = evidenceFor(criterion, context);
    if (!row) return missingEvidence(criterion, context.held);
    evidence.push(row);
  }
  return evidence;
}

function lackingCriterion(job: WorkflowState["jobs"][string], held: HeldEvidence, code: string): Criterion | undefined {
  if (!FRAME_ANSWERABLE.has(code)) return undefined;
  return job?.successCriteria.find((criterion) => criterion.requiredEvidenceKind !== undefined && !held.current.some((row) => row.kind === criterion.requiredEvidenceKind));
}

/** The operations of the job that reached After Effects: the proof for features the snapshot does not read back. */
export function appliedOperations(state: WorkflowState, jobId: WorkflowId): Array<{ type: string; payload: ActionPlanV2Operation; batchId: string }> {
  const batchIds = new Set(state.jobs[jobId]?.batchIds ?? []);
  return Object.values(state.operations).filter((operation) => batchIds.has(operation.batchId) && (operation.status === "executed" || operation.status === "verified")).map((operation) => ({ type: operation.type, payload: operation.payload, batchId: operation.batchId }));
}

/** The request's named features still missing from the project, when completion must be refused for them now. */
export function jobCoverageRefusal(deps: CoverageDeps, jobId: WorkflowId): string[] | null {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const job = state.jobs[jobId], latest = deps.planState.normalizedLatest();
  if (!job || !latest) return null;
  return coverageRefusal(jobId, job.goalSummary, latest, appliedOperations(state, jobId));
}

/** Asks the decision models, once for the operations executed so far, which of the request's features are still missing; the coverage checks then read the answer. */
export async function primeJobCoverage(deps: { readonly state: Pick<SidecarState, "workflowCoordinator" | "decisions"> }, jobId: WorkflowId): Promise<void> {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const job = state.jobs[jobId];
  if (job) await primeRequestMissing(deps.state.decisions, job.goalSummary, appliedOperations(state, jobId), jobId);
}

/** Whether the project already shows every feature the request names, read without counting a refusal against the job. */
export function jobCovered(deps: CoverageDeps, jobId: WorkflowId): boolean {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const job = state.jobs[jobId], latest = deps.planState.normalizedLatest();
  return !!job && !!latest && missingFeatures(job.goalSummary, latest, appliedOperations(state, jobId)).length === 0;
}

/** The frame kinds (visual, temporal) the job's criteria have no observation of at the current project. Asked only after a refusal for missing evidence, so a receipt that could stand in has already been tried. */
export function lackingFrameKinds(deps: OwnCompletionDeps, jobId: WorkflowId): FrameKind[] {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const job = state.jobs[jobId], latest = deps.planState.normalizedLatest();
  if (!job || !latest) return [];
  const held = heldEvidence(state, jobId, latest.fingerprint);
  const kinds = job.successCriteria.map((criterion) => criterion.requiredEvidenceKind).filter((kind): kind is FrameKind => kind === "visual" || kind === "temporal");
  return [...new Set(kinds)].filter((kind) => !held.current.some((row) => row.kind === kind));
}

/** The sidecar's own completion proposal: every declared criterion cited to the newest verified receipt, or to an observation taken at the current snapshot. A job built only from applied-but-unread batches closes on its observations alone; the engine still checks each batch was observed. */
export function ownCompletion(deps: OwnCompletionDeps, jobId: WorkflowId): OwnCompletion {
  const coordinator = deps.state.workflowCoordinator;
  const state = coordinator.workflowStore.getState();
  const job = state.jobs[jobId];
  const latest = deps.planState.normalizedLatest();
  if (!job || !latest) return { ok: false, code: "COMPLETION_UNSUPPORTED", message: "No open workflow job or project state to complete against." };
  const offFrame = frameRefusal(deps, jobId) ?? filmRefusal(deps, jobId);
  if (offFrame) return { ok: false, ...offFrame };
  const held = heldEvidence(state, jobId, latest.fingerprint);
  const evidence = citedEvidence(job.successCriteria, { state, held, satisfiedAt: deps.state.now().toISOString() });
  if (!Array.isArray(evidence)) return evidence;
  const proposal = { goalDigest: workflowGoalDigest(job.goalSummary), criterionIds: job.successCriteria.map((criterion) => criterion.criterionId), evidence };
  const result = coordinator.proposeCompletion(jobId, proposal, { fingerprint: latest.fingerprint, revision: latest.revision });
  if (result.ok) return { ok: true };
  const lacking = lackingCriterion(job, held, result.code);
  return lacking ? missingEvidence(lacking, held) : { ok: false, code: result.code, message: result.message };
}

/** Completion from receipts, unless the request still names features the project does not show. */
export function completeCoveredJob(deps: OwnCompletionDeps, jobId: WorkflowId): boolean {
  return !jobCoverageRefusal(deps, jobId) && ownCompletion(deps, jobId).ok;
}
