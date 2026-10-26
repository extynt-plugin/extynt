// What a sealed batch means for the job once After Effects has answered: continue, repair, observe, recheck or block, decided from the batch's receipt and acted on at this edge.
import { decodeOrThrow } from "@extynt/decode";
import { MAX_WORKFLOW_AUTOMATIC_REPAIRS, type WorkflowBatch, type WorkflowContinuationInput, type WorkflowId } from "@extynt/workflow";
import type { AgentPlanCard } from "./agent.js";
import { hasPendingCoverage } from "./request-coverage.js";
import { MAX_STALE_REFUSAL_RETRIES, outstandingMismatch, staleRefusalOf } from "./server-workflow-seal-receipt.js";
import { ledgerOf, recordSidecarAction, requestRecheck } from "./server-workflow-sidecar-actions.js";
import { blockJobWithFailure, blockWorkflow, stopAtCycleBudget } from "./server-workflow-cycle-effects.js";
import { thrownMessage } from "./server-workflow-error.js";
import type { CycleRun, WorkflowCyclesDeps, WorkflowTurn } from "./server-workflow-cycle-state.js";

type BatchContext = {
  readonly deps: WorkflowCyclesDeps;
  readonly run: CycleRun;
  readonly turn: WorkflowTurn;
  readonly cycle: number;
  readonly continuation: WorkflowContinuationInput | null;
  readonly batch: WorkflowBatch;
  readonly jobId: WorkflowId;
  readonly planId: string;
};

type AdvanceInput = {
  readonly deps: WorkflowCyclesDeps;
  readonly run: CycleRun;
  readonly turn: WorkflowTurn;
  readonly cycle: number;
  readonly maxCycles: number;
  readonly continuation: WorkflowContinuationInput | null;
  readonly card: AgentPlanCard;
};

type Verdict = boolean | undefined;
type MismatchAction = "repair" | "block-unrepaired" | "block-limit";
type UnclosedStageAction = "carry-on" | "block-mismatch" | "block-failed";
type Acceptance = "already" | "accept" | "refuse";
type Mismatch = NonNullable<ReturnType<typeof outstandingMismatch>>;

const IN_HOST_STATES: readonly string[] = ["queued", "claimed", "executing"];

const UNCHECKED_BY_BASIS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^composition-markers-/, "composition markers"], [/^markers-/, "layer markers"], [/^shape-/, "shape details"], [/^composition-timeline-/, "composition timeline settings"],
];

interface UnverifiedBatch { readonly execution: { readonly receipt?: { readonly outcomes: ReadonlyArray<{ readonly type: string; readonly verification: string; readonly basis?: string | undefined }> } | null | undefined } }

function mismatchedCount(batch: WorkflowBatch): number {
  return batch.execution.receipt?.outcomes.filter((outcome) => outcome.outcome === "readback_mismatch").length ?? 0;
}

function mismatchedOperationsText(batch: WorkflowBatch): string {
  const rows = (batch.execution.receipt?.outcomes ?? []).filter((outcome) => outcome.outcome === "readback_mismatch").map((outcome) => `${outcome.type}${outcome.readback?.targetLayerId ? ` on layer ${outcome.readback.targetLayerId}` : ""}`);
  return rows.length > 6 ? `${rows.slice(0, 6).join(", ")} and ${rows.length - 6} more` : rows.join(", ");
}

/** The single loop reopened the job for the model's own repair and the turn ended without a newer batch: no continuation will run, so say so, and name what to send. */
export function unrepairedMessage(batch: WorkflowBatch): string {
  const count = mismatchedCount(batch);
  return `After Effects applied batch ${batch.batchId}, but ${count} ${count === 1 ? "operation" : "operations"} did not read back as requested (${mismatchedOperationsText(batch)}), and no repair was queued, so the workflow is blocked. Repair: queue only corrected versions of ${count === 1 ? "that operation" : "those operations"} with ae_queue_add and ae_queue_finish (do not resend the batch); if the observed value already meets the request, say so in your answer. Or undo the applied batch.`;
}

function repairLimitMessage(batch: WorkflowBatch): string {
  return `Automatic repairs were already tried ${MAX_WORKFLOW_AUTOMATIC_REPAIRS} times; After Effects applied the stage but ${mismatchedCount(batch)} operations did not read back as requested, so the workflow remains blocked.`;
}

function staleBlockMessage(code: string, correction: string | undefined): string {
  if (correction) return `${correction.replace(/ Resend the whole batch.*$/, "")} ${MAX_STALE_REFUSAL_RETRIES} corrected resends were already used, so the workflow is blocked; nothing was applied.`;
  return code === "STALE_SNAPSHOT" || code === "SELECTION_CHANGED"
    ? `After Effects refused the batch before running it because the project kept changing (${MAX_STALE_REFUSAL_RETRIES} retries against a refreshed snapshot were already used); nothing was applied, and the workflow is blocked.`
    : `After Effects refused the batch before running it (${code}) after ${MAX_STALE_REFUSAL_RETRIES} corrected retries; nothing was applied, and the workflow is blocked.`;
}

