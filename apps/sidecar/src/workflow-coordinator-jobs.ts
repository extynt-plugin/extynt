// The job-level half of the coordinator: opening, blocking, reopening and completing jobs, and recording provider failures and observations.

import {
  buildWorkflowContinuationInput, createInMemoryWorkflowStore,
  type WorkflowCompletionProposal, type WorkflowContinuationInput, type WorkflowContinuationSnapshot, type WorkflowEvent,
  type WorkflowId, type WorkflowJob, type WorkflowObservationEvidence, type WorkflowStore
} from "@extynt/workflow";
import { decodeOrThrow } from "@extynt/decode";
import { workflowCapabilityDisclosure } from "./workflow-capabilities.js";
import { completionPreparation, completionEvents, stageReadyForContinuation, completionFailure, type CompletionResult } from "./workflow-coordinator-completion.js";
import { interruptedActiveJobId, staleApprovalOwnerId } from "./workflow-coordinator-queries.js";
import type { ProjectedProviderFailure } from "./workflow-coordinator-projection.js";
import { WORKFLOW_JOB_CONSTRAINTS, eventId, hashId, iso, safeWorkflowDiagnostic, thrownFailure, workflowGoalText, type WorkflowCoordinatorOptions } from "./workflow-coordinator-types.js";
import { successCriteriaForGoal } from "./workflow-goal-evidence.js";

type ReopenEventType = "job.reopenedAfterReconciliation" | "job.reopenedForRepair" | "job.reopenedForObservation";

const CLOSED_STATUSES: readonly WorkflowJob["status"][] = ["blocked", "cancelled", "completed"];
const ENDED_STATUSES: readonly WorkflowJob["status"][] = ["cancelled", "completed"];

function reopenedBatchId(event: WorkflowEvent | undefined, type: ReopenEventType): string | undefined {
  return event && event.type === type && "batchId" in event ? event.batchId : undefined;
}

/** Job-level operations over a workflow store: every event they append is a control event for one job. */
export class WorkflowJobController {
  protected readonly now: () => Date;
  protected readonly store: WorkflowStore;
  protected readonly providerFailures = new Map<string, ProjectedProviderFailure>();
  protected readonly continuationCycles = new Map<WorkflowId, number>();

  protected constructor(options: WorkflowCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? createInMemoryWorkflowStore();
    for (const job of Object.values(this.store.getState().jobs)) {
      this.continuationCycles.set(job.jobId, job.providerCycle);
      this.restoreProviderFailure(job.jobId);
    }
  }

  public get workflowStore(): WorkflowStore { return this.store; }

  public jobIdForSeed(seed: string): WorkflowId { return hashId("wf-job", seed); }

  public openJob(seed: string, goalSummary: string, context: { requestId?: string; autoApply?: boolean } = {}): WorkflowId {
    const jobId = this.jobIdForSeed(seed);
    if (this.store.getState().jobs[jobId]) return jobId;
    const boundedGoal = workflowGoalText(goalSummary) || "Workflow goal";
    const stageId = hashId("wf-stage", `${jobId}:0`);
    const at = iso(this.now);
    this.store.appendBatch([
      { eventId: eventId("job.opened", jobId), at, type: "job.opened", jobId, engineId: "workflow-v1", title: "Workflow job", goalSummary: boundedGoal, constraints: WORKFLOW_JOB_CONSTRAINTS, successCriteria: successCriteriaForGoal(boundedGoal), ...(context.requestId ? { requestId: context.requestId } : {}), ...(context.autoApply === undefined ? {} : { autoApply: context.autoApply }) },
      { eventId: eventId("stage.opened", stageId), at, type: "stage.opened", jobId, stageId, title: "Workflow stage", purpose: "Execute typed host operations and verify their receipts.", successCriteria: [] },
    ]);
    return jobId;
  }

  public resumeContext(jobId: WorkflowId): { requestId: string; autoApply: boolean } {
    const opened = this.store.listEvents(jobId).find((event): event is Extract<WorkflowEvent, { type: "job.opened" }> => event.type === "job.opened");
    return { requestId: opened?.requestId ?? jobId, autoApply: opened?.autoApply === true };
  }

