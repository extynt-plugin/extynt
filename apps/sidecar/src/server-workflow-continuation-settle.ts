// What a settled host receipt means for a waiting workflow run: when it wakes the run, how a blocked job is reopened for observation, repair or reconciliation, and how the next brief is cut.
import { decodeOrThrow } from "@extynt/decode";
import { MAX_WORKFLOW_AUTOMATIC_REPAIRS, stageBatchesConfirmed, type OperationLookup, type WorkflowBatch, type WorkflowId, type WorkflowJob, type WorkflowStage } from "@extynt/workflow";
import type { WorkflowContinuationRun } from "./server-types.js";
import { pendingPlanFor } from "./server-plan-state.js";
import type { WorkflowContinuationDeps } from "./server-workflow-continuation.js";
import { readbackMismatchBatch } from "./server-workflow-continuation-ownership.js";
import { thrownCode, thrownMessage } from "./server-workflow-error.js";

/** The snapshot a continuation brief is paired with. */
export type Pairing = { readonly fingerprint: string; readonly revision: string | null };

/** Wakes the run waiting on a job once its receipt allows. */
export type Schedule = (jobId: WorkflowId) => void;

type Deps = WorkflowContinuationDeps;
type Coordinator = Deps["state"]["workflowCoordinator"];
type ReopenKind = "observation" | "repair" | "reconciliation";

type ReopenPlan = {
  readonly unowned: string;
  readonly failureCode: string;
  readonly blocker: string | null;
  readonly reopen: (coordinator: Coordinator, jobId: WorkflowId, batchId: WorkflowId) => void;
};

type SettleInput = {
  readonly deps: Deps;
  readonly run: WorkflowContinuationRun;
  readonly planId: string;
  readonly pendingPlanId: string;
  readonly pendingBatch: WorkflowBatch | null;
  readonly settledBatch: WorkflowBatch | null;
  readonly job: WorkflowJob | undefined;
  readonly schedule: Schedule;
};

const REOPENS: { readonly [K in ReopenKind]: ReopenPlan } = {
  observation: { unowned: "Workflow is blocked; no observation cycle will be scheduled.", failureCode: "WORKFLOW_OBSERVATION_REOPEN_FAILED", blocker: null, reopen: (coordinator, jobId, batchId) => coordinator.reopenForObservation(jobId, batchId) },
  repair: { unowned: "Workflow is blocked; no repair cycle will be scheduled.", failureCode: "WORKFLOW_REPAIR_REOPEN_FAILED", blocker: null, reopen: (coordinator, jobId, batchId) => coordinator.reopenForRepair(jobId, batchId) },
  reconciliation: { unowned: "Workflow is blocked; no future cycle will be scheduled.", failureCode: "WORKFLOW_REOPEN_FAILED", blocker: "workflow:reopen-failed", reopen: (coordinator, jobId, batchId) => coordinator.reopenAfterReconciliation(jobId, batchId) },
};

/** Ends the run's scheduling with a terminal progress line; always false so callers can return it. */
export function terminalJob(deps: Deps, run: WorkflowContinuationRun, phase: "completed" | "blocked", label: string): false {
  deps.workflowProgress.setWorkflowTerminalProgress(run, phase, label);
  run.state = "terminal";
  return false;
}

function waitForLane(deps: Deps, run: WorkflowContinuationRun, batch: WorkflowBatch): false {
  deps.workflowProgress.setWorkflowWaitingProgress(run.requestId, batch.batchId);
  return false;
}

function reopenFailed(deps: Deps, run: WorkflowContinuationRun, failed: { readonly job: WorkflowJob; readonly kind: ReopenKind; readonly message: string }): false {
  const { job, kind, message } = failed;
  const plan = REOPENS[kind];
  deps.state.workflowCoordinator.recordProviderFailure(job.jobId, plan.failureCode, message, true);
  if (plan.blocker) deps.state.workflowCoordinator.blockJob(job.jobId, plan.blocker);
  return terminalJob(deps, run, "blocked", message);
}

