// The panel's own authenticated API, apart from preferences and sessions: bootstrap, the event stream, thumbnails, stop and chat-log export.
import { MCP_SERVER_VERSION } from "@extynt/mcp-server";
import { activityViewOf } from "./server-activity.js";
import { exportChatLogs } from "./server-ui-export.js";
import { uiHostRoutes } from "./server-ui-host-routes.js";
import { variantPreviewRoutes } from "./server-ui-variants.js";
import { uiSessionRoutes } from "./server-ui-session-routes.js";
import { SIDECAR_VERSION } from "./server-contracts.js";
import { ok, refuse, route, STREAMED, type MountedRoute, type RouteCall } from "./server-route-table.js";
import { stopWork } from "./server-ui-stop.js";
import { uiDirectoryOf } from "./server-ui-static.js";
import { isPlanId } from "./ui-contract.js";
import { uiBuildOf } from "./ui-build.js";
import { streamUiEvents } from "./ui-events.js";
import { uiHostOf } from "./ui-host.js";
import { uiStoreFor } from "./ui-store.js";
import { translatorOf } from "./ui-language.js";
import { focusViewOf, hostViewOf } from "./ui-view.js";

function bootstrap({ deps }: RouteCall<undefined>) {
  const { state } = deps, store = uiStoreFor(state);
  return ok({
    ok: true, activity: activityViewOf(state), sidecarVersion: SIDECAR_VERSION, mcpVersion: MCP_SERVER_VERSION, uiBuild: uiBuildOf(uiDirectoryOf(state)), ...hostViewOf(state), prefs: store.prefs(),
    currentSessionId: store.currentSessionId(), focus: focusViewOf(deps), project: state.latest?.snapshot.result.project?.name ?? null,
  });
}

function thumbnails({ deps, param }: RouteCall<undefined>) {
  const pair = isPlanId(param) ? uiHostOf(deps.state)?.frames.thumbsFor(param) : undefined;
  return pair && (pair.before || pair.after) ? ok({ ok: true, ...pair }) : refuse(404, "THUMBS_NOT_FOUND", translatorOf(deps.state)("failure.ui.noThumbnails"));
}

function stopJob({ deps }: RouteCall<undefined>, jobId: string | null) {
  try { return ok({ ok: true, ...stopWork(deps, jobId) }); } catch (error) {
    return refuse(500, "JOB_STOP_FAILED", error instanceof Error ? error.message : translatorOf(deps.state)("failure.stop.failed"));
  }
}

function exportLogs({ deps }: RouteCall<undefined>) {
  try { return ok({ ok: true, ...exportChatLogs(deps.state) }); } catch (error) {
    return refuse(500, "CHAT_EXPORT_FAILED", translatorOf(deps.state)("failure.ui.exportFailed", { reason: error instanceof Error ? error.message : translatorOf(deps.state)("failure.unknownError") }));
  }
}

/** Every route of the panel's own API: `/v1/ui/*`, thumbnails and the host actions. */
export const uiRoutes: readonly MountedRoute[] = [
  route({ method: "GET", path: "/v1/ui/bootstrap", handle: bootstrap }),
  route({ method: "GET", path: "/v1/ui/events", handle: ({ deps, request, response, context }) => { streamUiEvents(deps, request, response, { context }); return STREAMED; } }),
  route({ method: "GET", path: "/v1/thumbs/:planId", handle: thumbnails }),
  route({ method: "POST", path: "/v1/ui/stop", handle: (call) => stopJob(call, null) }),
  route({ method: "POST", path: "/v1/ui/jobs/:jobId/stop", handle: (call) => stopJob(call, call.param) }),
  route({ method: "POST", path: "/v1/ui/chat-logs/export", handle: exportLogs }),
  ...uiSessionRoutes,
  ...uiHostRoutes,
  ...variantPreviewRoutes,
];
