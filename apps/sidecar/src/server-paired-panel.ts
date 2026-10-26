// The paired-panel precondition: a request is from the panel instance that paired with this sidecar when its X-AE-Panel-Instance header names it.
import type { IncomingMessage } from "node:http";

import type { SidecarState } from "./server-state.js";
import { headerId } from "./server-http-wire.js";
import type { Refusal } from "./server-route-body.js";

/** The panel instance a request names in its X-AE-Panel-Instance header, or null when it names none. */
export function suppliedPanel(request: IncomingMessage): string | null {
  return headerId(request.headers["x-ae-panel-instance"]);
}

/** True when the request names the panel instance that is paired now. */
export function isPairedPanel(state: Pick<SidecarState, "activePanelInstanceId">, request: IncomingMessage): boolean {
  const panel = suppliedPanel(request);
  return panel !== null && panel === state.activePanelInstanceId;
}

/** A route guard that refuses with a 409 STALE_PANEL_INSTANCE carrying the given message unless the panel is the paired one. */
export function requirePairedPanel(message: string): (deps: { state: Pick<SidecarState, "activePanelInstanceId"> }, exchange: { request: IncomingMessage }) => Refusal | null {
  return (deps, exchange) => (isPairedPanel(deps.state, exchange.request) ? null : { status: 409, code: "STALE_PANEL_INSTANCE", message });
}
