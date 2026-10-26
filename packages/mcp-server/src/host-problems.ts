// Checks that need live host evidence rather than the snapshot: presets and effects this host lacks,
// effects that block After Effects on a dialog, and control values outside the probed range.
import { PRESET_ID_PATTERN } from "@extynt/action-plan";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { EFFECT_HOST_CAVEATS, effectControlValueError, inventoryIsAuthoritative } from "@extynt/capability-catalogue";
import type { HostCapabilityProfile } from "@extynt/capability-catalogue";
import type { ToolContext } from "./contracts.js";
import { objectAt, stringAt } from "./json.js";
import { operationJson } from "./operations.js";
import type { PlanProblem } from "./plan-problem.js";

type ApplyPresetOperation = Extract<ActionPlanV2Operation, { type: "apply_preset" }>;
type EnsureEffectOperation = Extract<ActionPlanV2Operation, { type: "ensure_effect" }>;
type SetEffectControlOperation = Extract<ActionPlanV2Operation, { type: "set_effect_control" }>;
type AnimateControlOperation = Extract<ActionPlanV2Operation, { type: "animate_control" }>;
type HostRefusal = { code: string; message: string };
type ControlTarget = { effectMatchName: string; controlMatchName: string };

function presetProblem(operation: ApplyPresetOperation, context: ToolContext): HostRefusal | undefined {
  if (typeof operation.presetId !== "string" || !PRESET_ID_PATTERN.test(operation.presetId)) return undefined;
  const preset = context.hostProfile?.entries.find((entry) => entry.kind === "preset" && entry.id === operation.presetId);
  if (preset || (context.hostProfile && !inventoryIsAuthoritative(context.hostProfile))) return undefined;
  return { code: "PRESET_NOT_FOUND", message: `No preset with id ${operation.presetId} is installed in this copy of After Effects, according to a complete scan of it. Nothing was changed. Find one with ae_search_host_capabilities kinds:["preset"] and pass its id.` };
}

function curatedMatchNameProblem(operation: EnsureEffectOperation, byId: HostCapabilityProfile["entries"][number] | undefined): HostRefusal | undefined {
  const matchName = byId?.matchName;
  if (byId?.kind !== "effect" || typeof matchName !== "string" || matchName === operation.effectMatchName) return undefined;
  return { code: "INVALID_TARGET", message: `Capability ${operation.capabilityId} is ${matchName}, not ${operation.effectMatchName}. Nothing was changed.` };
}

function installationProblem(operation: EnsureEffectOperation, profile: HostCapabilityProfile): HostRefusal | undefined {
  const byId = profile.entries.find((entry) => entry.id === operation.capabilityId);
  const installed = byId ?? profile.entries.find((entry) => entry.kind === "effect" && entry.matchName === operation.effectMatchName);
  const notInstalled = { code: "EFFECT_NOT_INSTALLED", message: `${operation.effectMatchName} is not installed in this copy of After Effects, according to a complete scan of it. Nothing was changed. Use a different effect, or search with ae_search_host_capabilities kinds:["effect"] to see what this host does have.` };
  if (installed?.availability === "unavailable" || (!installed && inventoryIsAuthoritative(profile))) return notInstalled;
  return curatedMatchNameProblem(operation, byId);
}

function invalidValue(error: string | null): HostRefusal | undefined {
  return error ? { code: "INVALID_VALUE", message: `${error} Nothing was changed.` } : undefined;
}

function controlProblem(operation: SetEffectControlOperation, found: ControlTarget, context: ToolContext): HostRefusal | undefined {
  return invalidValue(effectControlValueError(context.hostProfile, found.effectMatchName, found.controlMatchName, operation.value));
}

function keyframeProblem(operation: AnimateControlOperation, found: ControlTarget, context: ToolContext): HostRefusal | undefined {
  for (const key of operation.keyframes ?? []) {
    const problem = invalidValue(effectControlValueError(context.hostProfile, found.effectMatchName, found.controlMatchName, key.value));
    if (problem) return problem;
  }
  return undefined;
}

function effectValueProblem(operation: ActionPlanV2Operation, found: ControlTarget, context: ToolContext): HostRefusal | undefined {
  if (operation.type === "ensure_effect") return EFFECT_HOST_CAVEATS[found.effectMatchName];
  if (operation.type === "set_effect_control") return controlProblem(operation, found, context);
  return operation.type === "animate_control" ? keyframeProblem(operation, found, context) : undefined;
}

function operationProblem(operation: ActionPlanV2Operation, context: ToolContext): HostRefusal | undefined {
  if (operation.type === "apply_preset") return presetProblem(operation, context);
  const installation = operation.type === "ensure_effect" && context.hostProfile ? installationProblem(operation, context.hostProfile) : undefined;
  const written = operationJson(operation);
  const effectMatchName = stringAt(written, "effectMatchName");
  if (installation || effectMatchName === undefined) return installation;
  const propertyPath = stringAt(objectAt(written, "target"), "propertyPath") ?? "";
  return effectValueProblem(operation, { effectMatchName, controlMatchName: propertyPath.split("/").pop() ?? "" }, context);
}

/** The per-operation host problems, each with the index it belongs to; an operation with several reports its first. */
export function hostOperationProblems(operations: readonly ActionPlanV2Operation[], context: ToolContext): PlanProblem[] {
  return operations.flatMap((operation, index) => {
    const problem = operationProblem(operation, context);
    return problem ? [{ index, type: operation.type, ...problem }] : [];
  });
}
