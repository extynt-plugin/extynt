// Read models over the sidecar's plan and snapshot state: the normalized project read, plan lifecycle predicates and the workflow evidence a continuation may trust.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { RuntimeOperationEvidence, StoredPlan } from "@extynt/mcp-server";
import { hostVerificationKey } from "@extynt/capability-catalogue";
import type { WorkflowBatch, WorkflowId } from "@extynt/workflow";

import { createFocusOverlay } from "./focus-overlay.js";
import { pairedReceipt, repairBatchMatchesCurrent, settledObservationBatch, validVerifiedBatch } from "./server-repair-pairing.js";
import { settledCreatedBindings } from "./server-settled-bindings.js";
import { normalizeProbeSnapshot } from "./server-normalize.js";
import { APPROVED_CLAIM_GRACE_MS } from "./server-limits.js";
import type { SidecarState } from "./server-state.js";
import type { StoredSnapshot } from "./server-types.js";

type PairedSnapshot = { ok: true; fingerprint: string; revision: string | null } | { ok: false; message: string };

/**
 * The plan and snapshot read models. `normalizedLatest` is the last read with the live focus laid over it (the open composition and selection are
 * After Effects' now, the project content is the read's); `normalizedWhole` is the whole-project read even while a scoped collection snapshot is the
 * current observation, so inspections and ordinary plans never see the narrowing; `demoteScoped` makes the whole-project read current again and is
 * false when nothing was scoped; `lineageChain` walks receipts back from the current fingerprint, because only a chain of this queue's own applied
 * plans explains drift; `planIsInFlight` is whether the panel works on a plan right now (`approved` alone is a queue entry; a claim or an open claim
 * window makes it work); `approvalClockStart` is when the panel's chance to start an approval began; `hostKey` is the key the live verification
 * ledger uses, so receipt evidence and live-matrix results cannot drift apart; the paired snapshots are the one authoritative pairing check, shared
 * by synchronous and deferred workflow cycles, with the repair form pairing a failed receipt to current host state before a corrective batch.
 */
export interface PlanStateCapability {
  approvalClockStart(record: StoredPlan): number;
  currentRuntimeEvidence(): Record<string, RuntimeOperationEvidence>;
  hostKey(): string | undefined;
  hostLabel(): string | undefined;
  lineageChain(from: string, to: string): string[] | null;
  markPanelSeen(): void;
  normalizedLatest(): ProjectSnapshot | undefined;
  normalizedWhole(): ProjectSnapshot | undefined;
  demoteScoped(): boolean;
  pairedWorkflowSnapshot(jobId: WorkflowId, batchId: WorkflowId): PairedSnapshot;
  pairedWorkflowRepairSnapshot(jobId: WorkflowId, batchId: WorkflowId): PairedSnapshot;
  planIsInFlight(record: StoredPlan): boolean;
  settledCreatedIds(): Record<string, string>;
}

type PlanStateDeps = {
  readonly state: Pick<SidecarState, "inFlight" | "latest" | "lineage" | "liveFocus" | "now" | "normalizedCache" | "panel" | "panelIdleSince" | "plans" | "runtimeEvidence" | "workflowCoordinator">;
};

type PlanStateState = PlanStateDeps["state"];
type PlanBatchLookupState = Pick<SidecarState, "plans" | "workflowCoordinator">;
type SnapshotReads = Pick<PlanStateCapability, "normalizedLatest" | "normalizedWhole" | "demoteScoped" | "hostKey" | "hostLabel" | "currentRuntimeEvidence">;
type HostRuntime = NonNullable<NonNullable<PlanStateState["latest"]>["snapshot"]["result"]["runtime"]>;

/** True when the plan was authorized against exactly this read of the project (and selection, if it pinned one). */
export function planMatchesSnapshot(record: StoredPlan, snapshot: ProjectSnapshot): boolean {
  return record.plan.snapshotFingerprint === snapshot.fingerprint && (record.plan.selectionFingerprint === undefined || record.plan.selectionFingerprint === snapshot.selectionFingerprint);
}

/** The stored plan that became the workflow batch. */
export function pendingPlanFor(state: PlanBatchLookupState, batchId: WorkflowId): StoredPlan | undefined {
  return [...state.plans.values()].find((record) => state.workflowCoordinator.batchIdForPlan(record.plan.planId) === batchId);
}

/** The workflow batch a stored plan became, if the plan is still stored. */
export function pendingBatchFor(state: PlanBatchLookupState, batchId: WorkflowId): WorkflowBatch | null {
  const plan = pendingPlanFor(state, batchId);
  return plan ? state.workflowCoordinator.batchForPlan(plan.plan.planId) : null;
}

function hostLabelOf(runtime: HostRuntime): string {
  const build = runtime.buildNumber ? ` (build ${runtime.buildNumber})` : "";
  const platform = runtime.platform && runtime.platform !== "unknown" ? ` ${runtime.platform}` : "";
  return `After Effects ${String(runtime.appVersion).replace(/x\d+$/, "")}${build}${platform}`;
}

