// What the model reads after a sealed batch settles: the compact receipt, the stale-refusal hand-back, the frame check and the decision to keep the turn going.
import { array, decode, decodeOrThrow, type Decoder, fallback, type JsonObject, jsonValue, map, number, object, optional, skippingInvalid, string } from "@extynt/decode";
import { planOperations, readbackRepairText, receiptJson, rolledBackCorrection, type ReadbackMismatch, type StoredPlan, type StoredReceipt } from "@extynt/mcp-server";
import { MAX_WORKFLOW_AUTOMATIC_REPAIRS, readbackRepaired, type WorkflowBatch, type WorkflowReceipt } from "@extynt/workflow";
import { appliedCreatedBindings } from "./server-contracts.js";
import type { ChatAgentDeps, ChatAgentInput } from "./server-chat-agent-types.js";
import { AUTHORING_MS_CEILING, boundedElapsedMs, remainingWaitSeconds } from "./server-durations.js";
import { captureAndObserve, namedComposition, type FrameTarget, type RunTool } from "./server-workflow-completion-evidence.js";
import { heldAwaitsFrame } from "./server-workflow-design-release.js";
import type { ToolData } from "./server-mcp-result.js";
import { isDataFields } from "./server-mcp-data.js";
import type { SealedData } from "./server-workflow-admission.js";
import { WORKFLOW_OWNER } from "./workflow-orchestration.js";

const PAIRING_WAIT_SECONDS = 3;

const STALE_REFUSAL_CODES = new Set(["STALE_SNAPSHOT", "SELECTION_CHANGED"]);

/**
 * How many times in a row one job may hand a never-run refusal back to the model before it blocks. Any host refusal of a batch
 * that provably never ran is repairable: nothing changed, and the host's message names what to send instead (a stale
 * read, or an operation this session cannot run, such as Layer Styles before AE 26 has built their commands).
 */
export const MAX_STALE_REFUSAL_RETRIES = 2;

const SIZE_REFUSALS = new Set(["LIMIT_EXCEEDED", "HOST_TIME_BUDGET"]);

const FRAME_CHECK_NEEDED = "After Effects applied this batch, but the read-back cannot prove the drawn artwork. The sidecar could not capture a frame for it just now. Do not queue it again. The completion check takes the frames it needs itself, so capture with ae_capture_composition_frame and ae_observe_frame only if you want to judge the picture yourself.";

const FRAME_MEASURED = "After Effects applied this batch. The sidecar captured a frame of the built scene and measured it (frame), so no capture of your own is needed. Check the measurement against the design: if it disagrees, queue only the correction; if it agrees, queue the next batch if the request is not fully built, or call ae_workflow_complete if it is (it takes any further frame it needs itself). Do not queue this batch again.";

const READBACK_PROVES = "The host read-back already proves what this batch did: it covers every kind of evidence this job requires, so no frame capture or observation is needed to check it. Queue the next batch if the request is not fully built, or call ae_workflow_complete if it is.";

const NO_MESSAGE = "After Effects refused the batch, so nothing was run.";

const hostFailure = object({ hostError: optional(fallback(object({ code: optional(fallback(string(), undefined)), message: optional(fallback(string(), undefined)) }), undefined)) });
const effectControls = object({ effectControls: optional(fallback(array(jsonValue), undefined)) });
const frameTargetField = object({ frameTarget: object({ compositionId: string(), time: number() }) });
const placement = object({ inPoint: optional(fallback(number(), undefined)), startTime: optional(fallback(number(), undefined)) });

interface StaleRefusal { readonly code: string; readonly message: string; readonly correction?: string }

interface NeverRanBatch { readonly lifecycle: string; readonly execution: { readonly state: string; readonly mutation: string; readonly mayHaveMutated: boolean } }

/** How long the seal may wait for the panel's receipt: the seconds allowed and when the wait began. */
export interface SealWait { readonly seconds: number; readonly startedAt: number }

type CompactOperation = { type: string; outcome: string; layerId?: string; expected?: string; observed?: string };

interface BatchRef { readonly jobId: string; readonly batch: WorkflowBatch }

interface QueuedSeal { readonly queued: boolean; readonly planId?: string; readonly refusal?: { readonly code: string; readonly message: string } }

type ReceiptOutcome = WorkflowReceipt["outcomes"][number];

function mismatchValues(outcome: ReceiptOutcome): { expected?: string; observed?: string } {
  if (outcome.outcome !== "readback_mismatch") return {};
  const { expected, observed } = outcome.readback ?? {};
  return { ...(expected === undefined ? {} : { expected }), ...(observed === undefined ? {} : { observed }) };
}

