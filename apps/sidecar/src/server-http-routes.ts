// The sidecar's HTTP edge: the listener's lifecycle, and the receivers the native host lane calls in place of the routes.
import { onFailureText } from "@extynt/decode";
import { createServer } from "node:http";

import { handleRequest } from "./server-front-door.js";
import { reportHandlerFailure } from "./server-handler-failure.js";
import type { HttpRoutesCapability, HttpRoutesDeps } from "./server-http-state.js";
import { createInProcessReceivers } from "./server-receiver-cores.js";
import type { SidecarAddress } from "./server-types.js";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;
const CLOSE_GRACE_MS = 2_000;

function listening(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

async function start(deps: HttpRoutesDeps): Promise<SidecarAddress> {
  const { state, dispatch } = deps;
  if (state.server) throw new Error("sidecar is already running");
  const server = createServer((request, response) => {
    dispatch.handle(request, response).catch(onFailureText((message) => reportHandlerFailure(deps, { request, response, message })));
  });
  state.server = server;
  await listening(server, state.options.port ?? DEFAULT_PORT);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sidecar did not expose a TCP address");
  state.port = address.port;
  state.approvalSweep = setInterval(() => dispatch.failUnclaimedApprovals(), state.approvalSweepMs);
  state.approvalSweep.unref();
  return { host: LOOPBACK_HOST, port: address.port };
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const force = setTimeout(() => { server.closeAllConnections(); resolve(); }, CLOSE_GRACE_MS);
    force.unref();
    server.close((error) => { clearTimeout(force); if (error) reject(error); else resolve(); });
  });
}

async function stop(deps: HttpRoutesDeps): Promise<void> {
  const { state, dispatch } = deps;
  if (state.approvalSweep !== undefined) { clearInterval(state.approvalSweep); state.approvalSweep = undefined; }
  state.activeChatTurn?.controller.abort(new Error("sidecar stopped"));
  for (const run of state.workflowRuns.values()) run.controller.abort(new Error("sidecar stopped"));
  state.workflowContinuationQueue.clear();
  state.workflowRuns.clear();
  dispatch.notifyChange();
  const server = state.server;
  state.server = undefined;
  try {
    if (server) await closeServer(server);
  } finally {
    state.collection.close();
    state.workflowCoordinator.close();
  }
}

/** The listener's lifecycle, bound to loopback only, and the in-process receivers. */
export function createHttpRoutes(deps: HttpRoutesDeps): HttpRoutesCapability {
  let stopping: Promise<void> | undefined;
  return {
    start: () => start(deps),
    stop: () => stopping ??= stop(deps),
    handle: (request, response) => handleRequest(deps, request, response),
    receivers: createInProcessReceivers(deps),
  };
}