  public continuation(jobId: WorkflowId, snapshot: WorkflowContinuationSnapshot, cycle = 0): WorkflowContinuationInput {
    const currentCycle = Math.max(this.continuationCycles.get(jobId) ?? 0, Number.isInteger(cycle) && cycle >= 0 ? cycle : 0);
    const projected = buildWorkflowContinuationInput(this.store.getState(), jobId, snapshot, { cycle: currentCycle, capabilities: workflowCapabilityDisclosure() });
    this.continuationCycles.set(jobId, currentCycle);
    const failure = this.providerFailures.get(jobId);
    if (!failure) return projected;
    return { ...projected, blockers: [...new Set([...projected.blockers, `provider:${failure.code}:${failure.message}`])].slice(0, 32) };
  }

  public closeProviderCycle(jobId: WorkflowId, cycle: number): void {
    const current = this.store.getState().jobs[jobId];
    if (!current) throw new Error(`Workflow job ${jobId} does not exist.`);
    if (cycle === current.providerCycle || current.status === "completed") return;
    this.append({ eventId: eventId("job.providerCycleClosed", `${jobId}:${cycle}`), at: iso(this.now), type: "job.providerCycleClosed", jobId, cycle });
    this.continuationCycles.set(jobId, cycle);
  }

  public cancelJob(jobId: WorkflowId): void {
    const current = this.store.getState().jobs[jobId];
    if (!current || ENDED_STATUSES.includes(current.status)) return;
    this.append({ eventId: eventId("job.cancelled", jobId), at: iso(this.now), type: "job.cancelled", jobId });
  }

  public recordProviderFailure(jobId: WorkflowId, code: string, message: string, afterSeal: boolean): void {
    const failure: ProjectedProviderFailure = { jobId, code: code.slice(0, 64), message: safeWorkflowDiagnostic(message), at: iso(this.now), afterSeal };
    const latest = this.providerFailures.get(jobId);
    if (latest && latest.code === failure.code && latest.message === failure.message && latest.afterSeal === failure.afterSeal) return;
    this.append({ eventId: this.controlEventId("job.providerFailureRecorded", jobId), at: failure.at, type: "job.providerFailureRecorded", jobId, code: failure.code, message: failure.message, afterSeal: failure.afterSeal });
    this.providerFailures.set(jobId, failure);
  }

  public clearProviderFailure(jobId: WorkflowId): void {
    if (!this.providerFailures.has(jobId)) return;
    this.append({ eventId: this.controlEventId("job.providerFailureCleared", jobId), at: iso(this.now), type: "job.providerFailureCleared", jobId });
    this.providerFailures.delete(jobId);
  }

  public blockJob(jobId: WorkflowId, reason: string): void {
    const current = this.store.getState().jobs[jobId];
    if (!current || CLOSED_STATUSES.includes(current.status)) return;
    this.append({ eventId: this.controlEventId("job.blocked", jobId), at: iso(this.now), type: "job.blocked", jobId, reason: safeWorkflowDiagnostic(reason) });
  }

  public reopenForContinuation(jobId: WorkflowId): void {
    const last = this.store.listEvents(jobId).filter((event) => event.type !== "job.providerFailureCleared").at(-1);
    if (last?.type === "job.reopenedForContinuation") return;
    this.append({ eventId: this.controlEventId("job.reopenedForContinuation", jobId), at: iso(this.now), type: "job.reopenedForContinuation", jobId });
    this.clearProviderFailure(jobId);
  }

  public reopenAfterReconciliation(jobId: WorkflowId, batchId: WorkflowId): void { this.reopenOnce("job.reopenedAfterReconciliation", jobId, batchId); }

  public reopenForRepair(jobId: WorkflowId, batchId: WorkflowId): void { this.reopenOnce("job.reopenedForRepair", jobId, batchId); }

