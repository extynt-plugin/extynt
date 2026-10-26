// The panel lease: what the host may claim from the agent mailbox, in order (quarantine, the scheduled read, awaiting-snapshot, workflow guards, the reservation), and the honest settlement of an item the host left in flight.
import type { ProjectSnapshot } from "@extynt/project-graph";

import { withApplyReads } from "./apply-read-spec.js";
import { nativeMutationQuarantine } from "./native-mutation-lease.js";
import { rememberIssuedRead } from "./read-queue.js";
import type { SchedulerState } from "./read-scheduler.js";
import type { ApplyAdmissionCapability } from "./server-apply-admission.js";
import { mailboxClaimIdentity, rejectWorkflowApplyClaim, rejectWorkflowUndoClaim, type ClaimRefusal, type MailboxClaim } from "./server-claim-guards.js";
import type { HttpCoreCapability } from "./server-http-core.js";
import { mailboxItemFacts } from "./server-mailbox-item.js";
import { prepareMailboxPlan, rejectStaleUndo } from "./server-mailbox-plans.js";
import type { PlanLogCapability } from "./server-plan-log.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import { claimReadyPlans, type ReadyPlansClaim } from "./server-ready-plans.js";
import type { RuntimeCapability } from "./server-runtime.js";
import type { SidecarState } from "./server-state.js";
import type { AgentMailboxItem, MailboxPreparation } from "./server-types.js";

/** What one claim of the agent mailbox came to. `blocked` leaves the queue untouched; `refused` consumed the item and rejected its plan. */
export type MailboxClaimOutcome =
  | { kind: "item"; data: AgentMailboxItem["approvedData"]; claim: { kind: string; id: string } }
  | { kind: "empty" }
  | { kind: "blocked"; code: string; message: string }
  | { kind: "refused"; code: string; message: string };

/** The panel's claims on the mailbox and on the ready-plan queue. */
export interface PanelLeaseCapability {
  claimHostItem(): MailboxClaimOutcome;
  settleHostFlight(): boolean;
  claimReadyPlans(): ReadyPlansClaim;
}

type PanelLeaseDeps = {
  readonly state: Pick<SidecarState, "activeChatTurn" | "activePanelInstanceId" | "catalogue" | "captures" | "releaseNativeFlight" | "panel" | "panelIdleSince" | "plans" | "preApply" | "readyPlans" | "receipts" | "workflowContinuationQueue" | "workflowCoordinator" | "issuedReads"> & SchedulerState;
  readonly applyAdmission: Pick<ApplyAdmissionCapability, "executableFor" | "panelSessionId">;
  readonly planLog: Pick<PlanLogCapability, "logPlanEvent">;
  readonly planState: Pick<PlanStateCapability, "markPanelSeen" | "normalizedLatest">;
  readonly runtime: Pick<RuntimeCapability, "abandonInFlight" | "failUnclaimedApprovals" | "projectWorkflowApplyReceipt" | "projectWorkflowUndoReceipt" | "rejectPlanBeforeDispatch">;
  readonly transport: Pick<HttpCoreCapability, "notifyChange" | "respond">;
};

type ItemClaim = Extract<MailboxClaimOutcome, { kind: "item" }>;
type InFlight = NonNullable<SidecarState["inFlight"]>;

const AWAITING_SNAPSHOT: MailboxClaimOutcome = { kind: "blocked", code: "AWAITING_FRESH_SNAPSHOT", message: "Refresh the project in this panel instance before claiming an approved command." };

const ABANDONED = {
  capture: { code: "CAPTURE_LOST", message: "The panel finished this capture without returning an image. Request a new capture." },
  other: { code: "RECEIPT_LOST", message: "The panel stopped working on this item without reporting a receipt. The project may have changed: refresh and inspect before retrying; nothing is retried automatically." },
} as const;

/** The native-access quarantine, which blocks every claim until exact settlement. */
export function mailboxQuarantine(state: Pick<SidecarState, "nativeBridge" | "inFlight" | "collection">) {
  return state.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(state.inFlight) ?? state.collection.nativeAccessQuarantine();
}

function itemClaim(data: ItemClaim["data"], claim: ItemClaim["claim"]): ItemClaim {
  return { kind: "item", data, claim };
}

function preparationOf(deps: PanelLeaseDeps, item: AgentMailboxItem, snapshot: ProjectSnapshot | undefined): MailboxPreparation {
  if (item.planId) {
    const preparation = prepareMailboxPlan(deps, item, snapshot);
    if (preparation !== "ready") return preparation;
  }
  if (mailboxItemFacts(item).kind === "undo_plan") return rejectStaleUndo(deps, item, snapshot?.fingerprint ?? null);
  return "ready";
}

function nextMailboxItem(deps: PanelLeaseDeps, snapshot: ProjectSnapshot | undefined): AgentMailboxItem | undefined {
  const queue = deps.state.agentMailbox;
  let item = queue.shift();
  while (item) {
    const preparation = preparationOf(deps, item, snapshot);
    if (preparation === "retry") {
      queue.unshift(item);
      return undefined;
    }
    if (preparation === "ready") return item;
    item = queue.shift();
  }
  return undefined;
}

