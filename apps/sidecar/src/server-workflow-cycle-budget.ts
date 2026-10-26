// The automatic cycle budget of one workflow job: pure stall, ceiling and clock decisions over the job's progress mark, and the thin shell that gathers their facts.
import { MAX_WORKFLOW_PROVIDER_CYCLES, type WorkflowId } from "@extynt/workflow";
import { doneCount, type ChecklistView } from "./server-workflow-checklist.js";
import { pendingRecheck, type SidecarActionHost } from "./server-workflow-sidecar-actions.js";

/** The slice of workflow state progress is read from; the full WorkflowState satisfies it. */
export type ProgressView = {
  readonly jobs: Readonly<Record<string, { readonly batchIds: readonly string[]; readonly stageIds: readonly string[] } | undefined>>;
  readonly batches: ChecklistView["batches"];
  readonly stages: Readonly<Record<string, { readonly status: string } | undefined>>;
};

/**
 * A job runs on its own for as long as it keeps landing work: length is never the limit, a lack of progress is.
 * It pauses (applied work kept, the user's "continue" resumes it) when it goes STALL_CYCLES cycles without a newly
 * applied batch or completed stage, or when it passes the cycle ceiling counted from the user's last go-ahead. The
 * wall clock is the user's limit and stays a stop.
 */
export const STALL_CYCLES = 8;
/** Cycles without new work after which the model is told so; the pause at STALL_CYCLES comes after. */
export const STALL_FEEDBACK_CYCLES = 4;
/** Cycles one go-ahead may spend; a 2–4 hour film is roughly 100–250 cycles. */
export const AUTOMATIC_CYCLE_CEILING = 512;
/** The wall-clock span after which a go-ahead stops, whatever progress it made. */
export const AUTOMATIC_WALL_CLOCK_MS = 6 * 60 * 60 * 1000;

/** Why a cycle may not start on its own, and the cycle count the message names. */
export type CycleStop = { readonly kind: "stalled" | "ceiling" | "clock" | "hard"; readonly cycles: number };
/** Where the job last made progress, and where the user's last go-ahead started counting; `rechecks` counts the observation-only cycles the sidecar forced since the last progress, which author nothing and so are not stalls. */
export type ProgressMark = { progress: number; progressCycle: number; baseCycle: number; startedAt: number; rechecks?: number };

/** The slice of sidecar state the cycle budget reads and records into. */
export type CycleBudgetState = {
  readonly workflowProgressMarks: Map<WorkflowId, ProgressMark>;
  readonly now: () => Date;
  readonly workflowCycleCeiling: number;
  readonly workflowCoordinator: { readonly workflowStore: { getState(): ProgressView } };
  readonly workflowSidecarActions?: SidecarActionHost["workflowSidecarActions"];
  readonly options?: SidecarActionHost["options"];
};

type StopFacts = {
  readonly cycle: number;
  readonly mark: ProgressMark;
  readonly forcedRecheck: boolean;
  readonly ceiling: number;
  readonly elapsedMs: number;
};

function verifiedProgress(store: ProgressView, jobId: WorkflowId): number {
  const job = store.jobs[jobId];
  if (!job) return 0;
  const batches = job.batchIds.filter((id) => {
    const batch = store.batches[id];
    return batch?.execution.mutation === "applied" && batch.verification.state !== "failed";
  }).length;
  return batches + job.stageIds.filter((id) => store.stages[id]?.status === "completed").length;
}

function progressOf(state: CycleBudgetState, jobId: WorkflowId): number {
  const store = state.workflowCoordinator.workflowStore.getState();
  const items = state.workflowSidecarActions && state.options ? doneCount({ workflowSidecarActions: state.workflowSidecarActions, options: state.options }, jobId, store) : 0;
  return verifiedProgress(store, jobId) + items;
}

function forcedRecheck(state: CycleBudgetState, jobId: WorkflowId): boolean {
  return !!state.workflowSidecarActions && !!state.options && pendingRecheck({ workflowSidecarActions: state.workflowSidecarActions, options: state.options }, jobId) !== undefined;
}

