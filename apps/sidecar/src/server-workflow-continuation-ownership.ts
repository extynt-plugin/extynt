// Who owns a workflow job between runs: which stops a user's "continue" may resume, when a continuation may advance, when a block is retried without the user (every block except the user's budget, an unreachable provider or host, or doubtful ownership), and when the job's advisory sessions are released.
import { CONTINUATION } from "@extynt/decide";
import { MAX_WORKFLOW_PROVIDER_CYCLES, type WorkflowBatch, type WorkflowId, type WorkflowJob } from "@extynt/workflow";
import type { WorkflowPause } from "./agent-types.js";
import { bookedOneOf } from "./decision-book.js";
import { backgroundReadFlight } from "./collection-lane-busy.js";
import { activityFor } from "./server-activity.js";
import type { SidecarState } from "./server-state.js";
import { automaticCycleStop } from "./server-workflow-cycle-budget.js";
import type { WorkflowContinuationRunInput, WorkflowCyclesDeps, WorkflowTurn } from "./server-workflow-cycle-state.js";

/** The sidecar state the ownership decisions read. */
export type WorkflowContinuationOwnershipState = Pick<SidecarState, "activeChatTurn" | "collection" | "inFlight" | "nativeBridge" | "server" | "shutdownRequested" | "workflowContinuationQueue" | "workflowCoordinator" | "workflowRuns">;

const CONTINUE_SETTLE_MS = 30_000;
const RECHECK_MS = 25;
const CONTINUATION_PHRASES: ReadonlySet<string> = new Set(["continue", "please continue", "continue please", "keep going", "go on", "resume", "carry on"]);

const USER_OR_HOST_STOPS: ReadonlySet<string> = new Set([
  "workflow:cycle-limit", "workflow:provider-unavailable", "workflow:cancellation-failed", "workflow:continuation-failed",
  "workflow:workflow_continuation_boundary_failed", "workflow:wall-clock", "workflow:snapshot-unavailable", "workflow:workflow_snapshot_unavailable", "workflow:reopen-failed",
  "workflow:interrupted-before-completion", "workflow:continuation-brief-failed", "workflow:cycle-close-failed",
]);

/** The job a user's continue found: resumable now, still settling past the wait, or none. */
export type PausedJob = { readonly kind: "resumable"; readonly job: WorkflowJob } | { readonly kind: "unsettled" } | { readonly kind: "none" };

type SelfContinuation = { readonly turn: WorkflowTurn; readonly run: WorkflowContinuationRunInput };

type BlockedJob = { readonly jobId: WorkflowId; readonly providerCycle: number; readonly blocker: string | null };

const lastSelfContinue = new Map<WorkflowId, number>();

/** True while the sidecar is serving: listening and not shutting down. */
export function workflowContinuationRuntimeActive(state: WorkflowContinuationOwnershipState): boolean {
  return state.server?.listening === true && state.shutdownRequested === null;
}

export function isWorkflowContinuationRequest(message: string): boolean {
  return CONTINUATION_PHRASES.has(message.trim().toLowerCase().replace(/[\s.!]+$/u, "")) || bookedOneOf({ decision: CONTINUATION.name, text: message }, ["resume", "amend-and-resume"]) !== undefined;
}

/** Whether the booked continuation decision reads this message as carrying on with a change to the request. */
export function isWorkflowAmendment(message: string): boolean {
  return bookedOneOf({ decision: CONTINUATION.name, text: message }, ["amend-and-resume"]) === "amend-and-resume";
}

/** Whether the latest job is blocked and the sidecar is serving: the only time a message could mean a continuation. */
export function hasBlockedJob(state: WorkflowContinuationOwnershipState): boolean {
  return workflowContinuationRuntimeActive(state) && latestJob(state)?.status === "blocked";
}

function latestJob(state: WorkflowContinuationOwnershipState): WorkflowJob | undefined {
  return Object.values(state.workflowCoordinator.workflowStore.getState().jobs).reduce<WorkflowJob | undefined>((latest, candidate) => (!latest || candidate.createdAt >= latest.createdAt ? candidate : latest), undefined);
}

