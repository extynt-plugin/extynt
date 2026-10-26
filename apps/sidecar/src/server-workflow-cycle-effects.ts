// The effects of a workflow run's authoring loop: blocking and cancelling a job, releasing its specialists and stopping it at the cycle budget.
import type { WorkflowId } from "@extynt/workflow";
import { TERMINAL_PLAN_STATUSES } from "./server-limits.js";
import type { SidecarState } from "./server-state.js";
import { windowCapPause } from "./server-workflow-continuation-ownership.js";
import { automaticCycleStop, cycleStopMessage, type CycleStop } from "./server-workflow-cycle-budget.js";
import type { CycleRun, WorkflowCyclesDeps } from "./server-workflow-cycle-state.js";
import { logSpecialistSummary } from "./server-workflow-specialist-calls.js";

type Coordinator = WorkflowCyclesDeps["state"]["workflowCoordinator"];
type JobBlocker = Pick<Coordinator, "recordProviderFailure" | "blockJob">;

type JobBlock = { readonly jobId: WorkflowId; readonly code: string; readonly message: string; readonly afterSeal: boolean; readonly blocker: string };

/** Records the provider failure on the job and blocks it. */
export function blockJobWithFailure(coordinator: JobBlocker, block: JobBlock): void {
  coordinator.recordProviderFailure(block.jobId, block.code, block.message, block.afterSeal);
  coordinator.blockJob(block.jobId, block.blocker);
}

/** Blocks the run's job (when it has one) with the failure and records the failure on the merged result. */
export function blockWorkflow(deps: WorkflowCyclesDeps, run: CycleRun, failure: { readonly code: string; readonly message: string; readonly afterSeal: boolean }): void {
  const jobId = run.state.jobId;
  if (jobId) blockJobWithFailure(deps.state.workflowCoordinator, { jobId, ...failure, blocker: `workflow:${failure.code.toLowerCase()}` });
  run.dispatch({ kind: "failed", failure: { code: failure.code, message: failure.message }, seed: "none" });
}

/** The job stays blocked until the user's "continue" (a pause) or next message (a stop); applied work is preserved. */
export function blockCycleLimit(deps: { readonly state: { readonly workflowCoordinator: JobBlocker } }, run: CycleRun, stop: CycleStop, cycle: number): void {
  const message = cycleStopMessage(stop);
  const clock = stop.kind === "clock";
  const code = clock ? "WORKFLOW_WALL_CLOCK_LIMIT" : "WORKFLOW_CYCLE_LIMIT";
  const jobId = run.state.jobId;
  if (jobId) blockJobWithFailure(deps.state.workflowCoordinator, { jobId, code, message, afterSeal: true, blocker: clock ? "workflow:wall-clock" : "workflow:cycle-limit" });
  const pause = stop.kind === "hard" || clock ? null : windowCapPause(jobId, cycle);
  run.dispatch({ kind: "limit-stopped", failure: { code, message }, pause });
}

/** Stops the job when a cycle at this index may not start on its own (no progress, or past the go-ahead's ceilings); true when it stopped. */
export function stopAtCycleBudget(deps: WorkflowCyclesDeps, run: CycleRun, cycle: number): boolean {
  const stop = automaticCycleStop(deps.state, run.state.jobId, cycle);
  if (stop) blockCycleLimit(deps, run, stop, cycle);
  return stop !== null;
}

type Batch = ReturnType<Coordinator["batchForPlan"]>;
type MailboxEntry = SidecarState["agentMailbox"][number];

function hostClaimsBatch(batch: Batch): boolean {
  return batch?.lifecycle === "claimed" || batch?.lifecycle === "executing";
}

function hostClaimsUndo(batch: Batch): boolean {
  return batch?.recovery.dispatch === "claimed" || batch?.recovery.dispatch === "executing";
}

function inFlightFor(deps: WorkflowCyclesDeps, planId: string): SidecarState["inFlight"] {
  return deps.state.inFlight?.id === planId ? deps.state.inFlight : undefined;
}

function planIsPreserved(deps: WorkflowCyclesDeps, coordinator: Coordinator, planId: string): boolean {
  const batch = coordinator.batchForPlan(planId);
  if (hostClaimsBatch(batch)) return true;
  const inFlight = inFlightFor(deps, planId);
  if (!inFlight || inFlight.kind === "apply_plan" || inFlight.kind === "apply_pending") return Boolean(inFlight);
  return inFlight.kind === "undo_plan" && hostClaimsUndo(batch);
}

