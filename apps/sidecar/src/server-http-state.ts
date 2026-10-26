// The dependencies every HTTP route works with, and the store a probe snapshot lands in: supersession, merging of scoped reads and the inventory fallback.
import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonOf } from "@extynt/mcp-server";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { emptyFontInventory, makeHostProfile, makeInventory, observeSnapshotEffects, type Inventory } from "@extynt/capability-catalogue";

import { profileDirectory, saveHostProfile, scanPresetInventory } from "./profile-store.js";
import { MAX_SUPERSEDED_PROBES } from "./server-limits.js";
import { hostInstallation, inventoryItem } from "./server-census-wire.js";
import type { SidecarAddress, ProbeSnapshot, StoredSnapshot } from "./server-types.js";
import type { SidecarState } from "./server-state.js";
import type { SidecarCapabilities } from "./server.js";
import { hasCoverage, mergeRead, observedOfWhole, wholeReadOf, type MergeRefusal, type MergeResult, type ObservedRevisions } from "./snapshot-merge.js";
import { queueSnapshotRefresh } from "./read-queue.js";
import { refused } from "./receiver-outcome.js";
import type { InProcessReceivers, ReceiverOutcome } from "./receiver-types.js";

export { bearerMatches } from "./server-http-auth.js";

interface HttpLifecycleCapability {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  start(): Promise<SidecarAddress>;
  stop(): Promise<void>;
}

/** The lifecycle of the HTTP edge, and the receivers the native host lane calls without HTTP. */
export interface HttpRoutesCapability extends HttpLifecycleCapability {
  readonly receivers: InProcessReceivers;
}

/** What a route reads and writes: the whole session state and every capability, which tests and the composition root may override. */
export interface HttpRoutesDeps {
  readonly state: SidecarState;
  readonly dispatch: SidecarCapabilities;
}

function clearPanelState(deps: HttpRoutesDeps): void {
  deps.state.pendingPanelReset = false;
  for (const [planId, record] of deps.state.plans) {
    if (!deps.state.workflowCoordinator.hasPlan(planId)) {
      const lost = deps.state.planLedger.markLost(record, "host-session");
      deps.state.eventLog("plan.dropped", { planId, reason: "host-session", status: record.status, message: lost.message });
      deps.state.plans.delete(planId);
    } else {
      delete record.approvalCapability;
      delete record.verificationAcknowledged;
    }
  }
  deps.state.variants.clear();
  deps.state.approvalRecords.clear(); deps.state.agentMailbox.length = 0; deps.state.captures.clear(); deps.state.lineage.clear(); deps.state.inFlight = undefined; deps.state.preApply = undefined;
  deps.state.panel = { lastSeenAt: deps.state.now().getTime(), busy: false, busyKind: null, busySinceAt: null, lastError: null };
}

function trimSuperseded(deps: HttpRoutesDeps): void {
  while (deps.state.supersededProbes.size > MAX_SUPERSEDED_PROBES) {
    const oldest = deps.state.supersededProbes.values().next().value;
    if (typeof oldest !== "string") break;
    deps.state.supersededProbes.delete(oldest);
  }
}

function effectsUnknown(parsed: ProbeSnapshot): boolean {
  return parsed.result.capabilityEnumeration?.effects === "unknown";
}

function inventoryOf(parsed: ProbeSnapshot, normalized: ProjectSnapshot): Inventory {
  const installed = (parsed.result.installedEffects ?? []).map(inventoryItem);
  return installed.length > 0 ? makeInventory(hostInstallation(parsed.result.runtime), installed, parsed.result.inventoryTruncated === true) : observeSnapshotEffects(normalized);
}

function refreshHostProfile(deps: HttpRoutesDeps, inventory: Inventory): void {
  const { state } = deps;
  const baseProfile = makeHostProfile(inventory, state.hostProfile, scanPresetInventory(state.options.presetRoots), state.hostProfile?.fontInventory ?? emptyFontInventory());
  state.hostProfile = deps.dispatch.withEffectEvidence(baseProfile) ?? baseProfile;
  saveHostProfile(state.hostProfile, state.options.stateDirectory ?? profileDirectory());
}

