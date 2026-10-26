// Archive planning: which terminal jobs leave the live event log so it stays within its byte budget.

import type { WorkflowEvent } from "./events.js";
import type { WorkflowId } from "./identity.js";
import type { WorkflowBatch, WorkflowJob, WorkflowState } from "./state-types.js";

/** The slice of workflow state archiving reads. */
export interface ArchiveView {
  readonly activeJobId: WorkflowState["activeJobId"];
  readonly jobs: Readonly<Record<WorkflowId, Pick<WorkflowJob, "jobId" | "status" | "updatedAt" | "batchIds">>>;
  readonly batches: Readonly<Record<WorkflowId, { readonly lifecycle: WorkflowBatch["lifecycle"]; readonly recovery: Pick<WorkflowBatch["recovery"], "dispatch" | "state"> }>>;
}

const RETAINED_TERMINAL_JOBS = 4;
const COMPACTION_TARGET_BYTES = 96 * 1024;
const ARCHIVABLE_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "blocked"]);
const PENDING_LIFECYCLES: ReadonlySet<string> = new Set(["queued", "claimed", "executing"]);

/** Whether a job is terminal, not the active job, and has no batch that could still dispatch or recover. */
export function archivable(view: ArchiveView, jobId: WorkflowId): boolean {
  const job = view.jobs[jobId];
  if (!job || job.jobId === view.activeJobId || !ARCHIVABLE_STATUSES.has(job.status)) return false;
  return job.batchIds.every((batchId) => {
    const batch = view.batches[batchId];
    return !!batch && batch.recovery.dispatch === "idle" && batch.recovery.state !== "requested" && !PENDING_LIFECYCLES.has(batch.lifecycle);
  });
}

function archivableNewestFirst(view: ArchiveView, events: readonly WorkflowEvent[]): WorkflowId[] {
  const lastEventIndex = new Map<WorkflowId, number>();
  events.forEach((event, index) => lastEventIndex.set(event.jobId, index));
  const updatedAt = (jobId: WorkflowId): string => view.jobs[jobId]?.updatedAt ?? "";
  return Object.keys(view.jobs)
    .filter((jobId) => archivable(view, jobId))
    .sort((left, right) => updatedAt(right).localeCompare(updatedAt(left)) || (lastEventIndex.get(right) ?? -1) - (lastEventIndex.get(left) ?? -1));
}

/** Plans which jobs to archive to stay within the byte budget: the newest terminal job is always kept however large, because a blocked job is retried or continued from there and archiving it mid-turn would leave the cycle closing a job that no longer exists. */
export function planArchive(view: ArchiveView, events: readonly WorkflowEvent[]): Set<WorkflowId> {
  const archivableIds = archivableNewestFirst(view, events);
  const result = new Set(archivableIds.slice(RETAINED_TERMINAL_JOBS));
  const retainedIds = archivableIds.slice(0, RETAINED_TERMINAL_JOBS);
  for (let index = retainedIds.length - 1; index >= 1; index -= 1) {
    const retainedEvents = events.filter((event) => !result.has(event.jobId));
    if (Buffer.byteLength(JSON.stringify(retainedEvents), "utf8") <= COMPACTION_TARGET_BYTES) break;
    const jobId = retainedIds[index];
    if (jobId) result.add(jobId);
  }
  return result;
}
