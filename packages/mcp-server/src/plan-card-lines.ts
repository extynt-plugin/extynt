// The approval card's words: the names a plan gives its new objects, the expressions it writes and the layer it targets.
import type { ActionPlanV2Operation, V2TargetReference } from "@extynt/action-plan";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { EXPRESSION_PRESENTATION_SOURCE_CHARS } from "./core-constants.js";

/** Names of new objects declared in a plan: new layers and new compositions. */
export type PlanObjectNames = {
  layers: Map<string, string>;
  compositions: Map<string, string>;
};

/** An expression's source cut to the width a card shows. */
export function boundedExpressionSource(source: string, limit: number): string {
  return source.length > limit ? `${source.slice(0, limit - 1)}…` : source;
}

function nameOf(operation: ActionPlanV2Operation): string | undefined {
  return "name" in operation && typeof operation.name === "string" ? operation.name : undefined;
}

function nameLayersOf(layers: Map<string, string>, operation: ActionPlanV2Operation): void {
  const named = (id: string, name: string | undefined): void => {
    if (name !== undefined && id.startsWith("__new__:")) layers.set(id, name);
  };
  if (operation.type === "create_layer") named(operation.target.layerId, nameOf(operation));
  if (operation.type === "duplicate_layer" || operation.type === "precompose_layers") named(operation.newLayerId, nameOf(operation));
}

function nameCompositionsOf(compositions: Map<string, string>, operation: ActionPlanV2Operation): void {
  const name = nameOf(operation);
  const creates = operation.type === "precompose_layers" || operation.type === "duplicate_composition" || operation.type === "create_composition";
  if (creates && name !== undefined) compositions.set(operation.newCompositionId, name);
}

/** The names a plan gives the layers and compositions it creates. */
export function newObjectNames(operations: readonly ActionPlanV2Operation[]): PlanObjectNames {
  const names: PlanObjectNames = { layers: new Map(), compositions: new Map() };
  for (const operation of operations) {
    nameLayersOf(names.layers, operation);
    nameCompositionsOf(names.compositions, operation);
  }
  return names;
}

/** Every enabled expression the plan writes, in the shape the panel's card consumes. */
export function presentationExpressions(operations: readonly ActionPlanV2Operation[]): Array<{ propertyPath: string; source: string }> {
  return operations.flatMap((operation) => {
    if (operation.type !== "set_expression" || !operation.source || operation.enabled === false) return [];
    return [{ propertyPath: operation.target.propertyPath ?? "", source: boundedExpressionSource(operation.source, EXPRESSION_PRESENTATION_SOURCE_CHARS) }];
  });
}

/** The name the card shows for the layer an operation targets. */
export function describeTargetLayer(snapshot: ProjectSnapshot, target: V2TargetReference, names?: PlanObjectNames): string {
  if (target.layerId.startsWith("__new__:")) return names?.layers.get(target.layerId) ?? "New layer";
  const composition = snapshot.compositions.find((candidate) => candidate.id === target.compositionId);
  return composition?.layers.find((layer) => layer.id === target.layerId)?.name ?? target.layerId;
}
