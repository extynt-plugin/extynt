// POST /v1/panel/focus: the paired panel's focus report, decoded strictly and taken in by the live focus.
import { headerId } from "./server-http-wire.js";
import { liveFocusReport } from "./live-focus-report.js";
import { outcomeReply } from "./server-route-outcome.js";
import { jsonBody } from "./server-route-body.js";
import { bodyRoute, type MountedRoute } from "./server-route-table.js";

const FOCUS_BODY_LIMIT_BYTES = 32_768;

const body = {
  ...jsonBody(
    liveFocusReport,
    FOCUS_BODY_LIMIT_BYTES,
    { status: 422, code: "INVALID_FOCUS", message: "The focus report does not match the documented shape:" },
    {
      tooLarge: { status: 413, code: "BODY_LIMIT", message: "The focus report exceeded the limit." },
      notJson: { status: 400, code: "INVALID_JSON", message: "The focus report must be valid JSON." },
    },
  ),
  explainInvalid: true,
} as const;

/** The focus report route. When a panel is paired, only that panel may report; with none paired, a report is taken in. */
export const focusRoutes: readonly MountedRoute[] = [
  bodyRoute({
    method: "POST",
    path: "/v1/panel/focus",
    guard: (deps, { request }) => {
      const paired = deps.state.activePanelInstanceId;
      const stale = paired && headerId(request.headers["x-ae-panel-instance"]) !== paired;
      return stale ? { status: 409, code: "STALE_PANEL_INSTANCE", message: "Only the paired panel may report the focus." } : null;
    },
    body,
    handle: ({ deps, body: report }) => outcomeReply(deps.dispatch.acceptFocus(report)),
  }),
];
