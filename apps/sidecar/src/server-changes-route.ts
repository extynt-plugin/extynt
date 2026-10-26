// The panel's changes route: what the agent changed in the project that is open now, and whether each change can still be undone.
import { readStampOf } from "./host/facts.js";
import { activityFor } from "./server-activity.js";
import { CHANGE_HISTORY_LIMIT, changeHistory } from "./server-change-history.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { ok, route, type MountedRoute } from "./server-route-table.js";
import { translatorOf } from "./ui-language.js";

function currentHistory(deps: HttpRoutesDeps) {
  const latest = deps.dispatch.normalizedLatest();
  const { hostFacts: facts, liveStamp: live, workflowCoordinator: workflow } = deps.state;
  return changeHistory({
    plans: deps.state.plans, project: latest ? latest.project : null, currentFingerprint: latest ? latest.fingerprint : null, limit: CHANGE_HISTORY_LIMIT,
    facts: { sources: facts.planSources, seenAt: facts.changesSeenAt, afterStamps: facts.afterStamps, live: live ? { epoch: live.epoch, revision: live.revision } : null, readAt: readStampOf(deps.state.latest), workflow: (planId) => ({ jobId: workflow.jobIdForPlan(planId), batch: workflow.batchIdForPlan(planId) }), designerPlans: activityFor(deps.state).designerPlans, translate: translatorOf(deps.state) },
  });
}

/** `GET /v1/changes`. Read only: it asks the same undo checks as `ae_undo_plan` and changes nothing. */
export const changesRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/changes", handle: ({ deps }) => ok({ ok: true, ...currentHistory(deps), writeAuthorizing: false }) }),
];