/** The machine-readable pause for a job that just stopped at the window cap; null when a user "continue" could not resume it, so the panel never offers a button that cannot work. */
export function windowCapPause(jobId: WorkflowId | null, cycles: number): WorkflowPause | null {
  return jobId && cycles + 1 <= MAX_WORKFLOW_PROVIDER_CYCLES ? { kind: "window-cap", steps: cycles, jobId } : null;
}

function recoverableWorkflowBlocker(blocker: string | null): boolean {
  return blocker === "workflow:interrupted-before-completion";
}

function terminalWorkflowJob(job: WorkflowJob): boolean {
  if (job.status === "completed" || job.status === "cancelled") return true;
  return job.status === "blocked" && !recoverableWorkflowBlocker(job.blocker) && !job.blocker?.startsWith("batch:");
}

function batchExecutionSettled(batch: WorkflowBatch): boolean {
  const { mutation, state, mayHaveMutated } = batch.execution;
  if (mutation === "unknown" || mutation === "may_have_mutated") return false;
  const untouched = mutation === "none" && !mayHaveMutated;
  if (batch.lifecycle === "cancelled") return untouched;
  return batch.lifecycle === "settled" && (state === "executed" || (state === "rejected_before_apply" && untouched));
}

/** True for a batch that applied and failed read-back on a typed operation outcome. */
export function readbackMismatchBatch(batch: WorkflowBatch | undefined | null): boolean {
  return !!batch && batch.execution.state === "executed" && batch.execution.mutation === "applied" && batch.verification.state === "failed" && batch.execution.receipt?.outcomes.some((outcome) => outcome.outcome === "readback_mismatch") === true;
}

function readbackFailureWithoutUndo(batch: WorkflowBatch): boolean {
  const recovery = batch.recovery;
  return recovery.receipt === null && recovery.undoReceiptId === null && recovery.lineage === null && recovery.verification === null && readbackMismatchBatch(batch);
}

function batchRecoverySettled(batch: WorkflowBatch): boolean {
  if (batch.recovery.dispatch !== "idle") return false;
  if (batch.recovery.state === "blocked") return readbackFailureWithoutUndo(batch);
  return batch.recovery.state === "none" || batch.recovery.state === "available" || batch.recovery.state === "undone";
}

function batchHostWorkSettled(batch: WorkflowBatch | undefined): boolean {
  if (!batch || !batchExecutionSettled(batch)) return false;
  if (batch.verification.state === "unknown") return false;
  return batchRecoverySettled(batch);
}

function workflowHostWorkSettled(state: WorkflowContinuationOwnershipState, job: WorkflowJob, tolerateBackgroundRead = false): boolean {
  const durable = state.workflowCoordinator.workflowStore.getState();
  if (durable.activeDispatchLease) return false;
  if (state.inFlight && !(tolerateBackgroundRead && backgroundReadFlight(state.inFlight))) return false;
  if (state.nativeBridge.accessQuarantine() || state.collection.nativeAccessQuarantine()) return false;
  return job.batchIds.every((batchId) => batchHostWorkSettled(durable.batches[batchId]));
}

/** True for a job the sidecar may adopt after a restart: no authoring owner and every host receipt settled. */
export function recoverableWorkflowJob(state: WorkflowContinuationOwnershipState, job: WorkflowJob): boolean {
  if (!workflowContinuationRuntimeActive(state)) return false;
  if (job.status !== "active" && job.status !== "open" && !(job.status === "blocked" && recoverableWorkflowBlocker(job.blocker))) return false;
  if (state.activeChatTurn || state.workflowRuns.has(job.jobId)) return false;
  return workflowHostWorkSettled(state, job);
}

/** True when the job's queued continuation may start now: the sidecar is serving, no chat turn runs and no host work is unsettled. */
export function workflowContinuationMayAdvance(state: WorkflowContinuationOwnershipState, jobId: WorkflowId): boolean {
  if (!workflowContinuationRuntimeActive(state) || state.activeChatTurn) return false;
  const job = state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  return !!job && !terminalWorkflowJob(job) && workflowHostWorkSettled(state, job);
}