function uncheckedLabel(outcome: { readonly type: string; readonly basis?: string | undefined }): string {
  const byBasis = UNCHECKED_BY_BASIS.find(([pattern]) => pattern.test(outcome.basis ?? ""));
  return byBasis ? byBasis[1] : `${outcome.type.replace(/_/g, " ")} results`;
}

function uncheckedSummary(batch: UnverifiedBatch): string {
  const counts = new Map<string, number>();
  for (const outcome of batch.execution.receipt?.outcomes ?? []) {
    if (outcome.verification !== "applied_unverified") continue;
    const label = uncheckedLabel(outcome);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count} ${label}`).join(", ");
}

/**
 * Says which operations After Effects applied but read-back could not prove, rather than a stock line about shapes, and what the next cycle is: one build
 * batch when the request still names features the project does not show, otherwise the read-only look.
 */
export function appliedUnverifiedMessage(batch: UnverifiedBatch, missingFeatures = false): string {
  const summary = uncheckedSummary(batch), what = summary ? `could not confirm ${summary}` : "could not confirm every change";
  const next = missingFeatures
    ? "and the request still names features the project does not show, so extynt is continuing with one bounded build batch for them; it will not replay what already ran"
    : "so the orchestrator/validator is continuing with a bounded read-only visual observation; it will not replay the mutation";
  return `After Effects executed this stage. The read-back ${what}, ${next}.`;
}

/** What a read-back mismatch becomes: the model repairs it (reopened by the continuation), the turn ended without a repair, or the automatic repairs are spent. */
export function decideMismatch(facts: { readonly repairable: boolean; readonly endedUnrepaired: boolean }): MismatchAction {
  if (!facts.repairable) return "block-limit";
  return facts.endedUnrepaired ? "block-unrepaired" : "repair";
}

/** What a stage the engine cannot close becomes: the job carries on (free run, or a mismatch already accepted), or it blocks on the unanswered mismatch or on the failure itself. */
export function decideUnclosedStage(facts: { readonly hasMismatch: boolean; readonly accepted: boolean; readonly freeRun: boolean }): UnclosedStageAction {
  if (facts.hasMismatch) return facts.accepted ? "carry-on" : "block-mismatch";
  return facts.freeRun ? "carry-on" : "block-failed";
}

/** Whether free run carries on past a mismatch nobody repaired: once newer batches verified, or one cycle already blocked on it. */
export function decideAcceptance(facts: { readonly freeRun: boolean; readonly alreadyAccepted: boolean; readonly later: number; readonly blockedBefore: boolean }): Acceptance {
  if (!facts.freeRun) return "refuse";
  if (facts.alreadyAccepted) return "already";
  return facts.later < 1 && !facts.blockedBefore ? "refuse" : "accept";
}

function planAnswer(run: CycleRun, answer: string): void {
  run.dispatch({ kind: "planned", answer });
}

function acceptance(deps: WorkflowCyclesDeps, jobId: WorkflowId, mismatch: Mismatch): Acceptance {
  const freeRun = deps.state.options.workflowFreeRun === true;
  if (!freeRun) return "refuse";
  const ledger = ledgerOf(deps.state, jobId);
  const accepted = ledger.acceptedMismatches ??= [];
  const decision = decideAcceptance({ freeRun, alreadyAccepted: accepted.includes(mismatch.batchId), later: mismatch.later, blockedBefore: ledger.mismatchBlocked === true });
  if (decision !== "accept") return decision;
  accepted.push(mismatch.batchId);
  recordSidecarAction(deps.state, jobId, `batch ${mismatch.batchId} is applied, read-back unverified: it was never repaired, so the job carries on and the completion report lists it`);
  return decision;
}

function noteUnclosedStage(deps: WorkflowCyclesDeps, jobId: WorkflowId, message: string): void {
  const ledger = ledgerOf(deps.state, jobId);
  recordSidecarAction(deps.state, jobId, `could not close the stage after a verified batch (${message.slice(0, 160)}); the job carries on`);
  if (ledger.stageCloseRechecked) return;
  ledger.stageCloseRechecked = true;
  requestRecheck(deps.state, jobId, "the sidecar could not close a stage, so the project state is uncertain");
}

function awaitObservation({ deps, run, turn, cycle, continuation, jobId }: BatchContext): boolean {
  const unproved = deps.state.workflowCoordinator.unprovedAppliedBatch(jobId);
  if (!unproved) return false;
  deps.continuation.registerWorkflowContinuation({ jobId, turn, nextCycle: cycle + 1, continuation, pendingBatchId: unproved.batchId });
  planAnswer(run, appliedUnverifiedMessage(unproved, hasPendingCoverage(jobId)));
  return true;
}

function failStageClose({ deps, run, jobId }: BatchContext, message: string): void {
  blockJobWithFailure(deps.state.workflowCoordinator, { jobId, code: "WORKFLOW_STAGE_COMPLETE_FAILED", message, afterSeal: true, blocker: "workflow:stage-complete-failed" });
  run.dispatch({ kind: "failed", failure: { code: "WORKFLOW_STAGE_COMPLETE_FAILED", message }, seed: "none" });
}

function blockUnansweredMismatch({ deps, run, jobId }: BatchContext, mismatch: Mismatch): void {
  if (deps.state.options.workflowFreeRun === true) ledgerOf(deps.state, jobId).mismatchBlocked = true;
  blockWorkflow(deps, run, { code: "WORKFLOW_BATCH_BLOCKED", message: `${mismatch.text.replace(/ Queue only corrected.*$/, "")} No later verified batch corrected them, so the workflow is blocked.`, afterSeal: true });
}

function settleUnclosedStage(context: BatchContext, message: string): boolean {
  const { deps, jobId } = context;
  if (awaitObservation(context)) return false;
  const mismatch = outstandingMismatch(deps, jobId);
  const accepted = mismatch !== undefined && acceptance(deps, jobId, mismatch) !== "refuse";
  const action = decideUnclosedStage({ hasMismatch: mismatch !== undefined, accepted, freeRun: deps.state.options.workflowFreeRun === true });
  if (action === "carry-on") noteUnclosedStage(deps, jobId, message);
  else if (mismatch && action === "block-mismatch") blockUnansweredMismatch(context, mismatch);
  else if (action === "block-failed") failStageClose(context, message);
  return action === "carry-on";
}

function closeStage(context: BatchContext): boolean {
  try {
    context.deps.state.workflowCoordinator.completeStageForContinuation(context.jobId);
    return true;
  } catch (error) {
    return settleUnclosedStage(context, decodeOrThrow(thrownMessage, error));
  }
}

function crossWindowBoundary(context: BatchContext, maxCycles: number): boolean {
  const { deps, run, turn, cycle, batch, jobId } = context;
  const continuation = run.state.continuation;
  if (cycle + 1 < maxCycles || !continuation) return false;
  if (stopAtCycleBudget(deps, run, cycle + 1)) return true;
  recordSidecarAction(deps.state, jobId, `the ${maxCycles}-cycle authoring window ended after verified batch ${batch.batchId}; the sidecar continued the job in a new window (nothing was lost)`);
  deps.continuation.registerWorkflowContinuation({ jobId, turn, nextCycle: cycle + 1, continuation, pendingBatchId: batch.batchId });
  planAnswer(run, `The ${maxCycles}-cycle authoring window reached a continuation boundary after verified batch ${batch.batchId}; applied work is preserved and the same workflow is continuing automatically.`);
  return true;
}

function continueVerified(context: BatchContext, maxCycles: number): boolean {
  const { deps, run, cycle, batch, jobId } = context;
  const pairing = deps.planState.pairedWorkflowSnapshot(jobId, batch.batchId);
  if (!pairing.ok) {
    blockWorkflow(deps, run, { code: "WORKFLOW_SNAPSHOT_UNAVAILABLE", message: pairing.message, afterSeal: true });
    return true;
  }
  if (!closeStage(context)) return true;
  run.dispatch({ kind: "continuation-set", continuation: deps.state.workflowCoordinator.continuation(jobId, pairing, cycle + 1) ?? null });
  if (crossWindowBoundary(context, maxCycles)) return true;
  return run.state.continuation?.blockers.some((blocker) => blocker.startsWith("job:completed")) === true;
}

function repairMismatch(context: BatchContext, count: number): void {
  const { deps, run, turn, cycle, continuation, batch, jobId } = context;
  deps.continuation.registerWorkflowContinuation({ jobId, turn, nextCycle: cycle + 1, continuation, pendingBatchId: batch.batchId });
  planAnswer(run, `After Effects executed this stage and applied ${batch.execution.mutation}, but ${count} operations did not read back as requested. The orchestrator is repairing them.`);
}

function appliedMismatchCount(batch: WorkflowBatch): number {
  const failedApplied = batch.execution.state === "executed" && batch.verification.state === "failed" && batch.execution.mutation === "applied";
  return failedApplied ? mismatchedCount(batch) : 0;
}

function blockUnrepaired({ deps, run, batch, jobId }: BatchContext): void {
  if (deps.state.options.workflowFreeRun === true) ledgerOf(deps.state, jobId).mismatchBlocked = true;
  blockWorkflow(deps, run, { code: "WORKFLOW_BATCH_BLOCKED", message: unrepairedMessage(batch), afterSeal: true });
}

function mismatchStage(context: BatchContext): Verdict {
  const { deps, run, batch, jobId } = context;
  const count = appliedMismatchCount(batch);
  if (count === 0) return undefined;
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  const endedUnrepaired = deps.state.options.workflowSingleLoop !== false && run.state.aggregate?.settledInLoop === true;
  const action = decideMismatch({ repairable: !!job && job.automaticRepairReopens < MAX_WORKFLOW_AUTOMATIC_REPAIRS, endedUnrepaired });
  if (action === "repair") repairMismatch(context, count);
  else if (action === "block-limit") blockWorkflow(deps, run, { code: "WORKFLOW_BATCH_BLOCKED", message: repairLimitMessage(batch), afterSeal: true });
  else blockUnrepaired(context);
  return true;
}

function staleRefusalStage({ deps, run, batch, planId }: BatchContext): Verdict {
  const stale = deps.state.options.workflowSingleLoop === false ? undefined : staleRefusalOf(deps, planId, batch);
  if (!stale) return undefined;
  blockWorkflow(deps, run, { code: "WORKFLOW_BATCH_BLOCKED", message: staleBlockMessage(stale.code, stale.correction), afterSeal: true });
  return true;
}

function lateReceiptStage({ deps, turn, cycle, continuation, batch, jobId, planId }: BatchContext): Verdict {
  if (deps.state.workflowCoordinator.canReconcileLateReceipt(planId)) deps.continuation.registerWorkflowContinuation({ jobId, turn, nextCycle: cycle + 1, continuation, pendingBatchId: batch.batchId });
  return undefined;
}

function appliedUnverifiedStage({ run, batch, jobId }: BatchContext): Verdict {
  if (batch.execution.state !== "executed" || batch.verification.state !== "applied_unverified") return undefined;
  planAnswer(run, appliedUnverifiedMessage(batch, hasPendingCoverage(jobId)));
  return true;
}

function uncertainStage({ deps, run, batch, jobId }: BatchContext): Verdict {
  requestRecheck(deps.state, jobId, `the last batch settled ${batch.execution.state}/${batch.verification.state}, so what it left in After Effects is uncertain`);
  blockWorkflow(deps, run, { code: "WORKFLOW_BATCH_BLOCKED", message: `The workflow batch settled with ${batch.execution.state}/${batch.verification.state}; the project state is uncertain. The sidecar re-reads it, and the model must check it before building on it.`, afterSeal: true });
  return true;
}

const UNVERIFIED_STAGES: ReadonlyArray<(context: BatchContext) => Verdict> = [lateReceiptStage, appliedUnverifiedStage, mismatchStage, staleRefusalStage, uncertainStage];

function settleUnverified(context: BatchContext): boolean {
  for (const stage of UNVERIFIED_STAGES) {
    const verdict = stage(context);
    if (verdict !== undefined) return verdict;
  }
  return true;
}

function blockUnsettled({ deps, run, turn, cycle, continuation, batch, jobId }: BatchContext): void {
  if (IN_HOST_STATES.includes(batch.lifecycle)) deps.continuation.registerWorkflowContinuation({ jobId, turn, nextCycle: cycle + 1, continuation, pendingBatchId: batch.batchId });
  else blockWorkflow(deps, run, { code: "WORKFLOW_BATCH_STOPPED", message: `The workflow batch stopped in ${batch.lifecycle}; no continuation was attempted.`, afterSeal: true });
}

function batchContextOf(input: AdvanceInput): BatchContext | undefined {
  const { deps, run, turn, cycle, continuation, card } = input;
  const jobId = run.state.jobId;
  const batch = jobId ? deps.state.workflowCoordinator.batchForPlan(card.planId) : null;
  if (jobId && batch) return { deps, run, turn, cycle, continuation, batch, jobId, planId: card.planId };
  const message = jobId ? "The sealed batch has no sidecar-owned workflow Batch, so it cannot be dispatched or continued." : "The sealed batch was not admitted by workflow-v1, so no host dispatch or continuation was started.";
  blockWorkflow(deps, run, { code: "WORKFLOW_ADMISSION_REFUSED", message, afterSeal: true });
  return undefined;
}

/** Acts on the batch a cycle sealed: true when the run stops (blocked, waiting for the host, or handed to a continuation), false when the next cycle starts from the verified receipt. */
export function advanceWorkflowBatch(input: AdvanceInput): boolean {
  const context = batchContextOf(input);
  if (!context) return true;
  const { batch } = context;
  if (batch.lifecycle !== "settled") {
    blockUnsettled(context);
    return true;
  }
  if (batch.verification.state !== "verified") return settleUnverified(context);
  return continueVerified(context, input.maxCycles);
}
