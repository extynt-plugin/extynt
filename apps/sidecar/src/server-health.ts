// The /health answer: what the panel and the installer read to know the sidecar is up, paired and unquarantined.
import type { IncomingMessage } from "node:http";

import { catalogueProgressWithEngine } from "./catalogue-engine.js";
import { nativeQuarantineOf } from "./server-http-auth.js";
import type { HttpRoutesDeps } from "./server-http-state.js";
import { SIDECAR_BUILD_ID } from "./server-build.js";
import { SIDECAR_VERSION } from "./server-contracts.js";
import { SNAPSHOT_SCHEMA_VERSION } from "./server-limits.js";
import { headerId } from "./server-http-wire.js";

const MAX_STARTUP_NOTICES = 5;
const MAX_NOTICE_CHARS = 300;

function boundedStartupNotices(notices: readonly string[]): string[] {
  return notices.slice(0, MAX_STARTUP_NOTICES).map((notice) => notice.slice(0, MAX_NOTICE_CHARS));
}

/** The health report. Startup notices name only a file basename and an error code, and are bounded in count and length. */
export function healthOf(deps: HttpRoutesDeps, request: IncomingMessage) {
  const { state, dispatch } = deps;
  const quarantine = nativeQuarantineOf(state);
  return {
    ok: true,
    service: "extynt-sidecar",
    version: SIDECAR_VERSION,
    build: SIDECAR_BUILD_ID,
    panelBuild: state.panelBuild ?? headerId(request.headers["x-ae-panel-build"]) ?? null,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    loopbackOnly: true,
    nativeMutationQuarantine: quarantine,
    nativeAccessQuarantine: quarantine,
    hasSnapshot: state.latest !== undefined,
    awaitingFreshSnapshotAfterPair: state.awaitingFreshSnapshotAfterPair,
    latestReceivedAt: state.latest?.receivedAt ?? null,
    pipeline: dispatch.pipeline(),
    agent: state.lastAgentCall,
    diagnostics: { preflightCount: state.preflightCount, snapshotPostCount: state.snapshotPostCount },
    workflow: { startupNotices: boundedStartupNotices(state.workflowCoordinator.startupNotices) },
    catalogue: catalogueProgressWithEngine(state.catalogue.progress(), state.catalogueEngine),
    liveFocus: dispatch.focusHealth(),
  };
}
