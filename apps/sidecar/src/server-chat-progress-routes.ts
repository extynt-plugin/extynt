// The routes that watch and steer a running chat turn: the polled progress line, and a message that joins the turn while it runs.
import { map, object, refine, string } from "@extynt/decode";

import { MAX_STEER_CHARS, MAX_STEER_MESSAGES } from "./server-limits.js";
import { translatorOf } from "./ui-language.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { jsonBody, type BodyRefusals, type BodySpec } from "./server-route-body.js";
import { bodyRoute, ok, refuse, route, answer, type MountedRoute } from "./server-route-table.js";
import type { SidecarState } from "./server-state.js";
import type { ChatProgress } from "./server-types.js";

const MAX_STEER_REQUEST_BYTES = 4_000;

function hasContent(text: string): text is string {
  return text.trim().length > 0;
}

function newestProgress(state: Pick<SidecarState, "chatProgress">): ChatProgress | null {
  let newest: ChatProgress | null = null;
  for (const progress of state.chatProgress.values()) if (!newest || progress.at > newest.at) newest = progress;
  return newest;
}

const progressRoute = route({
  method: "GET",
  path: "/v1/chat/progress",
  handle: ({ deps, url }) => {
    const wanted = url.searchParams.get("requestId");
    return ok({ ok: true, progress: wanted ? deps.state.chatProgress.get(wanted) ?? null : newestProgress(deps.state) });
  },
});

const closingRoute = route({
  method: "GET",
  path: "/v1/chat/closing",
  handle: ({ deps, url }) => ok({ ok: true, closing: deps.state.closingReplies.get(url.searchParams.get("requestId") ?? "") ?? "" }),
});

const steerFields = object({ requestId: string(), message: map(refine(string(), hasContent, "a message with content"), (text) => text.trim()) });

function steerBody(deps: HttpRoutesDeps): BodySpec<{ readonly requestId: string; readonly message: string }> {
  const t = translatorOf(deps.state);
  const invalidJson = { status: 400, code: "INVALID_JSON", message: t("failure.steer.notJson") } as const;
  const invalid = { status: 422, code: "INVALID_STEER", message: t("failure.steer.invalid") } as const;
  const overrides: Partial<BodyRefusals> = { tooLarge: invalidJson, notJson: invalidJson };
  return { ...jsonBody(steerFields, MAX_STEER_REQUEST_BYTES, invalid, overrides), emptyAsObject: true };
}

const steerRoute = bodyRoute({
  method: "POST",
  path: "/v1/chat/steer",
  body: steerBody,
  handle: ({ deps, body }) => {
    if (!deps.state.chatProgress.has(body.requestId)) return refuse(409, "NO_RUNNING_TURN", translatorOf(deps.state)("failure.steer.finished"));
    const queued = deps.state.chatSteering.get(body.requestId) ?? [];
    if (queued.length >= MAX_STEER_MESSAGES) return refuse(429, "STEER_QUEUE_FULL", translatorOf(deps.state)("failure.steer.full", { max: MAX_STEER_MESSAGES }));
    queued.push(body.message.slice(0, MAX_STEER_CHARS));
    deps.state.chatSteering.set(body.requestId, queued);
    return answer(202, { ok: true, accepted: true, queued: queued.length, limit: MAX_STEER_MESSAGES });
  },
});

/** The progress poll and the steering message of a running chat turn, and the reply that closed a job after its request had ended. */
export const chatProgressRoutes: readonly MountedRoute[] = [progressRoute, closingRoute, steerRoute];
