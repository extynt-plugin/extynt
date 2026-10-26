// Every route of the sidecar in one table: the front door looks a request up here after it has passed the loopback, Host and token checks.
import { pairing, rememberPanelBuild } from "./server-http-auth.js";
import { catalogueRoutes } from "./server-catalogue-route.js";
import { chatLogRoutes } from "./server-chat-log-routes.js";
import { chatProgressRoutes } from "./server-chat-progress-routes.js";
import { chatTurnRoutes } from "./server-chat-turn-routes.js";
import { changesRoutes } from "./server-changes-route.js";
import { decisionRoutes } from "./server-decision-routes.js";
import { decisionPageRoutes } from "./server-decision-page-routes.js";
import { focusRoutes } from "./server-focus-route.js";
import { mcpRoutes } from "./server-mcp-routes.js";
import { modelRoutes } from "./server-model-routes.js";
import { nativeBridgeRoutes } from "./server-native-bridge-route.js";
import { notesRoutes } from "./server-notes-route.js";
import { panelRoutes } from "./server-panel-routes.js";
import { reportRoutes } from "./server-report-routes.js";
import { ok, route, type MountedRoute } from "./server-route-table.js";
import { snapshotRoutes } from "./server-snapshot-routes.js";
import { suggestionsRoutes } from "./server-suggestions-route.js";
import { uiRoutes } from "./server-ui-route.js";
import { variantsRoutes } from "./server-variants-route.js";

const pairRoute = route({
  method: "GET",
  path: "/v1/pair",
  open: true,
  handle: ({ deps, request }) => {
    const answer = pairing(deps, request);
    rememberPanelBuild(deps, request);
    return ok(answer);
  },
});

/** The routes the front door serves: pairing is open, every other route needs the session token. */
export const ROUTES: readonly MountedRoute[] = [
  pairRoute,
  ...decisionPageRoutes,
  ...snapshotRoutes,
  ...chatTurnRoutes,
  ...chatProgressRoutes,
  ...modelRoutes,
  ...decisionRoutes,
  ...chatLogRoutes,
  ...mcpRoutes,
  ...focusRoutes,
  ...panelRoutes,
  ...nativeBridgeRoutes,
  ...catalogueRoutes,
  ...notesRoutes,
  ...variantsRoutes,
  ...suggestionsRoutes,
  ...changesRoutes,
  ...reportRoutes,
  ...uiRoutes,
];
