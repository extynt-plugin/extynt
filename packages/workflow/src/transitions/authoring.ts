// Authoring transitions: opening and blocking jobs, advancing provider cycles, opening stages and opening an undo session on a finished job.

import { assert, boundedText, criteria, id } from "../assertions.js";
import { clone } from "../frozen-state.js";
import type { MutableWorkflowState } from "../frozen-state.js";
import {
  MAX_WORKFLOW_BATCHES_PER_JOB,
  MAX_WORKFLOW_GOAL_LENGTH,
  MAX_WORKFLOW_JOBS,
  MAX_WORKFLOW_OPERATIONS_PER_BATCH,
  MAX_WORKFLOW_PROVIDER_CYCLES,
  MAX_WORKFLOW_STAGES_PER_JOB,
  MAX_WORKFLOW_SUMMARY_LENGTH,
  MAX_WORKFLOW_TITLE_LENGTH,
  WORKFLOW_ENGINE_ID,
} from "../limits.js";
import { releaseActiveJobIfSafe } from "../ownership.js";
import { assertProgressAllowed, job, setRecord } from "../state.js";
import type { WorkflowJob, WorkflowJobConstraints, WorkflowStage } from "../state-types.js";
import type { Transition, TransitionSlice } from "../transition-table.js";
import { REOPENING_TRANSITIONS } from "./reopening.js";

const DEFAULT_CONSTRAINTS: WorkflowJobConstraints = {
  maxStages: MAX_WORKFLOW_STAGES_PER_JOB,
  maxBatches: MAX_WORKFLOW_BATCHES_PER_JOB,
  maxOperations: MAX_WORKFLOW_OPERATIONS_PER_BATCH * MAX_WORKFLOW_BATCHES_PER_JOB,
};

const CONSTRAINT_BOUNDS = [
  ["maxStages", MAX_WORKFLOW_STAGES_PER_JOB],
  ["maxBatches", MAX_WORKFLOW_BATCHES_PER_JOB],
  ["maxOperations", MAX_WORKFLOW_BATCHES_PER_JOB * MAX_WORKFLOW_OPERATIONS_PER_BATCH],
] as const;

function assertConstraints(constraints: WorkflowJobConstraints): void {
  for (const [name, bound] of CONSTRAINT_BOUNDS) {
    const value = constraints[name];
    assert(Number.isInteger(value) && value > 0 && value <= bound, "LIMIT_EXCEEDED", `Job ${name} is outside the bounded range.`);
  }
}

function releasePriorJob(next: MutableWorkflowState): void {
  if (next.activeJobId === null) return;
  const prior = next.jobs[next.activeJobId];
  assert(prior !== undefined, "WRONG_OWNER", "The active workflow job is missing.");
  releaseActiveJobIfSafe(next, prior.jobId);
}

const openJob: Transition<"job.opened"> = (next, event) => {
  id(event.jobId, "jobId");
  assert(event.engineId === WORKFLOW_ENGINE_ID, "ILLEGAL_TRANSITION", `Only ${WORKFLOW_ENGINE_ID} may open a workflow job.`);
  boundedText(event.title, "title", MAX_WORKFLOW_TITLE_LENGTH);
  boundedText(event.goalSummary, "goalSummary", MAX_WORKFLOW_GOAL_LENGTH);
  releasePriorJob(next);
  assert(next.activeJobId === null, "DISPATCH_LANE_BUSY", "A prior workflow job still owns unsettled host work.");
  assert(next.activeDispatchLease === null, "DISPATCH_LANE_BUSY", "A host dispatch lease is still active even though its workflow owner is unavailable.");
  assert(!next.jobs[event.jobId], "ILLEGAL_TRANSITION", `Job ${event.jobId} already exists.`);
  assert(Object.keys(next.jobs).length < MAX_WORKFLOW_JOBS, "LIMIT_EXCEEDED", "The workflow job limit has been reached.");
  const constraints = event.constraints ?? DEFAULT_CONSTRAINTS;
  assertConstraints(constraints);
  const value: WorkflowJob = {
    jobId: event.jobId,
    engineId: WORKFLOW_ENGINE_ID,
    title: event.title,
    goalSummary: event.goalSummary,
    constraints: clone(constraints),
    successCriteria: criteria(event.successCriteria, "job success criteria"),
    satisfiedCriteria: {},
    status: "open",
    stageIds: [],
    batchIds: [],
    cancellationRequested: false,
    undoOpened: false,
    providerCycle: 0,
    automaticRepairReopens: 0,
    blocker: null,
    createdAt: event.at,
    updatedAt: event.at,
  };
  next.jobs = setRecord(next.jobs, event.jobId, value);
  next.activeJobId = event.jobId;
  return next;
};