function reopenBlocked(deps: Deps, run: WorkflowContinuationRun, target: { readonly job: WorkflowJob; readonly batch: WorkflowBatch }, kind: ReopenKind): boolean {
  const { job, batch } = target;
  const coordinator = deps.state.workflowCoordinator;
  if (!job.blocker?.startsWith(`batch:${batch.batchId}:`)) return terminalJob(deps, run, "blocked", job.blocker ?? REOPENS[kind].unowned);
  const durable = coordinator.workflowStore.getState();
  if (durable.activeJobId !== null && durable.activeJobId !== job.jobId) return waitForLane(deps, run, batch);
  try { REOPENS[kind].reopen(coordinator, job.jobId, batch.batchId); return true; }
  catch (error) {
    return decodeOrThrow(thrownCode, error) === "DISPATCH_LANE_BUSY" ? waitForLane(deps, run, batch) : reopenFailed(deps, run, { job, kind, message: decodeOrThrow(thrownMessage, error) });
  }
}

function reopenKindOf(batch: WorkflowBatch): ReopenKind {
  if (batch.verification.state === "verified") return "reconciliation";
  return batch.execution.state === "executed" && batch.verification.state === "applied_unverified" ? "observation" : "repair";
}

/** Decides what a blocked, cancelled or completed job means for its run: ends the run, waits for the lane, or reopens the job; true when a cycle may be briefed. */
export function resolveBlockedWorkflow(deps: Deps, run: WorkflowContinuationRun, job: WorkflowJob, batch: WorkflowBatch): boolean {
  if (job.status === "cancelled") return terminalJob(deps, run, "blocked", "Workflow was cancelled; the late verified receipt was retained and no future cycle was reopened.");
  if (job.status === "completed") return terminalJob(deps, run, "completed", "Workflow already completed from reducer-owned evidence.");
  if (job.status !== "blocked") return true;
  if (readbackMismatchBatch(batch) && job.automaticRepairReopens >= MAX_WORKFLOW_AUTOMATIC_REPAIRS) {
    const message = `Automatic repairs were already tried ${MAX_WORKFLOW_AUTOMATIC_REPAIRS} times; the workflow remains blocked.`;
    deps.state.workflowCoordinator.recordProviderFailure(job.jobId, "WORKFLOW_BATCH_BLOCKED", message, true);
    return terminalJob(deps, run, "blocked", message);
  }
  return reopenBlocked(deps, run, { job, batch }, reopenKindOf(batch));
}

function completableStage(stage: WorkflowStage | undefined, batches: Readonly<Record<WorkflowId, WorkflowBatch>>, operations: OperationLookup): boolean {
  if (!stage || stage.status === "completed" || stage.status === "cancelled" || stage.batchIds.length === 0) return false;
  return stageBatchesConfirmed(stage.batchIds.map((id) => batches[id]), () => false, operations);
}

function safeRejectedBatch(batch: WorkflowBatch | undefined | null): boolean {
  return !!batch && batch.execution.state === "rejected_before_apply" && batch.execution.mutation === "none" && !batch.execution.mayHaveMutated;
}

/** True when a settled batch lets the run advance: verified, executed but unverified, a read-back mismatch, or a safe rejection with no late receipt due. */
export function settledBatchCanWake(coordinator: Coordinator, batch: WorkflowBatch | null, planId: string): boolean {
  return batch?.lifecycle === "settled" && (batch.verification.state === "verified" || (batch.execution.state === "executed" && batch.verification.state === "applied_unverified") || readbackMismatchBatch(batch) || (safeRejectedBatch(batch) && !coordinator.canReconcileLateReceipt(planId)));
}

