// The routes through which the panel reports what After Effects holds: health, the stored snapshot, probe snapshots and the host census.
import { jsonValue } from "@extynt/decode";

import { jsonBody, type BodySpec, type Refusal } from "./server-route-body.js";
import { precheckPlanId } from "./apply-precheck.js";
import { healthOf } from "./server-health.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { isPairedPanel } from "./server-paired-panel.js";
import { acceptCensus, storeProbeSnapshot } from "./server-receiver-cores.js";
import { outcomeReply } from "./server-route-outcome.js";
import { bodyRoute, ok, refuse, route, type Exchange, type MountedRoute } from "./server-route-table.js";
import { probeSnapshot, type ProbeSnapshot } from "./server-probe-wire.js";

const MAX_CENSUS_BYTES = 2_000_000;

const INVALID_SNAPSHOT: Refusal = { status: 422, code: "INVALID_SNAPSHOT", message: "Expected a successful schema 0.1 CEP probe snapshot." };
const SNAPSHOT_NOT_JSON: Refusal = { status: 400, code: "INVALID_JSON", message: "Snapshot body must be valid JSON." };
const UNPAIRED_SNAPSHOT: Refusal = { status: 409, code: "STALE_PANEL_INSTANCE", message: "This snapshot came from an unpaired panel instance. Pair again before publishing." };
const CENSUS_TOO_LARGE: Refusal = { status: 413, code: "BODY_LIMIT", message: "Host census exceeded the limit." };
const CENSUS_NOT_JSON: Refusal = { status: 400, code: "INVALID_JSON", message: "Host census must be valid JSON." };

function snapshotBody(deps: HttpRoutesDeps): BodySpec<ProbeSnapshot> {
  return {
    ...jsonBody(probeSnapshot, deps.state.maxBodyBytes, INVALID_SNAPSHOT, { notJson: SNAPSHOT_NOT_JSON }),
    phases: { read: "snapshot.body", parse: "snapshot.parse", validate: "snapshot.validate" },
  };
}

function countedSnapshotPost(deps: HttpRoutesDeps, exchange: Exchange): Refusal | null {
  deps.state.snapshotPostCount += 1;
  const paired = !deps.state.activePanelInstanceId || isPairedPanel(deps.state, exchange.request);
  return paired ? null : UNPAIRED_SNAPSHOT;
}

/** The health report, the latest stored snapshot, the intake of probe snapshots (a precheck read names its plan in the query) and of the host census. */
export const snapshotRoutes: readonly MountedRoute[] = [
  route({
    method: "GET",
    path: "/health",
    handle: ({ deps, request, context }) => {
      const startedAt = deps.dispatch.beginPhase(context, "health");
      const health = healthOf(deps, request);
      deps.dispatch.endPhase(context, "health", startedAt, { outcome: "succeeded" });
      return ok(health);
    },
  }),
  route({
    method: "GET",
    path: "/v1/snapshots/latest",
    handle: ({ deps }) => {
      const latest = deps.state.latest;
      if (!latest) return refuse(404, "NO_SNAPSHOT", "No CEP probe snapshot has been received.");
      return { ...ok({ ok: true, receivedAt: latest.receivedAt, bytes: latest.bytes, snapshot: latest.snapshot }), bytes: latest.bytes };
    },
  }),
  bodyRoute({
    method: "POST",
    path: "/v1/snapshots",
    guard: countedSnapshotPost,
    body: snapshotBody,
    handle: ({ deps, request, context, body, bytes }) => {
      context.requestId = body.requestId;
      const storeStartedAt = deps.dispatch.beginPhase(context, "snapshot.store");
      const planId = precheckPlanId(request);
      const outcome = storeProbeSnapshot(deps, body, { bytes, ...(planId === undefined ? {} : { purpose: "precheck" as const, planId }) });
      deps.dispatch.endPhase(context, "snapshot.store", storeStartedAt, { outcome: outcome.outcome, bytes, ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}) });
      return { ...outcomeReply(outcome), bytes };
    },
  }),
  bodyRoute({
    method: "POST",
    path: "/v1/host-census",
    body: (deps) => ({ ...jsonBody(jsonValue, Math.min(deps.state.maxBodyBytes, MAX_CENSUS_BYTES), CENSUS_NOT_JSON, { tooLarge: CENSUS_TOO_LARGE, notJson: CENSUS_NOT_JSON }) }),
    handle: ({ deps, context, body, bytes }) => {
      const outcome = acceptCensus(deps, body, bytes);
      const requestId = outcome.body.requestId;
      if (typeof requestId === "string") context.requestId = requestId;
      return { ...outcomeReply(outcome), bytes };
    },
  }),
];