function compactOperation(outcome: ReceiptOutcome): CompactOperation {
  return { type: outcome.type, outcome: outcome.outcome, ...(outcome.readback?.targetLayerId ? { layerId: outcome.readback.targetLayerId } : {}), ...mismatchValues(outcome) };
}

function compactOperations(receipt: WorkflowReceipt): CompactOperation[] {
  return receipt.outcomes.map(compactOperation);
}

function mismatchesOf(receipt: WorkflowReceipt): ReadbackMismatch[] {
  return receipt.outcomes.flatMap((outcome, index): ReadbackMismatch[] => outcome.outcome === "readback_mismatch" ? [mismatchOf(outcome, index)] : []);
}

function mismatchOf(outcome: WorkflowReceipt["outcomes"][number], index: number): ReadbackMismatch {
  const { readback } = outcome;
  const where = readback?.targetLayerId ? { where: `layer ${readback.targetLayerId}` } : {};
  const basis = outcome.basis === undefined ? {} : { basis: outcome.basis };
  return { index, type: outcome.type, ...where, ...basis, ...valuesOf(readback) };
}

function valuesOf(readback: { readonly expected?: ReadbackMismatch["expected"]; readonly observed?: ReadbackMismatch["observed"] } | undefined): Pick<ReadbackMismatch, "expected" | "observed"> {
  const expected = readback?.expected === undefined ? {} : { expected: readback.expected };
  const observed = readback?.observed === undefined ? {} : { observed: readback.observed };
  return { ...expected, ...observed };
}

function appliedUnverified(batch: WorkflowBatch): boolean {
  return batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "applied_unverified";
}

function canonicalBindings(batch: WorkflowBatch, record: StoredPlan | undefined): Map<string, string> {
  const canonical = new Map((batch.execution.receipt?.createdBindings ?? []).map((binding) => [binding.placeholder, binding.createdId]));
  if (!canonical.size && record && appliedUnverified(batch)) for (const [placeholder, id] of Object.entries(appliedCreatedBindings(record))) canonical.set(placeholder, id);
  return canonical;
}

/**
 * The real ids this batch's applied creations got, keyed by the name the model wrote ("__new__:title") or, for a creation it left
 * unnamed, the canonical placeholder. A batch applied but not fully proved still binds the ids its creating steps were read back with.
 */
export function createdMapOf(batch: WorkflowBatch, record?: StoredPlan): Record<string, string> {
  const canonical = canonicalBindings(batch, record);
  const aliases = Object.entries(record?.placeholderBindings ?? {}).flatMap(([name, target]) => {
    const id = canonical.get(target);
    return name !== target && id !== undefined ? [{ name, target, id }] : [];
  });
  const aliased = new Set(aliases.map((alias) => alias.target));
  const direct: ReadonlyArray<readonly [string, string]> = [...canonical].filter(([placeholder]) => !aliased.has(placeholder));
  const named: ReadonlyArray<readonly [string, string]> = aliases.map((alias) => [alias.name, alias.id]);
  return Object.fromEntries([...direct, ...named]);
}

function compactReceipt(batch: WorkflowBatch, record?: StoredPlan): JsonObject | undefined {
  const receipt = batch.execution.receipt;
  if (!receipt) return undefined;
  const operations = compactOperations(receipt);
  const mismatched = operations.filter((operation) => operation.outcome === "readback_mismatch");
  const repair = readbackRepairText(operations.length, mismatchesOf(receipt));
  return {
    verification: batch.verification.state,
    readback: mismatched.length ? "mismatch" : "matched",
    operations,
    created: createdMapOf(batch, record),
    ...(repair ? { repair } : {}),
  };
}

function hostErrorOf(receipt: StoredReceipt | undefined): { code?: string | undefined; message?: string | undefined } | undefined {
  const failure = decode(hostFailure, receipt);
  return failure.ok ? failure.value.hostError : undefined;
}

function neverRan(batch: NeverRanBatch): boolean {
  return batch.lifecycle === "settled" && batch.execution.state === "rejected_before_apply" && batch.execution.mutation === "none" && !batch.execution.mayHaveMutated;
}

/** The host's refusal of a batch that provably never ran (or ran, failed and was proven rolled back), or undefined for any other outcome. `correction` is the precise message for a rollback. */
export function staleRefusalOf(deps: { state: Pick<ChatAgentDeps["state"], "plans"> }, planId: string, batch: WorkflowBatch): StaleRefusal | undefined {
  const receipt = deps.state.plans.get(planId)?.receipt;
  const hostError = hostErrorOf(receipt);
  if (!neverRan(batch) || hostError?.code === undefined) return undefined;
  const correction = rolledBackCorrection(receiptJson(receipt) ?? {});
  return { code: hostError.code, message: hostError.message ?? NO_MESSAGE, ...(correction ? { correction } : {}) };
}

