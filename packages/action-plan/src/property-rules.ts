// Property addressing: what the snapshot observes at an exact path, which paths a plan may name before they exist, and the
// conflicts a write meets on a property that already has keys or a parent chain that loops.
import { TEXT_DOCUMENT_PATH } from "./plan-constants.js";
import { flattenProperties, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { PATH_PROPERTY_LEAVES, pathPropertyHint, TIME_REMAP_PATH } from "./layer-derive-ops.js";
import { hasPlannedTextDocument, observedLayer, observedLayerExists, operationPropertyPath, operationTargetsLayer, type LayerAddress } from "./layer-targets.js";
import { nativeRoleForPath } from "./native-property-rules.js";
import type { V2TargetReference } from "./plan-types.js";
import { hasPlannedAnimatorProperty } from "./text-animator-paths.js";
import { invalid, isOneOf, type Refusal } from "./validation-primitives.js";

const LAYER_LEVEL_GROUPS: readonly string[] = ["ADBE Transform Group", "ADBE Text Properties", "ADBE Effect Parade", "ADBE Mask Parade", "ADBE Root Vectors Group", "ADBE Marker", "ADBE Audio Group", "ADBE Material Options Group", "ADBE Layer Styles", "ADBE Camera Options Group", "ADBE Light Options Group"];
const MAX_PATH_SEGMENTS = 16;
const MAX_PARENT_CHAIN_DEPTH = 1024;

/** One property as the snapshot observed it. */
export type ObservedProperty = PropertySnapshot;

export { isAllowlistedNativeProperty, NATIVE_PROPERTY_PATHS, NATIVE_PROPERTY_ROLES, nativeRoleForPath, nativeValueError, resolveNativeVectorValue, type NativeVectorResolution } from "./native-property-rules.js";

/** The property the snapshot lists at the target's exact property path. */
export function observedProperty(snapshot: ProjectSnapshot | undefined, target: V2TargetReference): ObservedProperty | undefined {
  const layer = observedLayer(snapshot, target);
  if (!layer || !target.propertyPath) return undefined;
  return flattenProperties(layer.properties).find((candidate) => candidate.path === target.propertyPath);
}

/** True when the census flags the targeted property as unable to vary over time (for example "Appears in Reflections"); keyframes on it are refused before approval. */
export function observedNotAnimatable(snapshot: ProjectSnapshot | undefined, target: V2TargetReference): boolean { return observedProperty(snapshot, target)?.animatable === false; }

/** For a refused mask or shape path target, the path properties the layer really has; empty for any other property. */
export function pathLeafHint(snapshot: ProjectSnapshot, target: V2TargetReference): string {
  const leaf = target.propertyPath?.split("/").pop()?.replace(/\[#\d+\]$/, "");
  if (leaf === undefined || !isOneOf(leaf, PATH_PROPERTY_LEAVES)) return "";
  const layer = observedLayer(snapshot, target);
  return layer ? pathPropertyHint(layer) : "";
}

/**
 * True for a well-formed path on a layer the snapshot holds. A property the snapshot does not list can still exist live: rig controls
 * (Duik controllers, effect controls on nulls) sit deep in the tree and the snapshot is bounded, so the host resolves the path against
 * the live property tree before any write and refuses the plan with PROPERTY_NOT_FOUND when it is not there. A layer this plan creates
 * has no live tree yet, so only the materialisation rules may ground a path on it. Every layer-level group is an ADBE matchName; a
 * display name ("Opacity") or a bare leaf of a nested group never resolves from the layer.
 */
export function isHostResolvablePath(snapshot: ProjectSnapshot | undefined, target: V2TargetReference, propertyPath: string | undefined): boolean {
  if (!snapshot || !observedLayerExists(snapshot, target)) return false;
  return isPlainPathString(propertyPath) && isAddressablePath(propertyPath.split("/"));
}

/** True when the snapshot lists the target's property path, as a control of the target's effect (`effectControl`) or outside any effect. */
export function propertyMatchesTarget(snapshot: ProjectSnapshot, target: V2TargetReference, effectControl: boolean): boolean {
  const property = observedProperty(snapshot, target);
  if (!property) return false;
  return effectControl ? !!target.effectPath && property.path.startsWith(`${target.effectPath}/`) : !target.effectPath;
}

/**
 * True when the exact path resolves without the snapshot listing it: a typed native transform role, or a path an earlier operation in
 * this same plan materialises (an ordinal-aware text animator property, a native role path an earlier write addressed, Source Text of
 * a created text layer, or Time Remap). Nothing else resolves: no prefix match, no wildcard, and never an effect control path.
 */
export function isMaterialisedPropertyPath(operations: readonly JsonValue[], snapshot: ProjectSnapshot | undefined, target: V2TargetReference, propertyPath: string | undefined): boolean {
  if (!propertyPath) return false;
  if (nativeRoleForPath(propertyPath) !== undefined) return true;
  if (propertyPath === TEXT_DOCUMENT_PATH && hasPlannedTextDocument(operations, target)) return true;
  return hasPlannedNativeProperty(operations, target, propertyPath) || hasPlannedAnimatorProperty(operations, snapshot, target, propertyPath) || hasPlannedTimeRemap(operations, target, propertyPath);
}

/** True when an earlier step in the plan animates this exact property or effect control. */
export function animatesProperty(operation: JsonValue, target: LayerAddress, propertyPath: string): boolean {
  if (!isJsonObject(operation)) return false;
  return (operation.type === "animate_property" || operation.type === "animate_control") && operationTargetsLayer(operation, target) && operationPropertyPath(operation) === propertyPath;
}

/** The refusal for a keyframeMode of reject (the default) on a property that already has keys: it fails before approval, not mid-apply. After Effects seeds Time Remap with two keys, so an earlier step that turns on time remapping needs merge or replace too. */
export function existingKeyConflict(snapshot: ProjectSnapshot | undefined, target: V2TargetReference, mode: JsonValue | undefined, earlier: readonly JsonValue[]): Refusal | undefined {
  const propertyPath = target.propertyPath;
  if (mode === "merge" || mode === "replace" || !propertyPath) return undefined;
  if (hasPlannedTimeRemap(earlier, target, propertyPath)) return invalid("CONFLICTING_KEYS", "An earlier step in this plan turns on time remapping, and After Effects seeds Time Remap with two keyframes. Pass keyframeMode \"replace\" (or \"merge\") to write these keys.");
  return observedKeysConflict(snapshot, target, earlier, propertyPath);
}

/** The loop that setting this parent would close, walking the resulting parent chain (snapshot parents updated by earlier plan operations); undefined when there is none. */
export function parentCycle(snapshot: ProjectSnapshot | undefined, earlier: readonly JsonValue[], target: V2TargetReference, parentLayerId: string): string[] | undefined {
  const parents = new Map<string, string | null>();
  for (const layer of snapshot?.compositions.find((composition) => composition.id === target.compositionId)?.layers ?? []) parents.set(layer.id, layer.parentId);
  for (const operation of earlier) recordPlannedParent(parents, operation, target.compositionId);
  parents.set(target.layerId, parentLayerId);
  return parentChain(parents, target.layerId, parentLayerId);
}

function isAddressablePath(segments: readonly string[]): boolean {
  const [first = ""] = segments;
  if (segments.length === 1 && !LAYER_LEVEL_GROUPS.includes(first)) return false;
  return segments.length <= MAX_PATH_SEGMENTS && first.startsWith("ADBE ") && segments.every(isAddressableSegment);
}

function observedKeysConflict(snapshot: ProjectSnapshot | undefined, target: V2TargetReference, earlier: readonly JsonValue[], propertyPath: string): Refusal | undefined {
  const keyCount = observedProperty(snapshot, target)?.keyframeCount;
  if (keyCount === undefined || keyCount < 1 || earlier.some((operation) => animatesProperty(operation, target, propertyPath))) return undefined;
  return invalid("CONFLICTING_KEYS", `${propertyPath} already has ${keyCount} keyframe(s). Pass keyframeMode "merge" to add or overwrite keys at these times, or "replace" to clear the existing keys first.`);
}

function isAddressableSegment(segment: string): boolean { return segment.trim().length > 0 && segment !== "." && segment !== ".."; }

function isPlainPathString(value: string | undefined): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 1024 && /^[\x20-\x7e]+$/.test(value) && !/[[\]]/.test(value);
}

function hasPlannedNativeProperty(operations: readonly JsonValue[], target: V2TargetReference, propertyPath: string): boolean {
  return operations.some((operation) => isJsonObject(operation) && (operation.type === "animate_property" || operation.type === "set_layer_property") && operationTargetsLayer(operation, target) && operationPropertyPath(operation) === propertyPath);
}

function hasPlannedTimeRemap(operations: readonly JsonValue[], target: V2TargetReference, propertyPath: string): boolean {
  if (propertyPath !== TIME_REMAP_PATH) return false;
  return operations.some((operation) => isJsonObject(operation) && operationTargetsLayer(operation, target) && (operation.type === "retime_layer" || (operation.type === "set_time_remap" && operation.enabled === true)));
}

function recordPlannedParent(parents: Map<string, string | null>, operation: JsonValue, compositionId: string): void {
  if (!isJsonObject(operation) || operation.type !== "set_layer_parent") return;
  const target = operation.target;
  if (!isJsonObject(target) || target.compositionId !== compositionId || typeof target.layerId !== "string") return;
  const parentLayerId = operation.parentLayerId;
  parents.set(target.layerId, typeof parentLayerId === "string" ? parentLayerId : null);
}

function parentChain(parents: ReadonlyMap<string, string | null>, layerId: string, parentLayerId: string): string[] | undefined {
  const chain = [layerId];
  let cursor: string | null | undefined = parentLayerId;
  for (let depth = 0; cursor && depth < MAX_PARENT_CHAIN_DEPTH; depth += 1) {
    chain.push(cursor);
    if (cursor === layerId) return chain;
    cursor = parents.get(cursor);
  }
  return undefined;
}
