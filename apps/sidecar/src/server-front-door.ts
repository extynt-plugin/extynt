// The front door of the sidecar: every request meets the loopback, Host and CORS checks, then static pages, then the route table behind the session token.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { authenticated, configureResponse, rememberPanelBuild } from "./server-http-auth.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { ROUTES } from "./server-routes.js";
import { findRoute, type Exchange } from "./server-route-table.js";
import { hostAllowed, isUiStaticPath, refuseHost, serveUiStatic } from "./server-ui-static.js";
import { diagnosticMethod, diagnosticRoute, errorEnvelope, headerId, isLoopback } from "./server-http-wire.js";
import type { RequestContext } from "./server-types.js";

interface Door {
  readonly deps: HttpRoutesDeps;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly context: RequestContext;
}

function refuse(door: Door, status: number, code: string, message: string): true {
  const { deps, request, response, context } = door;
  deps.dispatch.respond({ response, context, statusCode: status, value: errorEnvelope(code, message), outcome: "rejected", errorCode: code });
  request.resume();
  return true;
}

function refuseNonLoopback(door: Door): boolean {
  const { deps, request, context } = door;
  if (isLoopback(request.socket.remoteAddress)) return false;
  const startedAt = deps.dispatch.beginPhase(context, "authentication");
  deps.dispatch.endPhase(context, "authentication", startedAt, { outcome: "rejected", statusCode: 403, errorCode: "FORBIDDEN" });
  return refuse(door, 403, "FORBIDDEN", "The sidecar accepts loopback connections only.");
}

function refuseForeignHost(door: Door): boolean {
  const { deps, request, response, context } = door;
  if (hostAllowed(deps.state, request)) return false;
  request.resume();
  refuseHost(deps, response, context);
  return true;
}

function answerPreflight(door: Door): boolean {
  if (door.request.method !== "OPTIONS") return false;
  door.deps.state.preflightCount += 1;
  return refuse(door, 403, "CORS_NOT_SUPPORTED", "Only this sidecar's own pages may call it; cross-origin requests are not accepted.");
}

function contextOf(request: IncomingMessage): RequestContext {
  return {
    correlationId: headerId(request.headers["x-ae-correlation-id"]) ?? `corr-${randomUUID()}`,
    requestId: headerId(request.headers["x-ae-request-id"]),
    method: diagnosticMethod(request.method),
    route: "/unknown",
    startedAt: Date.now(),
  };
}

function urlOf(deps: HttpRoutesDeps, request: IncomingMessage, context: RequestContext): URL {
  const startedAt = deps.dispatch.beginPhase(context, "route");
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  context.route = diagnosticRoute(url.pathname);
  deps.dispatch.endPhase(context, "route", startedAt, { outcome: "succeeded" });
  return url;
}

async function serveRoute(door: Door, url: URL): Promise<void> {
  const { deps, request, response, context } = door;
  const found = findRoute(ROUTES, request.method ?? "", url.pathname);
  const exchange: Exchange = { request, response, context, url };
  if (found?.route.open) await found.route.serve(deps, exchange, found.param);
  else if (authenticated(deps, door)) {
    rememberPanelBuild(deps, request);
    if (found) await found.route.serve(deps, exchange, found.param);
    else refuse(door, 404, "NOT_FOUND", "Unknown read-only sidecar endpoint.");
  }
}

/** Answers one request: refusals at the door first, then static pages, then the route table (open routes before the token check, the rest after it), then 404. */
export async function handleRequest(deps: HttpRoutesDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const context = contextOf(request);
  deps.dispatch.emit(context, "request", "request.started", { outcome: "started" });
  configureResponse(response, context.correlationId);
  const url = urlOf(deps, request, context);
  const door: Door = { deps, request, response, context };
  if (refuseNonLoopback(door) || refuseForeignHost(door) || answerPreflight(door)) return;
  if (isUiStaticPath(url.pathname)) await serveUiStatic(deps, request, response, context);
  else await serveRoute(door, url);
}