/** The never-run refusals in a row at the end of this job's batches, derived from its batches so the persisted job format is untouched. A batch that ran resets the count: two transient refusals hours apart never add up. */
export function neverRanIn(state: { jobs: Record<string, { batchIds: readonly string[] } | undefined>; batches: Record<string, NeverRanBatch | undefined> }, jobId: string): number {
  let run = 0;
  for (const id of [...(state.jobs[jobId]?.batchIds ?? [])].reverse()) {
    const batch = state.batches[id];
    if (!batch || batch.lifecycle !== "settled") continue;
    if (!neverRan(batch)) break;
    run += 1;
  }
  return run;
}

function staleReceipt(refusal: StaleRefusal): JsonObject {
  if (refusal.correction) return { verification: "not_requested", refusedBeforeApply: true, rolledBack: true, hostError: refusal.code, correction: refusal.correction, retry: "Queue the corrected batch with ae_queue_add and ae_queue_finish." };
  return {
    verification: "not_requested",
    refusedBeforeApply: true,
    hostError: refusal.code,
    hostMessage: refusal.message,
    retry: STALE_REFUSAL_CODES.has(refusal.code)
      ? "After Effects refused this batch before running anything, so nothing changed. The project moved since your last read: re-read the current state (ae_refresh_snapshot or an inspect call), then queue the batch again with ae_queue_add and ae_queue_finish against what is there now."
      : "After Effects refused this batch before running anything, so nothing changed. Queue the batch again with ae_queue_add and ae_queue_finish, changing what hostMessage names and keeping every other operation as it was.",
  };
}

function reopenStale(deps: ChatAgentDeps, { jobId, batch }: BatchRef): boolean {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  if (neverRanIn(state, jobId) > MAX_STALE_REFUSAL_RETRIES) return false;
  try { deps.state.workflowCoordinator.reopenForRepair(jobId, batch.batchId); return true; }
  catch { return false; }
}

function handBackStale(deps: ChatAgentDeps, ref: BatchRef, stale: StaleRefusal, data: SealedData): boolean {
  const reopened = reopenStale(deps, ref);
  if (reopened) data.receipt = staleReceipt(stale);
  return reopened;
}

function jobHasMismatch(batch: WorkflowBatch): boolean {
  return batch.execution.state === "executed" && batch.verification.state === "failed" && batch.execution.mutation === "applied" && (batch.execution.receipt?.outcomes.some((outcome) => outcome.outcome === "readback_mismatch") ?? false);
}

async function pairedAfterWait(deps: ChatAgentDeps, ref: BatchRef, signal: AbortSignal | undefined, kind: "verified" | "observation"): Promise<boolean> {
  const { jobId, batch } = ref;
  const paired = () => (kind === "verified" ? deps.planState.pairedWorkflowSnapshot(jobId, batch.batchId) : deps.planState.pairedWorkflowRepairSnapshot(jobId, batch.batchId)).ok;
  return paired() || (await deps.transport.waitUntil(paired, PAIRING_WAIT_SECONDS, signal) && paired());
}

/**
 * The text that repairs the job's earliest read-back mismatch that no later verified batch has answered on the same target, or undefined when
 * every mismatch is answered. `later` counts the batches since, so a model that keeps queueing unrelated work is not carried on forever.
 */
export function outstandingMismatch(deps: { state: Pick<ChatAgentDeps["state"], "workflowCoordinator"> }, jobId: string): { text: string; later: number; batchId: string } | undefined {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const batches = (state.jobs[jobId]?.batchIds ?? []).map((id) => state.batches[id]);
  const index = batches.findIndex((batch, position) => !!batch && jobHasMismatch(batch) && !readbackRepaired(batches, position, state.operations));
  const batch = batches[index];
  const receipt = batch?.execution.receipt;
  const text = receipt ? readbackRepairText(receipt.outcomes.length, mismatchesOf(receipt)) : undefined;
  return batch && text ? { text, later: batches.length - index - 1, batchId: batch.batchId } : undefined;
}

function settleVerified(deps: ChatAgentDeps, jobId: string): boolean {
  try { deps.state.workflowCoordinator.completeStageForContinuation(jobId); return true; }
  catch { return false; }
}

