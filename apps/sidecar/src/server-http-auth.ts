// Who may call the sidecar: the session bearer token, the panel instance that paired, and the response headers every answer carries.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { nativeMutationQuarantine } from "./native-mutation-lease.js";
import { freshSchedulerMemory } from "./read-scheduler.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { suppliedPanel } from "./server-paired-panel.js";
import { errorEnvelope, headerId } from "./server-http-wire.js";
import type { RequestContext } from "./server-types.js";

/** No Access-Control-* header is ever set: the panel is served by this sidecar (same origin), and no other web page may call a loopback service that holds the user's project. */
export function configureResponse(response: ServerResponse, correlationId: string): void {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-AE-Correlation-Id", correlationId);
}

/** Whether the request carries the session's bearer token, compared in constant time (the plugin side does the same). */
export function bearerMatches(request: Pick<IncomingMessage, "headers">, token: string): boolean {
  const given = Buffer.from(String(request.headers.authorization ?? "")), wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The first native-access quarantine in force, whichever lease or flight holds it. */
export function nativeQuarantineOf(state: HttpRoutesDeps["state"]): ReturnType<HttpRoutesDeps["state"]["nativeBridge"]["accessQuarantine"]> {
  return state.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(state.inFlight) ?? state.collection.nativeAccessQuarantine();
}

function retirePredecessorNativeState(deps: HttpRoutesDeps, panelInstanceId: string): void {
  try {
    const released = deps.state.nativeBridge.releaseForNewOwner(panelInstanceId);
    if (released.released) deps.dispatch.logPlanEvent("plan.native-lease-owner-replaced", { kind: released.kind ?? null, logicalOwner: released.logicalOwner?.id ?? null });
  } catch {
    deps.dispatch.logPlanEvent("plan.native-lease-release-failed", {});
  }
  const flight = deps.state.inFlight;
  if (flight?.nativeSettlement === "unknown") deps.state.releaseNativeFlight(flight.id);
}

function adoptPanel(deps: HttpRoutesDeps, panelInstanceId: string): void {
  const { state } = deps;
  state.collection.pair(panelInstanceId);
  retirePredecessorNativeState(deps, panelInstanceId);
  state.activePanelInstanceId = panelInstanceId;
  state.panelBuild = null;
  state.awaitingFreshSnapshotAfterPair = true;
  state.latest = undefined;
  state.pendingPanelReset = true;
  state.liveStamp = null;
  state.readScheduler = freshSchedulerMemory();
  state.issuedReads.clear();
}

/** Pairs the calling panel instance when it carries the bearer token and names an instance not yet paired, and says what the panel needs to know about the pairing. */
export function pairing(deps: HttpRoutesDeps, request: IncomingMessage) {
  const paired = bearerMatches(request, deps.state.options.token);
  const panelInstanceId = paired ? suppliedPanel(request) : null;
  if (panelInstanceId && panelInstanceId !== deps.state.activePanelInstanceId) adoptPanel(deps, panelInstanceId);
  const quarantine = nativeQuarantineOf(deps.state);
  return { ok: true, port: deps.state.port ?? null, paired, nativeMutationQuarantine: quarantine, nativeAccessQuarantine: quarantine, awaitingFreshSnapshot: deps.state.awaitingFreshSnapshotAfterPair };
}

/** Checks the bearer token inside the authentication phase and answers 401 when it is missing or wrong. */
export function authenticated(deps: HttpRoutesDeps, exchange: { readonly request: IncomingMessage; readonly response: ServerResponse; readonly context: RequestContext }): boolean {
  const { request, response, context } = exchange;
  const startedAt = deps.dispatch.beginPhase(context, "authentication");
  if (bearerMatches(request, deps.state.options.token)) {
    deps.dispatch.endPhase(context, "authentication", startedAt, { outcome: "succeeded" });
    return true;
  }
  deps.dispatch.endPhase(context, "authentication", startedAt, { outcome: "rejected", statusCode: 401, errorCode: "UNAUTHORIZED" });
  deps.dispatch.respond({ response, context, statusCode: 401, value: errorEnvelope("UNAUTHORIZED", "Supply the bridge session bearer token."), outcome: "rejected", errorCode: "UNAUTHORIZED" });
  request.resume();
  return false;
}

/** The paired panel's build, remembered from whichever of its requests carries it; a request without the paired instance header (curl, the MCP) never changes it. */
export function rememberPanelBuild(deps: HttpRoutesDeps, request: IncomingMessage): void {
  if (!bearerMatches(request, deps.state.options.token)) return;
  const instance = suppliedPanel(request), build = headerId(request.headers["x-ae-panel-build"]);
  if (!instance || !build || instance !== deps.state.activePanelInstanceId) return;
  deps.state.panelBuild = build;
}