/** A refused `ae_workflow_complete` blocks the job with `workflow:<refusal code>`; applied host work is intact, so a user "continue" is consent for one more completion attempt. */
export function completionRefusalBlocker(blocker: string | null): boolean {
  return blocker !== null && (blocker.startsWith("workflow:completion_") || blocker === "workflow:workflow_completion_refused");
}

function cycleLimitBlocker(blocker: string | null): boolean {
  return blocker === "workflow:cycle-limit";
}

function resumableStopBlocker(blocker: string | null): boolean {
  return cycleLimitBlocker(blocker) || completionRefusalBlocker(blocker);
}

function latestStop(state: WorkflowContinuationOwnershipState, message: string, accepts: (blocker: string | null) => boolean): WorkflowJob | undefined {
  if (!workflowContinuationRuntimeActive(state) || !isWorkflowContinuationRequest(message)) return undefined;
  const job = latestJob(state);
  return job?.status === "blocked" && accepts(job.blocker) ? job : undefined;
}

function stopSettled(state: WorkflowContinuationOwnershipState, job: WorkflowJob): boolean {
  if (state.workflowCoordinator.workflowStore.getState().activeJobId !== null) return false;
  const run = state.workflowRuns.get(job.jobId);
  return (!run || run.state === "terminal") && workflowHostWorkSettled(state, job, true);
}

function cycleLimitedJobForUserContinuation(state: WorkflowContinuationOwnershipState, message: string): WorkflowJob | undefined {
  const job = latestStop(state, message, cycleLimitBlocker);
  return job && stopSettled(state, job) ? job : undefined;
}

function stoppedJobForUserContinuation(state: WorkflowContinuationOwnershipState, message: string): WorkflowJob | undefined {
  const job = latestStop(state, message, resumableStopBlocker);
  return job && stopSettled(state, job) ? job : undefined;
}

function stoppedJobSettling(state: WorkflowContinuationOwnershipState, message: string): WorkflowJob | undefined {
  const job = latestStop(state, message, resumableStopBlocker);
  return job && !stopSettled(state, job) ? job : undefined;
}

/** The pause a user "continue" would resume right now, for the status route: same eligibility as the continue itself. */
export function currentWindowCapPause(state: WorkflowContinuationOwnershipState): WorkflowPause | null {
  const job = cycleLimitedJobForUserContinuation(state, "continue");
  return job ? windowCapPause(job.jobId, job.providerCycle) : null;
}

function retireSettledTerminalContinuation(state: WorkflowContinuationOwnershipState, jobId: WorkflowId): void {
  if (!workflowContinuationRuntimeActive(state)) return;
  const durable = state.workflowCoordinator.workflowStore.getState();
  const job = durable.jobs[jobId];
  if (!job || !terminalWorkflowJob(job) || durable.activeJobId === jobId) return;
  const run = state.workflowRuns.get(jobId);
  if (!run || run.state === "waiting_receipt" || !workflowHostWorkSettled(state, job)) return;
  run.state = "terminal";
  state.workflowContinuationQueue.delete(jobId);
}

/** Retires the scheduling of every queued job whose run is terminal and settled. */
export function retireSettledTerminalContinuations(state: WorkflowContinuationOwnershipState): void {
  for (const jobId of state.workflowContinuationQueue) retireSettledTerminalContinuation(state, jobId);
}

function releasesAdvisory(job: WorkflowJob, runState: string | undefined): boolean {
  if (job.status === "completed" || job.status === "cancelled") return true;
  return job.status === "blocked" && runState !== "waiting_receipt" && runState !== "scheduled";
}

/** Settled provider failures release advisory sessions after retiring their queued run. */
export function finishWorkflowOwnership(state: WorkflowContinuationOwnershipState, jobId: WorkflowId | null, release: (jobId: WorkflowId, reason: string) => void): void {
  if (!jobId || !workflowContinuationRuntimeActive(state)) return;
  retireSettledTerminalContinuation(state, jobId);
  const job = state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  if (job && releasesAdvisory(job, state.workflowRuns.get(jobId)?.state)) release(jobId, `workflow ${job.status}`);
}