function createSnapshotReads(state: PlanStateState): SnapshotReads {
  const overlay = createFocusOverlay();
  let wholeCache: { source: StoredSnapshot; value: ProjectSnapshot } | undefined;
  const reads: SnapshotReads = {
    normalizedLatest(): ProjectSnapshot | undefined {
      if (!state.latest) return undefined;
      if (state.normalizedCache?.source !== state.latest) state.normalizedCache = { source: state.latest, value: normalizeProbeSnapshot(state.latest.snapshot, state.latest.receivedAt) };
      return overlay(state.normalizedCache.value, state.liveFocus, state.now().getTime());
    },
    normalizedWhole(): ProjectSnapshot | undefined {
      const whole = state.latest?.fullBase;
      if (!whole) return reads.normalizedLatest();
      wholeCache = wholeCache?.source === whole ? wholeCache : { source: whole, value: normalizeProbeSnapshot(whole.snapshot, whole.receivedAt) };
      return overlay(wholeCache.value, state.liveFocus, state.now().getTime());
    },
    demoteScoped(): boolean {
      const whole = state.latest?.fullBase;
      if (!whole) return false;
      state.latest = whole;
      return true;
    },
    hostKey(): string | undefined { return hostVerificationKey(state.latest?.snapshot.result.runtime) ?? undefined; },
    hostLabel(): string | undefined {
      const runtime = state.latest?.snapshot.result.runtime;
      return runtime ? hostLabelOf(runtime) : undefined;
    },
    currentRuntimeEvidence(): Record<string, RuntimeOperationEvidence> {
      const key = reads.hostKey();
      return key ? state.runtimeEvidence.hosts[key] ?? {} : {};
    },
  };
  return reads;
}

function inFlightClaim(state: PlanStateState, planId: string): boolean {
  const claim = state.inFlight;
  return (claim?.kind === "apply_plan" || claim?.kind === "apply_pending") && claim.id === planId;
}

function createLifecycle(state: PlanStateState): Pick<PlanStateCapability, "approvalClockStart" | "lineageChain" | "markPanelSeen" | "planIsInFlight" | "settledCreatedIds"> {
  const lifecycle: ReturnType<typeof createLifecycle> = {
    approvalClockStart(record: StoredPlan): number {
      const approvedAt = Date.parse(record.updatedAt);
      if (!Number.isFinite(approvedAt)) return 0;
      return state.panelIdleSince === null ? approvedAt : Math.max(approvedAt, state.panelIdleSince);
    },
    lineageChain(from: string, to: string): string[] | null {
      const chain: string[] = []; let cursor = to;
      for (let hops = 0; hops < 64 && cursor !== from; hops += 1) { const link = state.lineage.get(cursor); if (!link) return null; chain.unshift(link.planId); cursor = link.beforeFingerprint; }
      return cursor === from ? chain : null;
    },
    markPanelSeen(): void { state.panel.lastSeenAt = state.now().getTime(); },
    planIsInFlight(record: StoredPlan): boolean {
      if (record.status === "applying" || record.status === "undo_requested") return true;
      if (record.status !== "approved") return false;
      return inFlightClaim(state, record.plan.planId) || state.now().getTime() - lifecycle.approvalClockStart(record) < APPROVED_CLAIM_GRACE_MS;
    },
    settledCreatedIds(): Record<string, string> { return settledCreatedBindings(state); },
  };
  return lifecycle;
}

function createWorkflowPairing(state: PlanStateState, reads: SnapshotReads): Pick<PlanStateCapability, "pairedWorkflowSnapshot" | "pairedWorkflowRepairSnapshot"> {
  return {
    pairedWorkflowSnapshot(jobId: WorkflowId, batchId: WorkflowId): PairedSnapshot {
      const batch = pendingBatchFor(state, batchId);
      if (!validVerifiedBatch(batch, jobId)) return { ok: false, message: "The workflow receipt is not yet a settled verified batch; no continuation may use an unpaired snapshot." };
      const fingerprint = pairedReceipt(batch);
      const latest = reads.normalizedLatest();
      const pairing = latest && fingerprint && latest.fingerprint === fingerprint ? { fingerprint: latest.fingerprint, revision: latest.revision } : undefined;
      return pairing ? { ok: true, ...pairing } : { ok: false, message: "The verified receipt is not paired with the current snapshot identity; refresh and obtain matching host evidence before continuing." };
    },
    pairedWorkflowRepairSnapshot(jobId: WorkflowId, batchId: WorkflowId): PairedSnapshot {
      const batch = pendingBatchFor(state, batchId);
      const latest = reads.normalizedLatest();
      if (batch && latest && repairBatchMatchesCurrent(batch, jobId, latest)) return { ok: true, fingerprint: latest.fingerprint, revision: latest.revision };
      return { ok: false, message: settledObservationBatch(batch, jobId)
        ? "The executed receipt is not paired with the current snapshot identity; refresh host state before read-only visual validation. No mutation will be replayed."
        : "The repair receipt is not paired with the current snapshot identity; refresh host state before asking the agent to author a correction." };
    },
  };
}

/** The plan-state capability over the sidecar state. */
export function createPlanState(deps: PlanStateDeps): PlanStateCapability {
  const reads = createSnapshotReads(deps.state);
  return { ...reads, ...createLifecycle(deps.state), ...createWorkflowPairing(deps.state, reads) };
}
