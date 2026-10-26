// What a new plugin connection means for the sidecar: who is on the other end, and the state that must not outlive the previous connection.
import type { PingDirectResult, PluginEndpoint } from "@extynt/host-native";
import { freshSchedulerMemory } from "../read-scheduler.js";
import type { SidecarState } from "../server-state.js";
import { pruneHostFacts } from "./facts.js";

export interface LinkIdentity { instanceId: string; pid: number; pluginVersion: string | null; aeVersion: string | null }

/** Who is on the other end: from the connect-time ping where it answered, else from the discovery file. */
export function identityOf(ping: PingDirectResult | undefined, endpoint: PluginEndpoint, connectionNumber: number): LinkIdentity {
  const pid = ping?.pid ?? endpoint.pid ?? 0;
  return { instanceId: `native:${pid}:${connectionNumber}`, pid, pluginVersion: ping?.pluginVersion ?? endpoint.pluginVersion, aeVersion: ping?.aeVersion ?? endpoint.aeVersion };
}

type ReleasedLease = ReturnType<SidecarState["nativeBridge"]["releaseForNewOwner"]>;

function releasedLeaseFor(state: SidecarState, instanceId: string): ReleasedLease | null {
  try { return state.nativeBridge.releaseForNewOwner(instanceId); } catch { return null; }
}

function retirePreviousHost(state: SidecarState, instanceId: string): void {
  state.collection.pair(instanceId);
  const released = releasedLeaseFor(state, instanceId);
  if (released?.released) state.eventLog("plan.native-lease-owner-replaced", { kind: released.kind ?? null, logicalOwner: released.logicalOwner?.id ?? null });
  const flight = state.inFlight;
  if (flight?.nativeSettlement === "unknown") state.releaseNativeFlight(flight.id);
}

function forgetPreviousReads(state: SidecarState): void {
  state.awaitingFreshSnapshotAfterPair = true;
  state.latest = undefined;
  state.pendingPanelReset = true;
  state.liveStamp = null;
  state.readScheduler = freshSchedulerMemory();
  state.issuedReads.clear();
}

/** A new plugin connection is a new paired host: nothing read from the last one is trusted, and its unsettled native lease cannot be settled by a caller that is gone. An unwritable lease journal keeps its lease; health reports it. */
export function pairNativeHost(state: SidecarState, identity: LinkIdentity): void {
  retirePreviousHost(state, identity.instanceId);
  state.activePanelInstanceId = identity.instanceId;
  state.hostFacts.pairedAt = state.now().getTime();
  pruneHostFacts(state.hostFacts, state.plans.keys());
  state.panelBuild = identity.pluginVersion ? `plugin ${identity.pluginVersion}` : "plugin";
  forgetPreviousReads(state);
}
