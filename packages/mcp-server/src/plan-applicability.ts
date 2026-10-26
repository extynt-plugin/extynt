// Registry applicability: whether each operation applies to the kind of layer it addresses.
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { NATIVE_OPERATION_REGISTRY } from "@extynt/capability-catalogue";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { CREATED_LAYER_TYPES, LAYER_TYPES } from "./core-constants.js";
import { objectAt, stringAt } from "./json.js";
import { operationJson } from "./operations.js";
import type { PlanProblem } from "./plan-problem.js";

type LayerAddress = { compositionId: string; layerId: string };

function allowedApplicability(operationType: string): Set<string> {
  return new Set<string>(NATIVE_OPERATION_REGISTRY
    .filter((entry) => entry.implementationStatus === "implemented" && entry.planTypes.includes(operationType))
    .flatMap((entry) => entry.applicability)
    .filter((kind) => LAYER_TYPES.has(kind)));
}

function addressOf(operation: ActionPlanV2Operation): LayerAddress | undefined {
  const target = objectAt(operationJson(operation), "target");
  const compositionId = stringAt(target, "compositionId");
  const layerId = stringAt(target, "layerId");
  return compositionId && layerId ? { compositionId, layerId } : undefined;
}

function keyOf(address: LayerAddress): string {
  return `${address.compositionId}:${address.layerId}`;
}

function observedType(address: LayerAddress, snapshot: ProjectSnapshot): string | undefined {
  return snapshot.compositions.find((composition) => composition.id === address.compositionId)?.layers.find((layer) => layer.id === address.layerId)?.type;
}

function mismatchMessage(index: number, type: string, layerType: string, allowed: Set<string>): string {
  const layer = layerType === "av" ? "a footage, solid, or precomp" : `a ${layerType}`;
  return `Operation ${index} (${type}) does not apply to ${layer} layer; it applies to ${[...allowed].join(", ")} layers.`;
}

function mismatchedType(allowed: Set<string>, layerType: string | undefined): string | undefined {
  return !allowed.size || !layerType || layerType === "unknown" || allowed.has(layerType) ? undefined : layerType;
}

function problemAt(operation: ActionPlanV2Operation, index: number, planned: Map<string, string>, snapshot: ProjectSnapshot): PlanProblem | undefined {
  const address = addressOf(operation);
  if (!address) return undefined;
  if (operation.type === "create_layer") {
    planned.set(keyOf(address), CREATED_LAYER_TYPES[operation.layerType] ?? "unknown");
    return undefined;
  }
  const allowed = allowedApplicability(operation.type);
  const layerType = mismatchedType(allowed, planned.get(keyOf(address)) ?? observedType(address, snapshot));
  if (!layerType) return undefined;
  return { index, type: operation.type, code: "APPLICABILITY_MISMATCH", message: mismatchMessage(index, operation.type, layerType, allowed) };
}

/**
 * Every applicability problem, so a plan with two wrong targets reports both.
 * Operations are walked in order because a later one may target a layer an earlier `create_layer` brings into existence.
 */
export function applicabilityProblems(operations: readonly ActionPlanV2Operation[], snapshot: ProjectSnapshot): PlanProblem[] {
  const planned = new Map<string, string>();
  return operations.flatMap((operation, index) => problemAt(operation, index, planned, snapshot) ?? []);
}