function reopenMismatch(deps: ChatAgentDeps, { jobId, batch }: BatchRef): boolean {
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  if (!job || job.automaticRepairReopens >= MAX_WORKFLOW_AUTOMATIC_REPAIRS) return false;
  try { deps.state.workflowCoordinator.reopenForRepair(jobId, batch.batchId); return true; }
  catch { return false; }
}

function reopenForFrame(deps: ChatAgentDeps, { jobId, batch }: BatchRef): boolean {
  try { deps.state.workflowCoordinator.reopenForObservation(jobId, batch.batchId); return true; }
  catch { return false; }
}

async function verifiedProceeds(deps: ChatAgentDeps, ref: BatchRef, signal: AbortSignal | undefined): Promise<boolean> {
  if (ref.batch.verification.state !== "verified" || !await pairedAfterWait(deps, ref, signal, "verified")) return false;
  return settleVerified(deps, ref.jobId) || (outstandingMismatch(deps, ref.jobId)?.later ?? Infinity) <= MAX_WORKFLOW_AUTOMATIC_REPAIRS;
}

async function settledProceeds(deps: ChatAgentDeps, ref: BatchRef, signal: AbortSignal | undefined): Promise<boolean> {
  if (jobHasMismatch(ref.batch)) return reopenMismatch(deps, ref);
  if (appliedUnverified(ref.batch)) return await pairedAfterWait(deps, ref, signal, "observation") && reopenForFrame(deps, ref);
  return await verifiedProceeds(deps, ref, signal);
}

const placementTimes: Decoder<number[]> = map(skippingInvalid(placement), (found) => found.flatMap((entry) => [entry.inPoint, entry.startTime]).filter((time): time is number => time !== undefined && Number.isFinite(time) && time >= 0));

function builtCompositionId(batch: WorkflowBatch, named: string): string | undefined {
  const created = (batch.execution.receipt?.createdBindings ?? []).find((binding) => binding.placeholder === named)?.createdId;
  const compositionId = created ?? named;
  return compositionId.startsWith("__new__:") ? undefined : compositionId;
}

function frameTargetOf(deps: ChatAgentDeps, planId: string, batch: WorkflowBatch): FrameTarget | undefined {
  const plan = deps.state.plans.get(planId);
  const operations = plan ? planOperations(plan) : [];
  const named = operations.map(namedComposition).find((id): id is string => id !== undefined);
  if (!named) return undefined;
  const compositionId = builtCompositionId(batch, named);
  if (!compositionId) return undefined;
  const starts = decodeOrThrow(placementTimes, operations);
  return { compositionId, time: starts.length ? Math.max(...starts) : 0 };
}

function withFrameTarget(target: FrameTarget | undefined): JsonObject {
  return target ? { frameTarget: { compositionId: target.compositionId, time: target.time } } : {};
}

/** A batch whose drawing only a frame can prove gets that frame measured here, before the model reads its receipt, so the check costs no extra model call. Without a measurement the receipt keeps asking the model to take one. */
export async function measureSettledFrame(result: { readonly ok: boolean; readonly data?: ToolData }, run: RunTool): Promise<boolean> {
  if (!("continuesLoop" in result) || !isDataFields(result.data)) return false;
  const receipt = result.data.receipt;
  if (!isDataFields(receipt)) return false;
  const decoded = decode(frameTargetField, receipt);
  if (!decoded.ok) return false;
  const target = decoded.value.frameTarget;
  delete receipt.frameTarget;
  const measured = await captureAndObserve(run, target);
  if (!measured) return false;
  receipt.frame = { time: target.time, ...measured };
  receipt.frameCheck = FRAME_MEASURED;
  return true;
}

function evidenceKinds(batch: WorkflowBatch): Set<string> {
  return new Set((batch.execution.receipt?.hostEvidence ?? []).map((evidence) => evidence.kind));
}

function readbackProvesJob(deps: ChatAgentDeps, { jobId, batch }: BatchRef): boolean {
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  const kinds = evidenceKinds(batch);
  return !!job && job.successCriteria.every((criterion) => !criterion.requiredEvidenceKind || kinds.has(criterion.requiredEvidenceKind));
}

function frameProvesJob(deps: ChatAgentDeps, { jobId, batch }: BatchRef): boolean {
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  return !!job && job.successCriteria.some((criterion) => criterion.requiredEvidenceKind === "visual") && !evidenceKinds(batch).has("visual");
}

function singleLoopOwner(deps: ChatAgentDeps, input: ChatAgentInput): boolean {
  return deps.state.options.workflowSingleLoop !== false && input.workflowRole === WORKFLOW_OWNER;
}