/** The plan whose batch is this pending batch, or the batch id itself when no plan record carries it. */
export function pendingPlanId(deps: Deps, batchId: WorkflowId): string {
  const plan = [...deps.state.plans.values()].find((record) => deps.state.workflowCoordinator.batchIdForPlan(record.plan.planId) === batchId);
  return plan?.plan.planId ?? batchId;
}

/** Cuts the next brief for a run whose batch settled: completes the stage when every batch is confirmed, then queues the run; a failure blocks the job. */
export function continuationBrief(deps: Deps, run: WorkflowContinuationRun, input: { readonly jobId: WorkflowId; readonly pairing: Pairing; readonly drain: () => void }): boolean {
  const { jobId, pairing, drain } = input;
  const coordinator = deps.state.workflowCoordinator;
  try {
    const durable = coordinator.workflowStore.getState();
    const stageId = durable.jobs[jobId]?.stageIds.at(-1);
    if (completableStage(stageId ? durable.stages[stageId] : undefined, durable.batches, durable.operations)) coordinator.completeStageForContinuation(jobId);
    run.continuation = coordinator.continuation(jobId, pairing, run.nextCycle);
    run.state = "scheduled";
    deps.state.workflowContinuationQueue.add(jobId);
    drain();
    return true;
  } catch (error) {
    const message = decodeOrThrow(thrownMessage, error);
    coordinator.recordProviderFailure(jobId, "WORKFLOW_CONTINUATION_BRIEF_FAILED", message, true);
    coordinator.blockJob(jobId, "workflow:continuation-brief-failed");
    terminalJob(deps, run, "blocked", message);
    return false;
  }
}

function isSettledBatch(batch: WorkflowBatch | null): batch is WorkflowBatch {
  return !!batch && batch.lifecycle === "settled";
}

function settleUnverified(input: SettleInput, batch: WorkflowBatch): void {
  const { deps, run, planId, schedule } = input;
  if ((batch.execution.state === "executed" && batch.verification.state === "applied_unverified") || readbackMismatchBatch(batch)) { schedule(run.jobId); return; }
  if (deps.state.workflowCoordinator.canReconcileLateReceipt(planId)) return;
  if (safeRejectedBatch(batch)) schedule(run.jobId);
  else terminalJob(deps, run, "blocked", `Workflow batch settled with ${batch.execution.state}/${batch.verification.state}; automatic repair is unsafe because mutation cannot be ruled out.`);
}

function settleSettled(input: SettleInput, pendingBatch: WorkflowBatch): void {
  const { run, planId, pendingPlanId: pendingId, settledBatch, schedule } = input;
  const own = pendingId === planId;
  const ready = !own || isSettledBatch(settledBatch);
  if (pendingBatch.verification.state === "verified") {
    if (ready) schedule(run.jobId);
    return;
  }
  if (own && ready) settleUnverified(input, pendingBatch);
}

function settleBatchOutcome(input: SettleInput): void {
  const { deps, run, pendingBatch, job } = input;
  if (job?.status === "cancelled") terminalJob(deps, run, "blocked", "Workflow was cancelled; the receipt was retained and no future continuation will be scheduled.");
  else if (isSettledBatch(pendingBatch)) settleSettled(input, pendingBatch);
}

/** Reads the settlement of one plan for a run waiting on a receipt: wakes it, ends it or leaves it waiting. */
export function settleContinuationRun(deps: Deps, run: WorkflowContinuationRun, planId: string, schedule: Schedule): void {
  if (run.state !== "waiting_receipt" || run.pendingBatchId === null) return;
  const pending = pendingPlanFor(deps.state, run.pendingBatchId);
  if (!pending) return;
  const coordinator = deps.state.workflowCoordinator;
  settleBatchOutcome({
    deps, run, planId, schedule,
    pendingPlanId: pending.plan.planId,
    pendingBatch: coordinator.batchForPlan(pending.plan.planId),
    settledBatch: coordinator.batchForPlan(planId),
    job: coordinator.workflowStore.getState().jobs[run.jobId],
  });
}
