// Admission of the host's apply-begin claim: whether an approved plan may start applying, bound to the current snapshot and approval, or is refused before any mutation.
import { decodeOrThrow } from "@extynt/decode";
import { computePlanDigest } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";

import { nativeMutationQuarantine } from "./native-mutation-lease.js";
import { accepted, refused } from "./receiver-outcome.js";
import type { ReceiverOutcome } from "./receiver-types.js";
import { planMatchesSnapshot, type PlanStateCapability } from "./server-plan-state.js";
import type { SidecarState } from "./server-state.js";
import { approvalReference } from "./server-build.js";
import { DIVERGENCE_FAILURE } from "./workflow-coordinator-types.js";

/** What apply admission reads and writes: the plans, the shared dispatch lane, the workflow coordinator and the current snapshot. */
export type PipelineApplyDeps = {
  readonly state: Pick<SidecarState, "collection" | "inFlight" | "nativeBridge" | "now" | "plans" | "preApply" | "workflowCoordinator">;
  readonly planState: Pick<PlanStateCapability, "normalizedLatest">;
};

type PlanRecord = NonNullable<ReturnType<SidecarState["plans"]["get"]>>;
type ApplyClaim = { record: PlanRecord; planId: string; pendingClaim: boolean };
type ApplyBinding = { snapshot: ProjectSnapshot; approvalToken: string } | { refusal: ReceiverOutcome };

function refuseApply(message: string): ReceiverOutcome {
  return refused(409, "WORKFLOW_APPLY_REFUSED", message);
}

function claimedPlanId(detail: string): string | undefined {
  return /^([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(?:\s|$)/.exec(detail)?.[1];
}

function clearPendingApply(deps: PipelineApplyDeps, claim: ApplyClaim): void {
  const state = deps.state;
  if (claim.pendingClaim && state.inFlight?.kind === "apply_pending" && state.inFlight.id === claim.planId) state.inFlight = undefined;
}

function duplicateApplyBegin(deps: PipelineApplyDeps, record: PlanRecord): ReceiverOutcome {
  const current = deps.planState.normalizedLatest();
  if (!current || !planMatchesSnapshot(record, current)) return refuseApply("The duplicate host apply claim no longer matches the fresh authorized snapshot.");
  return accepted(200, { ok: true, idempotent: true, alreadyExecuting: true });
}

function bindingFor(deps: PipelineApplyDeps, claim: ApplyClaim): ApplyBinding {
  const { record } = claim;
  const snapshot = deps.planState.normalizedLatest();
  if (!snapshot || !record.approvalCapability) {
    clearPendingApply(deps, claim);
    return { refusal: refuseApply("The sidecar could not bind the host apply to a current snapshot and approval.") };
  }
  if (!planMatchesSnapshot(record, snapshot)) {
    clearPendingApply(deps, claim);
    return { refusal: refuseApply("The project changed after approval; the host apply is refused before mutation.") };
  }
  return { snapshot, approvalToken: record.approvalCapability.token };
}

function startApplying(deps: PipelineApplyDeps, claim: ApplyClaim, bound: { snapshot: ProjectSnapshot; approvalToken: string }): void {
  const { state } = deps;
  const { record, planId } = claim;
  if (state.workflowCoordinator.hasPlan(planId)) state.workflowCoordinator.beginApply(planId, approvalReference(bound.approvalToken), bound.snapshot.fingerprint, computePlanDigest(record.plan));
  state.collection.invalidate();
  state.inFlight = { kind: "apply_plan", id: planId, claimedAt: state.now().getTime() };
  record.status = "applying";
  record.updatedAt = state.now().toISOString();
  state.preApply = { planId, snapshot: bound.snapshot };
}

function bindApply(deps: PipelineApplyDeps, claim: ApplyClaim): ReceiverOutcome {
  const bound = bindingFor(deps, claim);
  if ("refusal" in bound) return bound.refusal;
  try {
    startApplying(deps, claim, bound);
  } catch (error) {
    clearPendingApply(deps, claim);
    deps.state.workflowCoordinator.markDivergence(claim.planId, decodeOrThrow(DIVERGENCE_FAILURE, error));
    return refuseApply(error instanceof Error ? error.message : String(error));
  }
  return accepted(200, { ok: true });
}

function admitApply(deps: PipelineApplyDeps, claim: ApplyClaim): ReceiverOutcome {
  const { record, planId, pendingClaim } = claim;
  if (record.status !== "approved") return refuseApply(`Plan ${planId} is ${record.status} and cannot begin another host apply.`);
  if (deps.state.inFlight && !pendingClaim) return refuseApply("Another host apply or undo currently owns the shared dispatch lane.");
  return bindApply(deps, claim);
}

function activeApplyMatches(deps: PipelineApplyDeps, record: PlanRecord, planId: string): boolean {
  const inFlight = deps.state.inFlight;
  return record.status === "applying" && inFlight?.kind === "apply_plan" && inFlight.id === planId;
}

function quarantineMessage(deps: PipelineApplyDeps): string | undefined {
  const { state } = deps;
  const quarantine = state.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(state.inFlight) ?? state.collection.nativeAccessQuarantine();
  return quarantine ? String(quarantine.message) : undefined;
}

/** The host's claim to start applying an approved plan: admitted, or refused before any mutation. */
export function beginPipelineApply(deps: PipelineApplyDeps, detail: string): ReceiverOutcome {
  const quarantine = quarantineMessage(deps);
  if (quarantine !== undefined) return refuseApply(quarantine);
  const planId = claimedPlanId(detail);
  if (!planId) return refuseApply("The host apply claim did not identify an approved plan.");
  const record = deps.state.plans.get(planId);
  if (!record) return refuseApply("The sidecar has no approved plan for this host apply claim.");
  const inFlight = deps.state.inFlight;
  const pendingClaim = inFlight?.kind === "apply_pending" && inFlight.id === planId;
  if (activeApplyMatches(deps, record, planId)) return duplicateApplyBegin(deps, record);
  return admitApply(deps, { record, planId, pendingClaim });
}
