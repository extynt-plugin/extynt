// Admission of an approved plan for execution: the drift check against the stored project, the rebase over earlier queued plans, the read-set binding, the compiled host command and the approval capability.
import { presentFields } from "@extynt/decode";
import { createHash } from "node:crypto";

import type { ProjectSnapshot } from "@extynt/project-graph";
import type { StoredPlan } from "@extynt/mcp-server";

import { bindApproval, issueApproval, type ActionPlan, type ApprovalCapability } from "@extynt/action-plan";
import { compileCommand, type HostPlanCommand } from "@extynt/host-ae";

import { nativeMutationQuarantine } from "./native-mutation-lease.js";
import { resolvePresetPath } from "./profile-store.js";

import { sameProject } from "./server-plan-store.js";
import { rebasePlan } from "./server-plan-rebase.js";
import type { PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";

/** What the admission of an approved plan offers the routes that deliver it to the panel. */
export interface ApplyAdmissionCapability {
  attachPresetPaths(command: HostPlanCommand): { ok: false; code: string; message: string } | undefined;
  executableFor(record: StoredPlan, snapshot: ProjectSnapshot, approvalToken: string, panelSessionId: string): { plan: ActionPlan; command: HostPlanCommand; rebasedOver?: string[] } | { ok: false; code: string; message: string };
  issueApprovalCapability(plan: ActionPlan, snapshot: ProjectSnapshot): ApprovalCapability | { ok: false; code: string; message: string };
  panelSessionId(): string;
}

type ApplyAdmissionDeps = {
  readonly state: Pick<SidecarState, "approvalRecords" | "now" | "options" | "inFlight" | "nativeBridge" | "releaseNativeFlight" | "collection">;
  readonly planState: Pick<PlanStateCapability, "lineageChain">;
};

function atPlanRevision(record: StoredPlan, snapshot: ProjectSnapshot): boolean {
  const { freshness } = record.plan;
  return !!freshness && !!snapshot.hostStamp && freshness.revision === snapshot.freshness.revision && sameProject(record.project, snapshot.project);
}

/** Whether the project moved on from what the plan was prepared against: the selection, or (unless the revision proves otherwise) the graph. */
export function planDrifted(record: StoredPlan, snapshot: ProjectSnapshot): boolean {
  const { plan } = record;
  if (plan.selectionFingerprint !== undefined && plan.selectionFingerprint !== snapshot.selectionFingerprint) return true;
  if (atPlanRevision(record, snapshot)) return false;
  return plan.snapshotFingerprint !== snapshot.fingerprint || (plan.freshness !== undefined && plan.freshness.revision !== snapshot.freshness.revision);
}

function rebaseForExecution(deps: ApplyAdmissionDeps, record: StoredPlan, snapshot: ProjectSnapshot): { plan: ActionPlan; rebasedOver?: string[] } | { ok: false; code: string; message: string } {
  const plan = record.plan;
  if (!planDrifted(record, snapshot)) return { plan };
  if (plan.schemaVersion !== "0.2") return { ok: false, code: "STALE_SNAPSHOT", message: "The project changed after this plan was prepared; nothing was applied. Prepare it again." };
  const chain = plan.snapshotFingerprint === snapshot.fingerprint ? [] : deps.planState.lineageChain(plan.snapshotFingerprint, snapshot.fingerprint);
  if (!chain) return { ok: false, code: "STALE_SNAPSHOT", message: "The project changed after this plan was proposed, and not only through earlier queued agent plans (a direct edit, or an earlier plan that failed). Nothing was applied; propose it again against the current snapshot." };
  if (chain.length === 0 && (plan.preconditions ?? []).some((condition) => typeof condition === "object" && condition.code === "EXACT_SELECTION")) return { ok: false, code: "STALE_SELECTION", message: "This plan requires the selection it was prepared with, and the selection changed. Nothing was applied." };
  return { plan: rebasePlan(plan, snapshot), rebasedOver: chain };
}

type ReadSetExecutionInput = { deps: ApplyAdmissionDeps; record: StoredPlan; snapshot: ProjectSnapshot; approvalToken: string; panelSessionId: string; plan: ActionPlan; rebasedOver: string[] | undefined };

function bindExecutionReadSet({ deps, record, snapshot, approvalToken, panelSessionId, plan, rebasedOver }: ReadSetExecutionInput): { readSetDigest?: string } | { ok: false; code: string; message: string } {
  let readSetBinding: { readSetDigest?: string } = {};
  if (snapshot.coverage) {
    const capability = record.approvalCapability;
    if (!capability || capability.token !== approvalToken || capability.panelSessionId !== panelSessionId || rebasedOver) return { ok: false, code: "APPROVAL_MISMATCH", message: "Metadata approval must retain its original exact plan and declared read set; recollect and approve again." };
    const bound = bindApproval(plan, snapshot, capability, deps.state.now().toISOString());
    if ("ok" in bound) return bound;
    readSetBinding = presentFields({ readSetDigest: bound.readSetDigest });
  }
  return readSetBinding;
}

const MAX_APPROVAL_RECORDS = 128;

type Refusal = { ok: false; code: string; message: string };

function nativeRefusal(deps: ApplyAdmissionDeps): Refusal | undefined {
  const quarantine = deps.state.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(deps.state.inFlight) ?? deps.state.collection.nativeAccessQuarantine();
  return quarantine ? { ok: false, code: "HOST_NATIVE_UNRESOLVED", message: String(quarantine.message) } : undefined;
}

function attachPresetPaths(deps: ApplyAdmissionDeps, command: HostPlanCommand): Refusal | undefined {
  if (command.operation !== "apply_plan") return undefined;
  for (const operation of command.operations) {
    if (operation.operation !== "apply_preset" || typeof operation.presetFile === "string") continue;
    const path = resolvePresetPath(String(operation.presetId ?? ""), deps.state.options.presetRoots);
    if (!path) return { ok: false, code: "PRESET_NOT_FOUND", message: `Preset ${String(operation.presetId)} is no longer installed in a scanned preset folder. Nothing was applied; search presets again with ae_search_host_capabilities.` };
    operation.presetPath = path;
  }
  return undefined;
}

type CompileRun = ReadSetExecutionInput & { readSetBinding: { readSetDigest?: string } };

function compiledCommand(run: CompileRun): HostPlanCommand | Refusal {
  const { deps, plan, snapshot, approvalToken, panelSessionId, rebasedOver } = run;
  const command = compileCommand(plan, snapshot, { planId: plan.planId, snapshotFingerprint: snapshot.fingerprint, selectionFingerprint: snapshot.selectionFingerprint, freshness: snapshot.freshness, approvedAt: deps.state.now().toISOString(), approvalId: approvalToken, panelSessionId, oneTime: true, ...run.readSetBinding });
  if (!("operation" in command)) return { ok: false, code: command.code, message: `${command.message}${rebasedOver ? " (checked after rebasing over earlier queued plans)" : ""} Nothing was applied.` };
  return attachPresetPaths(deps, command) ?? command;
}

type Execution = { plan: ActionPlan; command: HostPlanCommand; rebasedOver?: string[] };

function executableFor(deps: ApplyAdmissionDeps, record: StoredPlan, snapshot: ProjectSnapshot, approval: { token: string; panelSessionId: string }): Execution | Refusal {
  const quarantined = nativeRefusal(deps);
  if (quarantined) return quarantined;
  const rebased = rebaseForExecution(deps, record, snapshot);
  if ("ok" in rebased) return rebased;
  const { plan, rebasedOver } = rebased;
  const input = { deps, record, snapshot, approvalToken: approval.token, panelSessionId: approval.panelSessionId, plan, rebasedOver };
  const readSetBinding = bindExecutionReadSet(input);
  if ("ok" in readSetBinding) return readSetBinding;
  const command = compiledCommand({ ...input, readSetBinding });
  return "ok" in command ? command : { plan, command, ...(rebasedOver ? { rebasedOver } : {}) };
}

function panelSessionIdOf(deps: ApplyAdmissionDeps): string {
  return deps.state.options.panelSessionId ?? `panel-${createHash("sha256").update(deps.state.options.token).digest("hex").slice(0, 32)}`;
}

function pruneApprovals(deps: ApplyAdmissionDeps): void {
  const now = Date.now();
  for (const [token, record] of deps.state.approvalRecords) {
    if (record.consumedAt || Date.parse(record.capability.expiresAt) <= now) deps.state.approvalRecords.delete(token);
  }
  if (deps.state.approvalRecords.size < MAX_APPROVAL_RECORDS) return;
  const oldest = deps.state.approvalRecords.keys().next().value;
  if (typeof oldest === "string") deps.state.approvalRecords.delete(oldest);
}

function issueRecordedApproval(deps: ApplyAdmissionDeps, plan: ActionPlan, snapshot: ProjectSnapshot): ApprovalCapability | Refusal {
  const capability = issueApproval({ plan, snapshot, panelSessionId: panelSessionIdOf(deps), now: deps.state.now().toISOString() });
  if (!("token" in capability)) return capability;
  pruneApprovals(deps);
  deps.state.approvalRecords.set(capability.token, { capability, consumedAt: null });
  return capability;
}

/** Admission bound to one session's state and plan bookkeeping. */
export function createApplyAdmission(deps: ApplyAdmissionDeps): ApplyAdmissionCapability {
  return {
    attachPresetPaths: (command) => attachPresetPaths(deps, command),
    executableFor: (record, snapshot, approvalToken, panelSessionId) => executableFor(deps, record, snapshot, { token: approvalToken, panelSessionId }),
    issueApprovalCapability: (plan, snapshot) => issueRecordedApproval(deps, plan, snapshot),
    panelSessionId: () => panelSessionIdOf(deps),
  };
}
