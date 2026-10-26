// Where an operation's target is grounded: the exact current snapshot and selection identity, plus the layer, composition and
// project ids the plan may legally name.
import { openCompositionNotRead, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import type { PlanBounds, V2TargetReference } from "./plan-types.js";
import { exactLayerTarget, isCurrentIdentity } from "./plan-shape.js";
import { hasOnlyKeys, invalid, isNewPlaceholderId, objectsIn, stringAt, targetOf, type OperationResult, type Refusal } from "./validation-primitives.js";

/** One operation plus everything its kind needs: the plan it belongs to, the snapshot, and the operations before it. */
export type OperationContext = { readonly operation: JsonObject; readonly plan: JsonObject; readonly snapshot: ProjectSnapshot | undefined; readonly bounds: PlanBounds; readonly index: number; readonly earlier: readonly JsonValue[]; readonly later: readonly JsonValue[] };

/** A context whose target already carries the exact current snapshot and selection identity. */
export type GroundedContext = OperationContext & { readonly target: V2TargetReference };

export type LayerAddress = { readonly compositionId: string; readonly layerId: string };
export type CompositionAddress = { readonly compositionId: string };
export type KindValidator = (context: OperationContext) => OperationResult;
type GroundedKindValidator = (context: GroundedContext) => OperationResult;

/** How one operation kind is validated: directly, or only after its layer target has been grounded in the snapshot and the plan. */
export type OperationRule = { readonly grounded: false; readonly validate: KindValidator } | { readonly grounded: true; readonly validate: GroundedKindValidator };

type ObservedLayer = ProjectSnapshot["compositions"][number]["layers"][number];
type ObservedComposition = ProjectSnapshot["compositions"][number];

const COMPOSITION_TARGET_FIELDS: readonly string[] = ["compositionId", "snapshotFingerprint", "selectionFingerprint"];
const EFFECT_PATH_PATTERN = /^ADBE Effect Parade\/[^/]+$/;
const INHERITANCE_DEPTH_LIMIT = 8;
const COMPOSITION_LIST_LIMIT = 20;
const LAYER_LIST_LIMIT = 24;
const COMPOSITION_PRODUCERS: readonly string[] = ["create_composition", "precompose_layers", "duplicate_composition"];
const LAYER_PRODUCERS: readonly string[] = ["duplicate_layer", "precompose_layers", "derive_layer"];

export function observedLayerExists(snapshot: ProjectSnapshot, target: LayerAddress): boolean {
  return snapshot.compositions.some((composition) => composition.id === target.compositionId && composition.layers.some((layer) => layer.id === target.layerId));
}

/** The observed layer, if the snapshot holds it; the one place a target's AE layer is read. */
export function observedLayer(snapshot: ProjectSnapshot | undefined, target: LayerAddress): ObservedLayer | undefined {
  return snapshot?.compositions.find((composition) => composition.id === target.compositionId)?.layers.find((layer) => layer.id === target.layerId);
}

/** The layer target every non-extended layer family shares: exact identity, optionally with no effect/property path. */
export function currentLayerTarget(operation: JsonObject, plan: JsonObject, bare: boolean, staleMessage: string): V2TargetReference | Refusal {
  const target = exactLayerTarget(operation.target, plan);
  if (!target) return invalid("STALE_TARGET", staleMessage);
  if (bare && !hasBareLayerTarget(target)) return invalid("STALE_TARGET", staleMessage);
  return target;
}

/** The layer-existence refusal each layer family shares, named with the ids the plan may legally have used. */
export function plannedOrObservedLayer(context: OperationContext, target: V2TargetReference, notFoundMessage: string): Refusal | undefined {
  const { snapshot, earlier } = context;
  if (!snapshot) return undefined;
  if (observedLayerExists(snapshot, target) || hasPlannedLayer(earlier, target) || inheritedLayerExists(snapshot, earlier, target)) return undefined;
  return invalid("TARGET_NOT_FOUND", `${notFoundMessage} ${listedLayers(snapshot, target, earlier)}`);
}

/**
 * The shared tail every layer-grounded kind runs: exact identity first, then a composition and layer that exist or are planned.
 * Refusals name the legal ids so the next call can be the corrected one, the same shape compositionNotFound and layerNotFound use on the read path.
 */
export function groundOperationTarget(context: OperationContext): V2TargetReference | Refusal {
  const { operation, plan, snapshot, earlier } = context;
  const target = exactLayerTarget(operation.target, plan);
  if (!target) return invalid("STALE_TARGET", "Every v0.2 operation must carry the exact current snapshot and selection identity.");
  if (!snapshot) return target;
  if (!snapshot.compositions.some((composition) => composition.id === target.compositionId) && !hasPlannedComposition(earlier, target.compositionId)) return invalid("TARGET_NOT_FOUND", `The target composition is not present or created earlier in this plan. ${listedCompositions(snapshot, earlier, target.compositionId)}`);
  if (!isPlannedLayerTarget(operation, target, context)) return invalid("TARGET_NOT_FOUND", `The exact target is not present in the current snapshot. ${listedLayers(snapshot, target, earlier)}`);
  return target;
}

function isPlannedLayerTarget(operation: JsonObject, target: V2TargetReference, { snapshot, earlier }: OperationContext): boolean {
  const exists = snapshot !== undefined && (observedLayerExists(snapshot, target) || inheritedLayerExists(snapshot, earlier, target));
  return exists || (operation.type === "create_layer" && isNewPlaceholderId(target.layerId)) || hasPlannedLayer(earlier, target);
}

function inheritedLayerExists(snapshot: ProjectSnapshot, earlier: readonly JsonValue[], target: LayerAddress, depth = 0): boolean {
  if (depth > INHERITANCE_DEPTH_LIMIT) return false;
  return objectsIn(earlier).some((operation) => {
    const sourceId = duplicateSourceId(operation, target.compositionId);
    if (sourceId === undefined) return false;
    const source = { compositionId: sourceId, layerId: target.layerId };
    return observedLayerExists(snapshot, source) || hasPlannedLayer(earlier, source) || inheritedLayerExists(snapshot, earlier, source, depth + 1);
  });
}

function duplicateSourceId(operation: JsonObject, compositionId: string): string | undefined {
  if (operation.type !== "duplicate_composition" || operation.newCompositionId !== compositionId) return undefined;
  return stringAt(targetOf(operation), "compositionId");
}

export function hasPlannedLayer(operations: readonly JsonValue[], target: LayerAddress): boolean {
  return objectsIn(operations).some((operation) => plannedLayerProducer(operation, target));
}

function plannedLayerProducer(operation: JsonObject, target: LayerAddress): boolean {
  if (!operationTargetsComposition(operation, target)) return false;
  if (operation.type === "create_layer") return targetOf(operation)?.layerId === target.layerId;
  return isLayerProducerType(operation.type) && operation.newLayerId === target.layerId;
}

function operationTargetsComposition(operation: JsonObject, target: { readonly compositionId: string }): boolean {
  return targetOf(operation)?.compositionId === target.compositionId;
}

export function operationTargetsLayer(operation: JsonObject, target: LayerAddress): boolean {
  const operationTarget = targetOf(operation);
  return operationTarget?.compositionId === target.compositionId && operationTarget.layerId === target.layerId;
}

export function operationPropertyPath(operation: JsonObject): JsonValue | undefined { return targetOf(operation)?.propertyPath; }

function isCompositionProducer(operation: JsonObject): boolean { return COMPOSITION_PRODUCERS.includes(String(operation.type)); }
function isLayerProducerType(type: JsonValue | undefined): boolean { return typeof type === "string" && LAYER_PRODUCERS.includes(type); }

export function hasPlannedComposition(operations: readonly JsonValue[], compositionId: string): boolean {
  return objectsIn(operations).some((operation) => isCompositionProducer(operation) && operation.newCompositionId === compositionId);
}

function plannedCompositionLabel(operations: readonly JsonValue[], compositionId: string): string | undefined {
  const producer = objectsIn(operations).find((operation) => isCompositionProducer(operation) && operation.newCompositionId === compositionId);
  if (!producer) return undefined;
  const name = producer.name;
  return `${compositionId}${typeof name === "string" && name ? ` "${name}"` : ""}`;
}

/** The composition ids a TARGET_NOT_FOUND refusal may legally have named: what the snapshot holds (bounded to 20, as compositionNotFound is) plus the ones the plan itself creates earlier. */
export function listedCompositions(snapshot: ProjectSnapshot, operations: readonly JsonValue[], missingId = ""): string {
  const unread = openCompositionNotRead(snapshot, missingId);
  if (unread) return unread;
  const observed = snapshot.compositions.slice(0, COMPOSITION_LIST_LIMIT).map((composition) => `${composition.id} "${composition.name}"`);
  const more = snapshot.compositions.length > COMPOSITION_LIST_LIMIT ? `, … ${snapshot.compositions.length - COMPOSITION_LIST_LIMIT} more` : "";
  const planned = plannedCompositionIds(operations).map((id) => plannedCompositionLabel(operations, id) ?? id);
  const active = snapshot.activeCompositionId ? ` The active composition is ${snapshot.activeCompositionId}.` : "";
  return `Compositions: ${observed.join(", ") || "none"}${more}.${planned.length ? ` This plan creates: ${planned.join(", ")}.` : ""}${active}`;
}

function plannedCompositionIds(operations: readonly JsonValue[]): string[] {
  return objectsIn(operations).flatMap((operation) => {
    const id = operation.newCompositionId;
    return isCompositionProducer(operation) && typeof id === "string" ? [id] : [];
  });
}

function plannedLayerIdsOf(operation: JsonObject, compositionId: string): string[] {
  const operationTarget = targetOf(operation);
  if (operationTarget?.compositionId !== compositionId) return [];
  const createdLayerId = operation.type === "create_layer" ? operationTarget.layerId : undefined;
  if (typeof createdLayerId === "string") return [createdLayerId];
  const newLayerId = operation.newLayerId;
  return isLayerProducerType(operation.type) && typeof newLayerId === "string" ? [newLayerId] : [];
}

/** The layer ids a target refusal may legally have named: the target composition's layers (24-entry bound, the shape layerNotFound uses) plus the layers this plan creates or duplicates there. */
export function listedLayers(snapshot: ProjectSnapshot, target: LayerAddress, operations: readonly JsonValue[]): string {
  const composition = snapshot.compositions.find((candidate) => candidate.id === target.compositionId);
  return (composition ? undefined : openCompositionNotRead(snapshot, target.compositionId)) ?? layerList(composition, target.compositionId, operations);
}

function observedLayerSummary(composition: ObservedComposition | undefined): string {
  const observed = (composition?.layers ?? []).slice(0, LAYER_LIST_LIMIT).map((layer) => `${layer.id} "${layer.name}" (${layer.type}, index ${layer.index})`);
  const more = composition && composition.layers.length > LAYER_LIST_LIMIT ? `, … ${composition.layers.length - LAYER_LIST_LIMIT} more` : "";
  return `${observed.join(", ") || "none"}${more}`;
}

function layerList(composition: ObservedComposition | undefined, compositionId: string, operations: readonly JsonValue[]): string {
  const planned = objectsIn(operations).flatMap((operation) => plannedLayerIdsOf(operation, compositionId));
  const where = composition ? `${composition.id} "${composition.name}"` : `${plannedCompositionLabel(operations, compositionId) ?? compositionId} (created earlier in this plan)`;
  return `Layers in ${where}: ${observedLayerSummary(composition)}.${planned.length ? ` This plan creates: ${planned.join(", ")}.` : ""}`;
}

export function hasPlannedEffect(operations: readonly JsonValue[], target: V2TargetReference): boolean {
  return objectsIn(operations).some((operation) => {
    const operationTarget = targetOf(operation);
    return operation.type === "ensure_effect" && operationTarget?.compositionId === target.compositionId && operationTarget.layerId === target.layerId && operationTarget.effectPath === target.effectPath && operation.effectPath === target.effectPath;
  });
}

/** True when an earlier create_layer in this plan creates the target layer as a text layer. */
export function hasPlannedTextDocument(operations: readonly JsonValue[], target: V2TargetReference): boolean {
  return objectsIn(operations).some((operation) => operation.type === "create_layer" && operation.layerType === "text" && operationTargetsLayer(operation, target));
}

export function hasBareLayerTarget(target: V2TargetReference): boolean { return target.effectPath === undefined && target.propertyPath === undefined; }

function currentCompositionId(operation: JsonObject, plan: JsonObject): string | undefined {
  const target = targetOf(operation);
  const compositionId = target?.compositionId;
  return target && typeof compositionId === "string" && isCurrentIdentity(target, plan) && hasOnlyKeys(target, COMPOSITION_TARGET_FIELDS) ? compositionId : undefined;
}

/** The composition an extended operation addresses: an exact current composition target naming a composition that exists or is created earlier in the plan. */
export function compTarget(context: OperationContext): CompositionAddress | Refusal {
  const { operation, plan, snapshot, earlier } = context;
  const compositionId = currentCompositionId(operation, plan);
  if (compositionId === undefined) return invalid("STALE_TARGET", `${String(operation.type)} requires an exact current composition target.`);
  if (snapshot && !snapshot.compositions.some((composition) => composition.id === compositionId) && !hasPlannedComposition(earlier, compositionId)) return invalid("TARGET_NOT_FOUND", `Composition target is not present or created earlier in this plan. ${listedCompositions(snapshot, earlier, compositionId)}`);
  return { compositionId };
}

/** The layer an extended operation addresses: an exact current layer target with no effect path, and a property path only when `allowProperty`. */
export function layerTarget(context: OperationContext, allowProperty: boolean): V2TargetReference | Refusal {
  const { operation, plan } = context;
  const target = exactLayerTarget(operation.target, plan);
  if (!target || target.effectPath !== undefined || !(allowProperty || target.propertyPath === undefined)) return invalid("STALE_TARGET", `${String(operation.type)} requires an exact layer target${allowProperty ? "" : " without property paths"}.`);
  return plannedOrObservedLayer(context, target, "Target layer must exist or be created earlier in this plan.") ?? target;
}

/** A layer target that names one effect on the layer (target.effectPath, no propertyPath): the layer must exist or be created earlier in the plan. */
export function effectTarget(context: OperationContext): V2TargetReference | Refusal {
  const { operation, plan } = context;
  const target = exactLayerTarget(operation.target, plan);
  if (!target || target.propertyPath !== undefined || typeof target.effectPath !== "string" || !EFFECT_PATH_PATTERN.test(target.effectPath)) return invalid("STALE_TARGET", `${String(operation.type)} requires an exact layer target with effectPath "ADBE Effect Parade/<effect matchName>" ("#N" appended for the Nth instance) and no propertyPath.`);
  return plannedOrObservedLayer(context, target, "Target layer must exist or be created earlier in this plan.") ?? target;
}