/** Builds the effect inventory and host profile from a read when none has been collected yet; a read that did not ask for the effects census says "unknown" with an empty list, which is silence, not an empty install. */
export function storeInventoryFallback(deps: HttpRoutesDeps, parsed: ProbeSnapshot, normalized: ProjectSnapshot): void {
  const { state } = deps;
  if (state.inventory) return;
  if ((parsed.result.installedEffects ?? []).length === 0 && effectsUnknown(parsed)) return;
  state.previousInventory = state.inventory;
  state.inventory = inventoryOf(parsed, normalized);
  refreshHostProfile(deps, state.inventory);
}

/** Refuses a read whose request was already replaced by a newer snapshot. */
export function supersededSnapshot(deps: HttpRoutesDeps, parsed: ProbeSnapshot): ReceiverOutcome | undefined {
  if (!deps.state.supersededProbes.has(parsed.requestId)) return undefined;
  return refused(409, "SUPERSEDED_SNAPSHOT", "This observation was already replaced by a newer snapshot; it cannot become the current project state. Publish a fresh probe.");
}

/** Places a read on the stored snapshot: a full read replaces it, a scoped one is folded in onto the whole-project read beside it. */
export function mergeIntoLatest(deps: HttpRoutesDeps, read: ProbeSnapshot): MergeResult {
  const asked = deps.state.issuedReads.get(read.requestId);
  const latest = deps.state.latest;
  return mergeRead(latest && hasCoverage(latest.snapshot) ? latest.fullBase : latest, read, asked?.scope === "compositions" ? asked.compositionIds : undefined);
}

/** A scoped read that cannot be placed on what is stored is answered 409, and the full read it needs is queued at once. */
export function refuseScopedRead(deps: HttpRoutesDeps, read: ProbeSnapshot, reason: MergeRefusal): ReceiverOutcome {
  deps.state.issuedReads.delete(read.requestId);
  queueSnapshotRefresh(deps.state, { reason: reason === "other-project" || reason === "other-epoch" ? "project" : "edit", read: { scope: "full" } });
  deps.state.eventLog("read.needs-full", { reason });
  return refused(409, "READ_NEEDS_FULL", "This read covers only part of the project and cannot be placed on the stored snapshot; a full read has been requested.");
}

function withWholeBase(next: StoredSnapshot, previous: StoredSnapshot | undefined): StoredSnapshot {
  const fullBase = hasCoverage(next.snapshot) ? wholeReadOf(previous) : undefined;
  return fullBase ? { ...next, fullBase } : next;
}

function supersedeLatest(deps: HttpRoutesDeps, parsed: ProbeSnapshot): void {
  const latest = deps.state.latest;
  if (!latest || latest.snapshot.requestId === parsed.requestId) return;
  deps.state.supersededProbes.add(latest.snapshot.requestId);
  trimSuperseded(deps);
}

function settlePanelAfterStore(deps: HttpRoutesDeps): void {
  const { state } = deps;
  deps.dispatch.markPanelSeen();
  if (state.panel.lastError) state.panel.lastError = null;
  if (state.inFlight?.kind === "refresh_snapshot") state.inFlight = undefined;
  deps.dispatch.notifyChange();
  if (state.activePanelInstanceId) state.awaitingFreshSnapshotAfterPair = false;
}

interface StoredRead {
  readonly bytes: number;
  readonly receivedAt: string;
  readonly observed: ObservedRevisions;
}

/** Stores a read as the latest snapshot: the panel state is reset on a fresh pairing, the replaced read is remembered as superseded, and waiters are woken. */
export function storeObservedSnapshot(deps: HttpRoutesDeps, parsed: ProbeSnapshot, stored: StoredRead): void {
  if (deps.state.pendingPanelReset) clearPanelState(deps);
  deps.state.collection.reconcileSnapshot(jsonOf(parsed));
  supersedeLatest(deps, parsed);
  deps.state.latest = withWholeBase({ snapshot: parsed, ...stored }, deps.state.latest);
  settlePanelAfterStore(deps);
}

/** Stores a whole read as the latest snapshot. */
export function storeSnapshot(deps: HttpRoutesDeps, parsed: ProbeSnapshot, bytes: number, receivedAt: string): void {
  storeObservedSnapshot(deps, parsed, { bytes, receivedAt, observed: observedOfWhole(parsed) });
}
