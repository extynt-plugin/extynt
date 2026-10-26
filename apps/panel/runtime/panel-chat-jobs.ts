/** Follows the job the sidecar reports when no request of this panel is open for it: plans it lands, its end, and the composer's state. */
import { catchUpClosing, noteClosingOwner } from "./panel-closing.js";
import { setComposerBusy } from "./panel-composer.js";
import { clearEndedJob, endedJob, followJob, followedJob, lastSeenJob, rememberJob, runningJob, setEndedJob, setLiveProgress, stopNote } from "./panel-progress.js";
import { landPlans, refreshPlans } from "./panel-plans.js";
import { getCurrentSessionId, sessionOfRequest, setTurnSessionId, turnSessionId } from "./panel-sessions.js";
import { touchStatus } from "./panel-status-signal.js";
import { isChatInFlight } from "./panel-turn.js";
import type { UiJob } from "./ui-jobs.js";

let landed = "";
let hadJob = false;

function ownerOf(job: UiJob) {
  return sessionOfRequest(job.requestId) ?? getCurrentSessionId();
}

function claimOwner(job: UiJob | null): void {
  if (job && !followedJob() && !isChatInFlight()) setTurnSessionId(ownerOf(job));
}

function landJobPlans(job: UiJob | null): void {
  const signature = job ? job.plans.join(",") : "";
  if (signature === landed) return;
  landed = signature;
  if (job) {
    landPlans(job.plans);
    refreshPlans();
  }
}

function appliedAnyPlan(job: UiJob): boolean {
  return job.plansApplied > 0;
}

function jobEnded(): void {
  const last = lastSeenJob();
  const stopped = stopNote();
  if (!isChatInFlight()) setLiveProgress(null);
  if (!last || (stopped && stopped.phase !== "failed")) return;
  if (last.via === "apply-resume") catchUpClosing(last.requestId);
  const owner = ownerOf(last);
  if (appliedAnyPlan(last) && owner !== null) setEndedJob(last, owner);
}

function followRunning(job: UiJob): void {
  if (job.via === "apply-resume") noteClosingOwner(job.requestId, getCurrentSessionId());
  if (!followedJob()) {
    setComposerBusy(true);
    setTurnSessionId(turnSessionId() ?? ownerOf(job));
  }
  followJob(job);
  touchStatus();
}

function follow(job: UiJob | null): void {
  if ((isChatInFlight() && !followedJob()) || (!job && !followedJob())) {
    touchStatus();
    return;
  }
  if (job) {
    followRunning(job);
    return;
  }
  followJob(null);
  setTurnSessionId(null);
  setComposerBusy(false);
  refreshPlans();
}

/** Follows the running job, lands its plans, sums up one that ended, and lets go when it is over. A reloaded panel follows a running job the same way. */
export function syncJobs(): void {
  const job = runningJob();
  rememberJob(job);
  claimOwner(job);
  landJobPlans(job);
  const ended = hadJob && job === null;
  hadJob = job !== null;
  if (ended) jobEnded();
  const current = getCurrentSessionId();
  if (job && endedJob(current) !== null) clearEndedJob(current);
  follow(job);
}