function claimScheduledRead(deps: PanelLeaseDeps, now: number): ItemClaim | undefined {
  const { state } = deps;
  const index = state.awaitingFreshSnapshotAfterPair ? state.agentMailbox.findIndex((item) => item.approvedData.kind === "refresh_snapshot") : -1;
  const [item] = index < 0 ? [] : state.agentMailbox.splice(index, 1);
  if (!item) return undefined;
  rememberIssuedRead(state, item.approvedData);
  state.inFlight = { kind: "refresh_snapshot", id: "refresh_snapshot", claimedAt: now };
  deps.transport.notifyChange();
  return itemClaim(item.approvedData, { kind: "refresh_snapshot", id: "refresh_snapshot" });
}

function abandonFlight(deps: PanelLeaseDeps, flight: InFlight): void {
  const { state } = deps;
  if (flight.kind === "catalogue_page") state.catalogue.abandon(flight.id, "panel-idle-without-completion");
  if (flight.kind === "collection_page" || flight.kind === "catalogue_page" || flight.kind === "refresh_snapshot") {
    state.inFlight = undefined;
    return;
  }
  const wording = flight.kind === "capture_frame" ? ABANDONED.capture : ABANDONED.other;
  deps.runtime.abandonInFlight(wording.code, wording.message);
}

function settleFlight(deps: PanelLeaseDeps): boolean {
  const flight = deps.state.inFlight;
  if (!flight) return false;
  if (flight.kind === "collection_page" && deps.state.collection.hasUnsettled(flight.id)) return true;
  abandonFlight(deps, flight);
  return deps.state.inFlight !== undefined;
}

function reserveClaim(deps: PanelLeaseDeps, reserved: { claim: MailboxClaim; item: AgentMailboxItem; snapshot: ProjectSnapshot | undefined; now: number }): void {
  const { state } = deps;
  const { claim, item, snapshot, now } = reserved;
  state.inFlight = { kind: claim.kind === "apply_plan" ? "apply_pending" : claim.kind, id: claim.id, claimedAt: now };
  if (claim.kind === "refresh_snapshot") rememberIssuedRead(state, item.approvedData);
  if (claim.kind === "apply_plan") item.approvedData = withApplyReads(state, item.approvedData);
  if (claim.kind === "apply_plan" && snapshot) state.preApply = { planId: claim.id, snapshot };
}

function markCaptureClaimed(deps: PanelLeaseDeps, claim: MailboxClaim): void {
  const capture = claim.kind === "capture_frame" ? deps.state.captures.get(claim.id) : undefined;
  if (capture) capture.status = "capturing";
}

function applyRefusal(deps: PanelLeaseDeps, item: AgentMailboxItem, claim: MailboxClaim, snapshot: ProjectSnapshot | undefined): ClaimRefusal | undefined {
  if (claim.kind !== "apply_plan" || !claim.itemPlanId) return undefined;
  return rejectWorkflowApplyClaim(deps, { item, itemPlanId: claim.itemPlanId, plan: claim.plan, snapshot });
}

function undoRefusal(deps: PanelLeaseDeps, item: AgentMailboxItem, claim: MailboxClaim): ClaimRefusal | undefined {
  if (claim.kind !== "undo_plan" || !claim.itemPlanId) return undefined;
  return rejectWorkflowUndoClaim(deps, { item, itemPlanId: claim.itemPlanId });
}

function claimQueued(deps: PanelLeaseDeps, now: number): MailboxClaimOutcome {
  deps.runtime.failUnclaimedApprovals();
  const ahead = claimScheduledRead(deps, now);
  if (ahead) return ahead;
  if (deps.state.awaitingFreshSnapshotAfterPair) return AWAITING_SNAPSHOT;
  const snapshot = deps.planState.normalizedLatest();
  const item = nextMailboxItem(deps, snapshot);
  if (!item) return { kind: "empty" };
  const claim = mailboxClaimIdentity(deps, item);
  const applyRefused = applyRefusal(deps, item, claim, snapshot);
  if (applyRefused) return { kind: "refused", ...applyRefused };
  reserveClaim(deps, { claim, item, snapshot, now });
  const undoRefused = undoRefusal(deps, item, claim);
  if (undoRefused) return { kind: "refused", ...undoRefused };
  markCaptureClaimed(deps, claim);
  deps.transport.notifyChange();
  return itemClaim(item.approvedData, { kind: claim.kind, id: claim.id });
}

function claimHostItem(deps: PanelLeaseDeps): MailboxClaimOutcome {
  const quarantine = mailboxQuarantine(deps.state);
  if (quarantine) return { kind: "blocked", code: "HOST_NATIVE_UNRESOLVED", message: String(quarantine.message) };
  return claimQueued(deps, deps.state.now().getTime());
}

/** The panel's claims over the agent mailbox, the ready-plan queue and the host's in-flight item. */
export function createPanelLease(deps: PanelLeaseDeps): PanelLeaseCapability {
  return {
    claimHostItem: () => claimHostItem(deps),
    settleHostFlight: () => settleFlight(deps),
    claimReadyPlans: () => claimReadyPlans(deps),
  };
}