  public reopenForObservation(jobId: WorkflowId, batchId: WorkflowId): void { this.reopenOnce("job.reopenedForObservation", jobId, batchId); }

  public blockInterruptedActiveJob(): WorkflowId | null {
    const jobId = interruptedActiveJobId(this.store.getState());
    if (jobId === null) return null;
    this.blockJob(jobId, "workflow:interrupted-before-completion");
    return this.releasedEngine(jobId);
  }

  public staleApprovalJobId(): WorkflowId | null { return staleApprovalOwnerId(this.store.getState()); }

  public abandonStaleApprovalJob(): WorkflowId | null {
    const jobId = this.staleApprovalJobId();
    if (jobId === null) return null;
    this.cancelJob(jobId);
    return this.releasedEngine(jobId);
  }

  public recordObservation(jobId: WorkflowId, evidence: WorkflowObservationEvidence): void {
    this.append({ eventId: eventId("observation.recorded", evidence.evidenceId), at: evidence.recordedAt, type: "observation.recorded", jobId, evidence });
  }

  public completeStageForContinuation(jobId: WorkflowId): void {
    const state = this.store.getState();
    const job = state.jobs[jobId];
    if (!job || CLOSED_STATUSES.includes(job.status)) return;
    const stage = state.stages[job.stageIds.at(-1) ?? ""];
    if (!stage || stage.status === "completed" || stage.status === "cancelled") return;
    if (!stageReadyForContinuation(state, stage)) throw new Error(`Workflow stage ${stage.stageId} cannot complete before every batch is settled and verified.`);
    this.append({ eventId: eventId("stage.completed", stage.stageId), at: iso(this.now), type: "stage.completed", jobId, stageId: stage.stageId });
  }

  public proposeCompletion(jobId: WorkflowId, proposal: WorkflowCompletionProposal, currentSnapshot?: WorkflowContinuationSnapshot): CompletionResult {
    const state = this.store.getState();
    const current = state.jobs[jobId];
    if (!current) return completionFailure("JOB_NOT_FOUND", "The workflow job does not exist.");
    if (current.status === "completed") return { ok: true, alreadyCompleted: true };
    if (current.status === "blocked" || current.status === "cancelled") return completionFailure("COMPLETION_BLOCKED", "A blocked or cancelled workflow cannot complete.");
    const prepared = completionPreparation({ state, jobId, current, proposal, snapshot: currentSnapshot });
    if (!prepared.ok) return prepared;
    try {
      this.store.appendBatch(completionEvents(jobId, prepared, iso(this.now)));
      return { ok: true };
    } catch (caught) {
      return { ok: false, ...decodeOrThrow(thrownFailure("COMPLETION_TRANSITION_FAILED"), caught) };
    }
  }

  protected append(event: WorkflowEvent): void { this.store.append(event); }

  protected appendTracked(event: WorkflowEvent): boolean {
    const before = this.store.getState();
    return this.store.append(event) !== before;
  }

  protected controlEventId(type: string, jobId: WorkflowId): string {
    return eventId(type, `${jobId}:position:${this.store.listEvents(jobId).length}`);
  }

  private releasedEngine(jobId: WorkflowId): WorkflowId | null {
    return this.store.getState().activeJobId === jobId ? null : jobId;
  }

  private reopenOnce(type: ReopenEventType, jobId: WorkflowId, batchId: WorkflowId): void {
    if (reopenedBatchId(this.store.listEvents(jobId).at(-1), type) === batchId) return;
    this.append({ eventId: this.controlEventId(type, jobId), at: iso(this.now), type, jobId, batchId });
  }

  private restoreProviderFailure(jobId: WorkflowId): void {
    for (const event of this.store.listEvents(jobId)) {
      if (event.type === "job.providerFailureRecorded") this.providerFailures.set(jobId, { jobId, code: event.code, message: event.message, at: event.at, afterSeal: event.afterSeal });
      if (event.type === "job.providerFailureCleared") this.providerFailures.delete(jobId);
    }
  }
}
