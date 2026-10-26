// The panel's host actions: a full read, an installed-effects census and a frame capture, each queued for the host lane and answered once the lane has delivered.
import type { ServerResponse } from "node:http";
import { literal, number, object, optional, string } from "@extynt/decode";
import { queueSnapshotRefresh, refreshPending } from "./read-queue.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { jsonBody, type Refusal } from "./server-route-body.js";
import { bodyRoute, ok, refuse, route, STREAMED, type MountedRoute } from "./server-route-table.js";
import { captureCommand, captureFinished, capturedFrame, compositionView, queueCapture } from "./server-ui-capture.js";
import { waitForState } from "./server-state-wait.js";
import { uiHostOf } from "./ui-host.js";
import { translatorOf } from "./ui-language.js";

const HOST_BODY_BYTES = 1024;
const READ_WAIT_MS = 15_000;
const CENSUS_WAIT_MS = 30_000;
const CAPTURE_WAIT_MS = 15_000;

const READ_INVALID: Refusal = { status: 422, code: "UI_HOST_READ_INVALID", message: 'The body is {"scope":"full"}.' };
const CAPTURE_INVALID: Refusal = { status: 422, code: "UI_HOST_CAPTURE_INVALID", message: "The body is {compositionId, time?}." };
const hostOffline = (deps: HttpRoutesDeps, what: "project" | "census") => refuse(409, "HOST_OFFLINE", translatorOf(deps.state)(what === "project" ? "failure.host.offlineProject" : "failure.host.offlineCensus"));

function hostGone(state: HttpRoutesDeps["state"]): boolean {
  const link = state.hostLink.status().state;
  return link === "offline" || link === "closing";
}

async function readProject(deps: HttpRoutesDeps, response: ServerResponse) {
  if (hostGone(deps.state)) return hostOffline(deps, "project");
  const before = deps.state.latest?.receivedAt, gone = new AbortController();
  response.once("close", () => gone.abort());
  queueSnapshotRefresh(deps.state, { reason: "explicit", read: { scope: "full" } });
  const refreshed = await waitForState(deps.state, () => deps.state.latest?.receivedAt !== before && !refreshPending(deps.state), READ_WAIT_MS, gone.signal);
  return gone.signal.aborted ? STREAMED : ok({ ok: true, refreshed });
}

async function readCensus(deps: HttpRoutesDeps) {
  const host = uiHostOf(deps.state), before = deps.state.inventory;
  if (!host?.queueCensus()) return hostOffline(deps, "census");
  const done = await waitForState(deps.state, () => deps.state.inventory !== before, CENSUS_WAIT_MS);
  const inventory = deps.state.inventory;
  return ok({
    ok: true, read: done, fonts: deps.state.hostFacts.fonts.phase,
    inventory: inventory ? { fingerprint: inventory.fingerprint, itemCount: inventory.items.length, truncated: inventory.truncated } : null,
  });
}

async function captureFrame(deps: HttpRoutesDeps, asked: { readonly compositionId?: string; readonly time?: number }) {
  const { compositionId } = asked, view = compositionId === undefined ? null : compositionView(deps.dispatch.normalizedLatest(), compositionId);
  if (compositionId === undefined || !view) return refuse(409, "NO_COMPOSITION", translatorOf(deps.state)("failure.host.noComposition"));
  const command = captureCommand(view, compositionId, asked.time ?? view.time);
  if (!("operation" in command)) return refuse(422, command.code, command.message);
  queueCapture(deps.state, command, view.background);
  await waitForState(deps.state, () => captureFinished(deps.state, command.captureId), CAPTURE_WAIT_MS);
  const frame = capturedFrame(deps.state, command.captureId);
  return frame ? ok({ ok: true, captureId: command.captureId, ...frame }) : refuse(502, "CAPTURE_FAILED", translatorOf(deps.state)("failure.host.captureFailed"));
}

/** `POST /v1/host/read`, `/census` and `/capture`: the panel's actions on the host lane. */
export const uiHostRoutes: readonly MountedRoute[] = [
  bodyRoute({ method: "POST", path: "/v1/host/read", body: jsonBody(object({ scope: literal("full") }), HOST_BODY_BYTES, READ_INVALID), handle: ({ deps, response }) => readProject(deps, response) }),
  route({ method: "POST", path: "/v1/host/census", handle: ({ deps }) => readCensus(deps) }),
  bodyRoute({
    method: "POST", path: "/v1/host/capture", body: jsonBody(object({ compositionId: optional(string()), time: optional(number()) }), HOST_BODY_BYTES, CAPTURE_INVALID),
    handle: ({ deps, body }) => captureFrame(deps, body),
  }),
];
