// Stop from the panel: one request that ends whatever the sidecar is running, whichever state the job is in.
import type { Translate } from "@extynt/ui-text";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { translatorOf } from "./ui-language.js";

type StopDeps = Pick<HttpRoutesDeps, "state" | "dispatch">;
type StopOutcome = "stopped" | "already-finished" | "nothing-running";
interface StopResult { outcome: StopOutcome; jobId: string | null; prior: string; turnAborted: boolean; continuationCancelled: boolean; message: string }

const FINISHED = new Set(["completed", "cancelled"]);

function liveJobIds(deps: StopDeps): string[] {
  const { state } = deps, coordinator = state.workflowCoordinator, store = coordinator.workflowStore.getState();
  const ids = new Set<string>();
  if (store.activeJobId) ids.add(store.activeJobId);
  for (const run of state.workflowRuns.values()) if (run.state !== "terminal") ids.add(run.jobId);
  const turn = state.activeChatTurn;
  if (turn?.jobId) ids.add(turn.jobId);
  if (turn) { const seeded = coordinator.jobIdForSeed(turn.requestId); if (store.jobs[seeded]) ids.add(seeded); }
  return [...ids].filter((id) => { const job = store.jobs[id]; return !!job && !FINISHED.has(job.status); });
}

function turnBelongsTo(deps: StopDeps, jobId: string): boolean {
  const { state } = deps, turn = state.activeChatTurn;
  if (!turn) return false;
  const coordinator = state.workflowCoordinator;
  return turn.jobId === jobId || coordinator.jobIdForSeed(turn.requestId) === jobId || state.workflowRuns.get(jobId)?.requestId === turn.requestId || coordinator.resumeContext(jobId).requestId === turn.requestId;
}

type JobStore = ReturnType<StopDeps["state"]["workflowCoordinator"]["workflowStore"]["getState"]>;
interface JobStop { prior: string; continuation: boolean; aborted: boolean; cancelled: boolean }

function abortOpenTurn(deps: StopDeps, reason: string): boolean {
  const turn = deps.state.activeChatTurn;
  if (!turn || turn.controller.signal.aborted) return false;
  turn.controller.abort(new Error(reason));
  return true;
}

function priorState(job: JobStore["jobs"][string] | undefined, run: ReturnType<StopDeps["state"]["workflowRuns"]["get"]>): string {
  return `${job?.status ?? "unknown"}/${run?.state ?? "no-run"}`;
}

function stopJob(deps: StopDeps, store: JobStore, jobId: string): JobStop {
  const job = store.jobs[jobId], run = deps.state.workflowRuns.get(jobId);
  const prior = priorState(job, run);
  const continuation = !!run && run.state !== "terminal";
  const aborted = turnBelongsTo(deps, jobId) && abortOpenTurn(deps, "the job was stopped");
  const cancelled = !!job && !FINISHED.has(job.status);
  if (cancelled) deps.dispatch.cancelWorkflowJob(jobId);
  return { prior, continuation, aborted, cancelled };
}

function finishedJobStatus(store: JobStore, named: string | null): string | undefined {
  if (named === null || !FINISHED.has(store.jobs[named]?.status ?? "")) return undefined;
  return store.jobs[named]?.status ?? "unknown";
}

function stopOutcome({ turnAborted, cancelled, continuationCancelled, finished }: { turnAborted: boolean; cancelled: number; continuationCancelled: boolean; finished: boolean }): StopOutcome {
  if (turnAborted || cancelled > 0 || continuationCancelled) return "stopped";
  return finished ? "already-finished" : "nothing-running";
}

function priorOf(stops: readonly JobStop[], finishedStatus: string | undefined): string {
  return stops.length ? stops.map((stop) => stop.prior).join(",") : finishedStatus ?? "none";
}

function namedJob(store: JobStore, requestedJobId: string | null): string | null {
  return requestedJobId && store.jobs[requestedJobId] ? requestedJobId : null;
}

function stopMessage(t: Translate, outcome: StopOutcome): string {
  if (outcome === "stopped") return t("failure.stop.stopped");
  return t(outcome === "already-finished" ? "failure.stop.alreadyFinished" : "failure.stop.nothingRunning");
}

/** Cancels the job in whatever state it is in (running, between cycles, blocked, waiting for a receipt, scheduled) and aborts the turn that works on it. Idempotent. */
export function stopWork(deps: StopDeps, requestedJobId: string | null): StopResult {
  const { state } = deps, store = state.workflowCoordinator.workflowStore.getState();
  const named = namedJob(store, requestedJobId);
  const targets = named ? [named] : liveJobIds(deps);
  const stops = targets.map((jobId) => stopJob(deps, store, jobId));
  const cancelled = stops.filter((stop) => stop.cancelled).length;
  const continuationCancelled = stops.some((stop) => stop.continuation);
  const turnAborted = stops.some((stop) => stop.aborted) || (!named && abortOpenTurn(deps, "the turn was stopped"));
  const finishedStatus = cancelled === 0 ? finishedJobStatus(store, named) : undefined;
  const outcome = stopOutcome({ turnAborted, cancelled, continuationCancelled, finished: finishedStatus !== undefined });
  const priorText = priorOf(stops, finishedStatus);
  const jobId = named ?? targets[0] ?? null;
  state.eventLog("job.stop", { jobId, prior: priorText, outcome, turnAborted, continuationCancelled, requested: requestedJobId !== null });
  return { outcome, jobId, prior: priorText, turnAborted, continuationCancelled, message: stopMessage(translatorOf(state), outcome) };
}