const openUndo: Transition<"job.undoOpened"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  assert(currentJob.status === "completed", "ILLEGAL_TRANSITION", "Only a completed job may open a guarded undo session.");
  assert(next.activeJobId === null, "DISPATCH_LANE_BUSY", "Another job still owns the workflow engine.");
  assert(currentJob.batchIds.some((batchId) => next.batches[batchId]?.recovery.state === "available"), "ILLEGAL_TRANSITION", "The completed job has no safely undoable mutation.");
  next.activeJobId = event.jobId;
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, undoOpened: true, updatedAt: event.at });
  return next;
};

const blockJob: Transition<"job.blocked"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  boundedText(event.reason, "blocker", MAX_WORKFLOW_SUMMARY_LENGTH);
  assert(currentJob.status !== "completed" && currentJob.status !== "cancelled", "ILLEGAL_TRANSITION", "A terminal job cannot be blocked.");
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, status: "blocked", blocker: event.reason, updatedAt: event.at });
  for (const stageId of currentJob.stageIds) {
    const currentStage = next.stages[stageId];
    if (currentStage && currentStage.status !== "completed" && currentStage.status !== "cancelled") next.stages = setRecord(next.stages, stageId, { ...currentStage, status: "blocked", updatedAt: event.at });
  }
  releaseActiveJobIfSafe(next, event.jobId);
  return next;
};

const closeProviderCycle: Transition<"job.providerCycleClosed"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  assert(Number.isInteger(event.cycle) && event.cycle === currentJob.providerCycle + 1, "ILLEGAL_TRANSITION", "Provider cycles must advance exactly once in monotonic order.");
  assert(event.cycle <= MAX_WORKFLOW_PROVIDER_CYCLES, "LIMIT_EXCEEDED", "The workflow provider-cycle limit has been reached.");
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, providerCycle: event.cycle, updatedAt: event.at });
  return next;
};

const keepState = (next: MutableWorkflowState): MutableWorkflowState => next;

const openStage: Transition<"stage.opened"> = (next, event) => {
  const currentJob = job(next, event.jobId);
  id(event.stageId, "stageId");
  boundedText(event.title, "title", MAX_WORKFLOW_TITLE_LENGTH);
  const purpose = boundedText(event.purpose, "stage purpose", MAX_WORKFLOW_SUMMARY_LENGTH);
  const successCriteria = criteria(event.successCriteria, "stage success criteria");
  assert(!next.stages[event.stageId], "ILLEGAL_TRANSITION", `Stage ${event.stageId} already exists.`);
  assertProgressAllowed(currentJob);
  assert(currentJob.stageIds.length < currentJob.constraints.maxStages, "LIMIT_EXCEEDED", "The job stage limit has been reached.");
  const value: WorkflowStage = { stageId: event.stageId, jobId: event.jobId, title: event.title, purpose, successCriteria, satisfiedCriteria: {}, status: "active", batchIds: [], createdAt: event.at, updatedAt: event.at };
  next.stages = setRecord(next.stages, event.stageId, value);
  next.jobs = setRecord(next.jobs, event.jobId, { ...currentJob, status: "active", stageIds: [...currentJob.stageIds, event.stageId], updatedAt: event.at });
  return next;
};

/**
 * Job and stage authoring. The provider-cycle cap (MAX_WORKFLOW_PROVIDER_CYCLES) is enforced when a cycle closes;
 * provider failures are recorded in the event log only and leave the state untouched.
 */
export const AUTHORING_TRANSITIONS = {
  "job.opened": openJob,
  "job.undoOpened": openUndo,
  "job.blocked": blockJob,
  "job.providerCycleClosed": closeProviderCycle,
  "job.providerFailureRecorded": keepState,
  "job.providerFailureCleared": keepState,
  "stage.opened": openStage,
  ...REOPENING_TRANSITIONS,
} satisfies TransitionSlice;