function cancelPlan(deps: WorkflowCyclesDeps, coordinator: Coordinator, planId: string, preserved: Set<string>): void {
  if (planIsPreserved(deps, coordinator, planId)) { preserved.add(planId); return; }
  if (inFlightFor(deps, planId)?.kind === "apply_pending") deps.state.inFlight = undefined;
  const record = deps.state.plans.get(planId);
  if (!record || TERMINAL_PLAN_STATUSES.has(record.status)) return;
  record.status = "cancelled";
  record.updatedAt = deps.state.now().toISOString();
}

function cancelJobPlans(deps: WorkflowCyclesDeps, coordinator: Coordinator, jobId: WorkflowId): Set<string> {
  const preserved = new Set<string>();
  for (const record of deps.state.plans.values()) if (coordinator.jobIdForPlan(record.plan.planId) === jobId) cancelPlan(deps, coordinator, record.plan.planId, preserved);
  return preserved;
}

function mailboxPlanId(entry: MailboxEntry | undefined): string | undefined {
  const approved = entry?.approvedData.planId;
  return entry?.planId ?? (typeof approved === "string" ? approved : undefined);
}

function removeJobMailbox(deps: WorkflowCyclesDeps, coordinator: Coordinator, jobId: WorkflowId, preserved: ReadonlySet<string>): void {
  for (let index = deps.state.agentMailbox.length - 1; index >= 0; index -= 1) {
    const planId = mailboxPlanId(deps.state.agentMailbox[index]);
    if (planId && coordinator.jobIdForPlan(planId) === jobId && !preserved.has(planId)) deps.state.agentMailbox.splice(index, 1);
  }
}

function cancelContinuation(deps: WorkflowCyclesDeps, jobId: WorkflowId): void {
  const continuation = deps.state.workflowRuns.get(jobId);
  if (!continuation || continuation.state === "terminal") return;
  continuation.controller.abort(new Error("workflow cancelled"));
  deps.state.workflowContinuationQueue.delete(jobId);
  deps.workflowProgress.setWorkflowTerminalProgress(continuation, "blocked", "Workflow was cancelled; no future continuation will be scheduled, while any late host receipt remains authoritative.");
  continuation.state = "terminal";
}

/** Cancels the job and everything queued for it, keeping the plans the host has already claimed; a late host receipt stays authoritative. */
export function cancelWorkflowJob(deps: WorkflowCyclesDeps, jobId: WorkflowId): void {
  const coordinator = deps.state.workflowCoordinator;
  if (deps.state.pendingJobUndo?.jobId === jobId) deps.state.pendingJobUndo = null;
  cancelContinuation(deps, jobId);
  const preserved = cancelJobPlans(deps, coordinator, jobId);
  deps.state.readyPlans = deps.state.readyPlans.filter((entry) => coordinator.jobIdForPlan(entry.planId) !== jobId);
  removeJobMailbox(deps, coordinator, jobId, preserved);
  coordinator.cancelJob(jobId);
  releaseSpecialists(deps, jobId, "workflow cancelled");
  deps.transport.notifyChange();
}

/** Specialists are advisory threads of one job: once nothing can continue it, stop their provider calls and drop their transcripts. */
export function releaseSpecialists(deps: WorkflowCyclesDeps, jobId: WorkflowId, reason: string): void {
  const sessions = deps.state.workflowSpecialistSessions.get(jobId);
  if (sessions) for (const session of sessions.values()) {
    session.generation = (session.generation ?? 0) + 1;
    session.controller?.abort(new Error(reason));
    delete session.controller;
    delete session.pending;
  }
  logSpecialistSummary(deps.state, jobId);
  deps.state.workflowOrchestrations.delete(jobId);
  deps.state.workflowSpecialistSessions.delete(jobId);
  deps.state.persistWorkflowHandoffs();
}

/** Cancels the run's job after its turn was aborted; a cancellation that itself fails blocks the job with that failure. */
export function cancelRunAfterAbort(deps: WorkflowCyclesDeps, run: CycleRun): void {
  const jobId = run.state.jobId;
  if (!jobId) return;
  try { cancelWorkflowJob(deps, jobId); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockJobWithFailure(deps.state.workflowCoordinator, { jobId, code: "CANCELLATION_FAILED", message, afterSeal: false, blocker: "workflow:cancellation-failed" });
  }
}

/** The snapshot a continuation brief is paired with. */
export function snapshotPairing(latest: { readonly fingerprint: string; readonly revision: string | null }): { readonly fingerprint: string; readonly revision: string | null } {
  return { fingerprint: latest.fingerprint, revision: latest.revision };
}
