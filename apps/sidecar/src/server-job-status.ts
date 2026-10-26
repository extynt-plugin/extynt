// The answer to GET /v1/workflow/status: the workflow projection of one job (or all), what resuming it would do, and why it is paused.
import type { WorkflowContinuationInput } from "@extynt/workflow";

import type { HttpRoutesDeps } from "./server-http-state.js";
import { currentWindowCapPause } from "./server-workflow-continuation-ownership.js";

type WorkflowState = ReturnType<HttpRoutesDeps["state"]["workflowCoordinator"]["workflowStore"]["getState"]>;
type WorkflowJob = WorkflowState["jobs"][string];
type WorkflowRun = ReturnType<HttpRoutesDeps["state"]["workflowRuns"]["get"]>;
type JobProgress = ReturnType<HttpRoutesDeps["state"]["workflowCoordinator"]["projection"]>["jobs"][number]["progress"];

const NO_PROGRESS_YET = { totalBatches: 0, settledBatches: 0, verifiedBatches: 0, appliedUnverifiedBatches: 0, uncertainBatches: 0, undoCompleted: 0 } as const;

function continuationOf(deps: HttpRoutesDeps, jobId: string | null | undefined): WorkflowContinuationInput | null {
  const latest = deps.dispatch.normalizedLatest();
  if (!jobId || !latest) return null;
  try {
    return deps.state.workflowCoordinator.continuation(jobId, { fingerprint: latest.fingerprint, revision: latest.revision }, 0);
  } catch {
    return null;
  }
}

function runFlags(run: WorkflowRun): { automatic: boolean; autoApply: boolean; pendingBatchId: string | null } {
  return { automatic: !!run && run.state !== "terminal", autoApply: run?.autoApply === true, pendingBatchId: run?.pendingBatchId ?? null };
}

function resumeOf(job: WorkflowJob | undefined, run: WorkflowRun, progress: JobProgress | undefined) {
  if (!job) return null;
  const satisfied = Object.keys(job.satisfiedCriteria).length;
  return {
    status: run?.state ?? job.status,
    ...runFlags(run),
    applied: progress ?? { ...NO_PROGRESS_YET, criteria: { total: job.successCriteria.length, satisfied } },
    remaining: { criteria: Math.max(0, job.successCriteria.length - satisfied), batches: Math.max(0, job.constraints.maxBatches - job.batchIds.length) },
    whyPaused: job.blocker,
    needsInput: job.status === "blocked" && !run,
  };
}

/** The status of `requestedJobId`, or of the active job when none is named. */
export function jobStatusOf(deps: HttpRoutesDeps, requestedJobId: string | undefined) {
  const state = deps.state.workflowCoordinator.workflowStore.getState();
  const jobId = requestedJobId ?? state.activeJobId;
  const projection = deps.state.workflowCoordinator.projection(requestedJobId, continuationOf(deps, jobId));
  const job = state.jobs[jobId ?? ""];
  const run = jobId ? deps.state.workflowRuns.get(jobId) : undefined;
  const progress = job ? projection.jobs.find((entry) => entry.jobId === job.jobId)?.progress : undefined;
  return { ok: true, projection, resume: resumeOf(job, run, progress), pause: currentWindowCapPause(deps.state) };
}
