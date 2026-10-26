// What every reader runner does the same way: let go of the lane's in-flight record, and tell the rest of the sidecar a host call failed.
import type { SidecarState } from "../server-state.js";
import type { HostLaneContext, HostWorkKind } from "./lane-types.js";
import { noteHostFailure } from "./facts.js";
import type { HostFailure } from "./read-ops.js";

/** The lane reserved `kind` when it took the item; the runner is done with it whatever came of it. A held native lease (`nativeSettlement`) is never released here: the state's setter refuses. */
export function releaseFlight(state: Pick<SidecarState, "inFlight">, kind: HostWorkKind, id?: string): void {
  const flight = state.inFlight;
  if (flight?.kind === kind && (id === undefined || flight.id === id)) state.inFlight = undefined;
}

const EMPTY_PROJECT: ReadonlySet<string> = new Set(["NO_PROJECT", "NO_ACTIVE_COMPOSITION"]);

/** Records a failed host call: in the log always, and as the host's last error (which ends the waits that watch it) unless its code only says nothing is open (NO_PROJECT, NO_ACTIVE_COMPOSITION), which is a state and not a fault. */
export async function reportFailure(context: HostLaneContext, what: string, failure: HostFailure): Promise<void> {
  if (what === "census" || what === "read") noteHostFailure(context.state.hostFacts, what, failure, context.now());
  context.log(`host.${what}-failed`, { code: failure.code, unknown: failure.unknown, message: failure.message });
  if (EMPTY_PROJECT.has(failure.code)) { context.state.panel.lastError = null; return; }
  const code = /^[A-Z0-9_]{1,64}$/.test(failure.code) ? failure.code : "HOST_ERROR";
  await context.receivers.acceptPanelEvent({ code: code === "HOST_NATIVE_UNRESOLVED" ? "HOST_ERROR" : code, message: failure.message });
}