function untilSettled(state: Pick<SidecarState, "changeWaiters">, settled: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => finish(settled()), ms), recheck = setInterval(check, RECHECK_MS);
    function finish(result: boolean): void {
      clearTimeout(deadline);
      clearInterval(recheck);
      state.changeWaiters.delete(check);
      resolve(result);
    }
    function check(): void {
      if (settled()) finish(true);
      else state.changeWaiters.add(check);
    }
    check();
  });
}

/** The job a user's `message` resumes: now when its stop has settled, after it settles when it has not, nothing when no stop matches. */
export async function awaitStoppedJob(state: WorkflowContinuationOwnershipState & Pick<SidecarState, "changeWaiters">, message: string, waitMs = CONTINUE_SETTLE_MS): Promise<PausedJob> {
  const settling = stoppedJobSettling(state, message);
  if (settling && !(await untilSettled(state, () => !stoppedJobSettling(state, message), waitMs))) return { kind: "unsettled" };
  const job = stoppedJobForUserContinuation(state, message);
  if (job) return { kind: "resumable", job };
  return settling && stoppedJobSettling(state, message) ? { kind: "unsettled" } : { kind: "none" };
}

function selfContinueEnabled(deps: WorkflowCyclesDeps, turn: WorkflowTurn): boolean {
  return turn.signal?.aborted !== true && deps.state.options.workflowFreeRun === true;
}

function blockedForRetry(deps: WorkflowCyclesDeps, jobId: WorkflowId): BlockedJob | undefined {
  const job = deps.state.workflowCoordinator.workflowStore.getState().jobs[jobId];
  return job?.status === "blocked" && !USER_OR_HOST_STOPS.has(job.blocker ?? "") ? job : undefined;
}

function retryableJob(deps: WorkflowCyclesDeps, turn: WorkflowTurn, jobId: WorkflowId | null): BlockedJob | undefined {
  if (!jobId || !selfContinueEnabled(deps, turn)) return undefined;
  const job = blockedForRetry(deps, jobId);
  if (!job || (lastSelfContinue.get(jobId) ?? -1) >= job.providerCycle) return undefined;
  return automaticCycleStop(deps.state, jobId, job.providerCycle) ? undefined : job;
}

function reopenForRetry(deps: WorkflowCyclesDeps, job: BlockedJob, code: string | null): boolean {
  try { deps.state.workflowCoordinator.reopenForContinuation(job.jobId); } catch { return false; }
  lastSelfContinue.set(job.jobId, job.providerCycle);
  activityFor(deps.state).via.set(job.jobId, "self-continue");
  deps.state.eventLog("workflow.self-continued", { jobId: job.jobId, cycle: job.providerCycle, blocker: job.blocker, code });
  if (deps.state.workflowRuns.get(job.jobId)?.state === "terminal") deps.state.workflowRuns.delete(job.jobId);
  return true;
}

type Latest = NonNullable<ReturnType<WorkflowCyclesDeps["planState"]["normalizedLatest"]>>;
type Failure = { readonly code: string; readonly message: string };

function selfContinuationOf(deps: WorkflowCyclesDeps, turn: WorkflowTurn, job: BlockedJob, resume: { readonly latest: Latest; readonly failure: Failure | undefined }): SelfContinuation {
  const coordinator = deps.state.workflowCoordinator;
  const { latest, failure } = resume;
  const message = failure?.message ?? job.blocker ?? "the previous cycle stopped";
  const continuation = coordinator.continuation(job.jobId, { fingerprint: latest.fingerprint, revision: latest.revision }, job.providerCycle);
  return {
    turn: { ...turn, workflowSeed: coordinator.resumeContext(job.jobId).requestId, stopFeedback: { cycle: job.providerCycle, message } },
    run: { jobId: job.jobId, startCycle: job.providerCycle, continuation },
  };
}

/** The next run for a job that just blocked on something the model can fix, or undefined to let the block stand. */
export function selfContinuation(deps: WorkflowCyclesDeps, turn: WorkflowTurn, jobId: WorkflowId | null, failure: Failure | undefined): SelfContinuation | undefined {
  const job = retryableJob(deps, turn, jobId);
  const latest = job ? deps.planState.normalizedLatest() : undefined;
  if (!job || !latest || !reopenForRetry(deps, job, failure?.code ?? null)) return undefined;
  return selfContinuationOf(deps, turn, job, { latest, failure });
}
