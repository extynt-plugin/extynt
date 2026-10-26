// The host-ae entry points: a validated, approved plan becomes one apply_plan command for the panel.
import { metadataReadSet, resolveNativeVectorWrites, validateActionPlan, type ActionPlan, type ActionPlanV2, type ApprovalBinding } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { compileCaptureCommand as compileVisualCapture, type CaptureCommand, type WireValue } from "@extynt/visual-evidence";
import { PLAN_UNDO_BATCH_SIZE, type HostPlanCommand } from "./host-plan-operation.js";
import { refuse, type CompilationRefusal } from "./v2/compiler-table.js";
import { compileHostOperations } from "./v2/dispatch.js";

export type HostCaptureCommand = CaptureCommand;

export function compileCaptureCommand(request: WireValue, captureId: string): HostCaptureCommand | CompilationRefusal {
  return compileVisualCapture(request, captureId);
}

/** Static vector writes may spell "keep this component" as null, so the merge runs here and the host never passes a null to setValue. */
export function compileV2Plan(plan: ActionPlanV2, snapshot?: ProjectSnapshot): HostPlanCommand | CompilationRefusal {
  const resolved = resolveNativeVectorWrites(plan, snapshot);
  if (!resolved.ok) return refuse(resolved.code, resolved.message);
  const compiled = compileHostOperations(resolved.operations);
  if (!compiled.ok) return compiled;
  const readSet = snapshot === undefined ? undefined : metadataReadSet(plan, snapshot);
  return {
    operation: "apply_plan", planId: plan.planId, operations: compiled.operations, undoGroup: `extynt — ${plan.planId}`,
    ...(readSet ? { readSet } : {}),
    ...(compiled.operations.length > PLAN_UNDO_BATCH_SIZE ? { batchSize: PLAN_UNDO_BATCH_SIZE } : {}),
  };
}

function approvalBindsPlan(plan: ActionPlan, snapshot: ProjectSnapshot, approval: ApprovalBinding): boolean {
  return approval.planId === plan.planId && approval.snapshotFingerprint === snapshot.fingerprint && approval.selectionFingerprint === snapshot.selectionFingerprint && approval.freshness.revision === snapshot.freshness.revision;
}

function isPlanV2(plan: ActionPlan): plan is ActionPlanV2 {
  return plan.selectionFingerprint !== undefined && plan.freshness !== undefined && plan.bounds !== undefined && plan.digest !== undefined
    && Array.isArray(plan.preconditions) && Array.isArray(plan.conflicts) && Array.isArray(plan.postconditions);
}

/** A one-time approval is bound to this plan, this snapshot and this selection revision; every compiler checks it the same way. */
export function compileCommand(plan: ActionPlan, snapshot: ProjectSnapshot, approval: ApprovalBinding): HostPlanCommand | CompilationRefusal {
  const validation = validateActionPlan(plan, snapshot);
  if (!validation.ok) return validation;
  if (!approvalBindsPlan(plan, snapshot, approval)) return refuse("APPROVAL_MISMATCH", "Approval is not bound to this plan and current snapshot.");
  if (snapshot.coverage && approval.readSetDigest !== metadataReadSet(plan, snapshot)?.digest) return refuse("APPROVAL_MISMATCH", "Approval does not bind the declared read set.");
  if (!isPlanV2(plan)) return refuse("INVALID_PLAN", "Expected a complete v0.2 plan.");
  return compileV2Plan(plan, snapshot);
}