function withEffectControls(deps: ChatAgentDeps, planId: string, compact: JsonObject): JsonObject {
  const decoded = decode(effectControls, deps.state.plans.get(planId)?.receipt);
  const controls = decoded.ok ? decoded.value.effectControls : undefined;
  return controls?.length ? { ...compact, effectControls: [...controls] } : compact;
}

function withOutstandingRepair(deps: ChatAgentDeps, { jobId, batch }: BatchRef, receipt: JsonObject): JsonObject {
  const outstanding = batch.verification.state === "verified" ? outstandingMismatch(deps, jobId) : undefined;
  return outstanding ? { ...receipt, repair: outstanding.text } : receipt;
}

function continuingReceipt(deps: ChatAgentDeps, ref: BatchRef, planId: string, compact: JsonObject): JsonObject {
  if (appliedUnverified(ref.batch) || frameProvesJob(deps, ref)) return { ...compact, frameCheck: FRAME_CHECK_NEEDED, ...withFrameTarget(frameTargetOf(deps, planId, ref.batch)) };
  if (heldAwaitsFrame(deps, ref.jobId)) return { ...compact, ...withFrameTarget(frameTargetOf(deps, planId, ref.batch)) };
  return readbackProvesJob(deps, ref) ? { ...compact, proved: READBACK_PROVES } : compact;
}

function settledBatchFor(deps: ChatAgentDeps, input: ChatAgentInput, planId: string): BatchRef | undefined {
  const coordinator = deps.state.workflowCoordinator;
  if (!input.workflowJobId || !singleLoopOwner(deps, input)) return undefined;
  const batch = coordinator.batchForPlan(planId);
  return batch?.lifecycle === "settled" ? { jobId: coordinator.jobIdForSeed(input.workflowJobId), batch } : undefined;
}

async function continueAfterSeal(deps: ChatAgentDeps, input: ChatAgentInput, data: SealedData | undefined, planId: string): Promise<boolean> {
  const ref = data ? settledBatchFor(deps, input, planId) : undefined;
  if (!data || !ref) return false;
  const stale = staleRefusalOf(deps, planId, ref.batch);
  if (stale) return handBackStale(deps, ref, stale, data);
  const base = compactReceipt(ref.batch, deps.state.plans.get(planId));
  if (!base) return false;
  const compact = withEffectControls(deps, planId, base);
  const proceed = await settledProceeds(deps, ref, input.signal);
  if (proceed) data.receipt = withOutstandingRepair(deps, ref, continuingReceipt(deps, ref, planId, compact));
  return proceed;
}

async function awaitQueuedPlan(deps: ChatAgentDeps, data: SealedData | undefined, queued: QueuedSeal, wait: { readonly seal: SealWait; readonly signal: AbortSignal | undefined }): Promise<void> {
  if (!data || !queued.queued || !queued.planId) return;
  const remaining = remainingWaitSeconds(wait.seal.seconds, boundedElapsedMs(wait.seal.startedAt, AUTHORING_MS_CEILING) ?? 0);
  await deps.workflowAdmission.awaitSealedApply(data, queued.planId, remaining, wait.signal);
}

/** A batch nobody will commit without the user's click cannot settle inside the wait; the reply carries its card instead. A batch that settled clean keeps the turn going (the runtime reads continuesLoop beside the result). */
export async function settleSealedPlan({ deps, result, data, queued, wait, input }: { deps: ChatAgentDeps; result: { readonly ok: boolean }; data: SealedData | undefined; queued: QueuedSeal; wait: SealWait; input: ChatAgentInput }): Promise<void> {
  await awaitQueuedPlan(deps, data, queued, { seal: wait, signal: input.signal });
  if (queued.queued && !queued.refusal && queued.planId && await continueAfterSeal(deps, input, data, queued.planId)) Object.assign(result, { continuesLoop: true });
}

/** A batch past the workflow's size or host-time bounds is the model's to shrink in this same turn, not a reason to end it. */
export function batchTooLargeResult(queued: QueuedSeal): { ok: false; error: { code: string; message: string } } | undefined {
  if (queued.queued || !queued.refusal || !SIZE_REFUSALS.has(queued.refusal.code)) return undefined;
  return { ok: false, error: { code: "WORKFLOW_BATCH_TOO_LARGE", message: `Nothing was applied: ${queued.refusal.message} Queue it again in smaller ae_queue_add batches, and simplify heavy drawings (fewer path vertices, shapes or keyframes per batch) before sealing.` } };
}