/** Why a cycle may not start on its own given the mark and the clock, or null when it may; the first cycle of a fresh job always may. */
export function decideCycleStop({ cycle, mark, forcedRecheck: recheckForced, ceiling, elapsedMs }: StopFacts): CycleStop | null {
  if (cycle === 0) return null;
  const stalled = cycle - mark.progressCycle - (mark.rechecks ?? 0) - (recheckForced ? 1 : 0);
  if (stalled >= STALL_CYCLES) return { kind: "stalled", cycles: stalled };
  if (cycle - mark.baseCycle >= ceiling) return { kind: "ceiling", cycles: cycle - mark.baseCycle };
  if (elapsedMs >= AUTOMATIC_WALL_CLOCK_MS) return { kind: "clock", cycles: cycle - mark.baseCycle };
  return null;
}

/** A sidecar-forced recheck cycle started: it authors nothing, so it does not count toward the stall budget. */
export function noteRecheckCycle(state: CycleBudgetState, jobId: WorkflowId | undefined): void {
  const mark = jobId ? state.workflowProgressMarks.get(jobId) : undefined;
  if (mark) mark.rechecks = (mark.rechecks ?? 0) + 1;
}

/** The user's go-ahead (a new job or a "continue") starts a fresh budget at this cycle. */
export function startCycleBudget(state: CycleBudgetState, jobId: WorkflowId, cycle: number): ProgressMark {
  const mark = { progress: progressOf(state, jobId), progressCycle: cycle, baseCycle: cycle, startedAt: state.now().getTime() };
  state.workflowProgressMarks.set(jobId, mark);
  return mark;
}

function markFor(state: CycleBudgetState, jobId: WorkflowId, cycle: number): ProgressMark {
  return state.workflowProgressMarks.get(jobId) ?? startCycleBudget(state, jobId, cycle);
}

function recordProgress(state: CycleBudgetState, jobId: WorkflowId, mark: ProgressMark, cycle: number): void {
  const progress = progressOf(state, jobId);
  if (progress <= mark.progress) return;
  mark.progress = progress;
  mark.progressCycle = cycle;
  mark.rechecks = 0;
}

/** Why a cycle at this index may not start on its own, or null when it may. Records new progress as it goes. */
export function automaticCycleStop(state: CycleBudgetState, jobId: WorkflowId | null, cycle: number): CycleStop | null {
  if (cycle + 1 > MAX_WORKFLOW_PROVIDER_CYCLES) return { kind: "hard", cycles: cycle };
  if (!jobId) return null;
  const mark = markFor(state, jobId, cycle);
  if (cycle === 0) return null;
  recordProgress(state, jobId, mark, cycle);
  return decideCycleStop({ cycle, mark, forcedRecheck: forcedRecheck(state, jobId), ceiling: state.workflowCycleCeiling, elapsedMs: state.now().getTime() - mark.startedAt });
}

/** Cycles since the job last landed work; call after automaticCycleStop, which records new progress. */
export function stalledCycles(state: CycleBudgetState, jobId: WorkflowId | null, cycle: number): number {
  const mark = jobId ? state.workflowProgressMarks.get(jobId) : undefined;
  return mark ? Math.max(0, cycle - mark.progressCycle - (mark.rechecks ?? 0)) : 0;
}

/** The sentence a stopped job reports: a pause says it can be resumed, the clock and the hard limit say they cannot. */
export function cycleStopMessage(stop: CycleStop): string {
  const kept = "Applied work is kept. Reply 'continue' to keep going.";
  switch (stop.kind) {
    case "stalled": return `The last ${stop.cycles} authoring cycles landed no new work in After Effects, so extynt paused rather than keep spending on a loop. ${kept}`;
    case "ceiling": return `This workflow ran ${stop.cycles} authoring cycles since your last go-ahead, so extynt paused to check in before spending more. ${kept}`;
    case "clock": return `This workflow reached the ${Math.round(AUTOMATIC_WALL_CLOCK_MS / 3_600_000)}-hour wall-clock limit since your last go-ahead, so extynt stopped it. Applied work is kept; send a new request to keep building.`;
    case "hard": return `This workflow reached the hard limit of ${MAX_WORKFLOW_PROVIDER_CYCLES} authoring cycles, which cannot be extended, so extynt stopped it. Applied work is kept; send a new request to keep building.`;
  }
}
