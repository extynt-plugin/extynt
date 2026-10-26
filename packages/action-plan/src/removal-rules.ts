// Earlier-removal accounting: a layer, item, mask or marker the plan already removed is as binding on later operations as an
// earlier producer. The host applies removals first and would fail mid-plan on a target that is already gone.
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { invalid, stringAt, targetOf, type Refusal } from "./validation-primitives.js";

const MARKER_TIME_TOLERANCE_SECONDS = 0.0005;
const MARKER_OPERATIONS: readonly string[] = ["add_marker", "update_marker", "remove_marker"];
const LAYER_REFERENCE_FIELDS = ["parentLayerId", "referenceLayerId", "matteLayerId"] as const;
const FOLDER_REFERENCE_FIELDS = ["folderId", "parentFolderId", "destinationFolderId"] as const;

type MaskOrdinalRemoval = { readonly compositionId: string; readonly layerId: string; readonly ordinal: number; readonly index: number };

type RemovalState = { readonly layers: Set<string>; readonly items: Set<string>; readonly masks: Set<string>; readonly maskOrdinals: MaskOrdinalRemoval[]; readonly markers: { compositionId: string; layerId: string; time: number }[] };

type RemovalContext = { readonly operation: JsonObject; readonly target: JsonObject | undefined; readonly index: number; readonly removed: RemovalState };
type RemovalRecorder = (context: RemovalContext) => void;

function maskRemovalKey(compositionId: string, layerId: string, maskId: string): string { return `${compositionId}\u0000${layerId}\u0000${maskId}`; }

function maskOrdinal(maskId: JsonValue | undefined): number | undefined {
  const match = typeof maskId === "string" ? /^mask:([1-9][0-9]{0,2})$/.exec(maskId) : null;
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function forgetOrRemember(set: Set<string>, id: string | undefined, remember: boolean): void {
  if (id === undefined) return;
  if (remember) set.add(id);
  else set.delete(id);
}

function recordNewId(field: string, pick: (removed: RemovalState) => Set<string>): RemovalRecorder {
  return ({ operation, removed }) => forgetOrRemember(pick(removed), stringAt(operation, field), false);
}

function recordTargetId(field: string, pick: (removed: RemovalState) => Set<string>, remember: boolean): RemovalRecorder {
  return ({ target, removed }) => forgetOrRemember(pick(removed), stringAt(target, field), remember);
}

function recordMaskRemoval({ operation, target, index, removed }: RemovalContext): void {
  const maskId = stringAt(operation, "maskId"), layerId = stringAt(target, "layerId"), compositionId = stringAt(target, "compositionId");
  if (maskId === undefined || layerId === undefined || compositionId === undefined) return;
  removed.masks.add(maskRemovalKey(compositionId, layerId, maskId));
  const ordinal = maskOrdinal(maskId);
  if (ordinal !== undefined) removed.maskOrdinals.push({ compositionId, layerId, ordinal, index });
}

function recordMarkerRemoval({ operation, target, removed }: RemovalContext): void {
  const compositionId = stringAt(target, "compositionId"), time = operation.time;
  if (compositionId === undefined || typeof time !== "number") return;
  removed.markers.push({ compositionId, layerId: stringAt(target, "layerId") ?? "", time });
}

const layersOf = (removed: RemovalState): Set<string> => removed.layers;
const itemsOf = (removed: RemovalState): Set<string> => removed.items;

const REMOVAL_RECORDERS: ReadonlyMap<string, RemovalRecorder> = new Map<string, RemovalRecorder>([
  ["remove_layer", recordTargetId("layerId", layersOf, true)],
  ["create_layer", recordTargetId("layerId", layersOf, false)],
  ["duplicate_layer", recordNewId("newLayerId", layersOf)],
  ["precompose_layers", recordNewId("newLayerId", layersOf)],
  ["derive_layer", recordNewId("newLayerId", layersOf)],
  ["duplicate_composition", recordNewId("newCompositionId", itemsOf)],
  ["delete_project_item", recordTargetId("itemId", itemsOf, true)],
  ["create_folder", recordNewId("newFolderId", itemsOf)],
  ["import_file", recordNewId("newItemId", itemsOf)],
  ["create_vector_artwork", recordNewId("newItemId", itemsOf)],
  ["remove_mask", recordMaskRemoval],
  ["remove_marker", recordMarkerRemoval],
]);

/**
 * Layer, item, mask and marker identities whose most recent earlier producer or remover is a remover. A layer or item removal is
 * not permanent, since a later create re-materialises the id, so only a still-removed reference is refused. A mask removal is
 * permanent within the plan, and ordinal removals keep their plan index because After Effects renumbers the ordinals above a
 * removal. Masks are ordinal-addressed within one layer, so a removal is keyed by layer too; markers are keyed by time rather than
 * id, with "" standing for the composition's own marker stream.
 */
export function earlierRemovals(operations: readonly JsonValue[]): RemovalState {
  const removed: RemovalState = { layers: new Set(), items: new Set(), masks: new Set(), maskOrdinals: [], markers: [] };
  for (const [index, value] of operations.entries()) {
    const type = isJsonObject(value) ? value.type : undefined;
    const recorder = typeof type === "string" ? REMOVAL_RECORDERS.get(type) : undefined;
    if (isJsonObject(value) && recorder) recorder({ operation: value, target: targetOf(value), index, removed });
  }
  return removed;
}

/**
 * The refusal for an operation that addresses something an earlier operation removed. `create_layer` names the id it introduces, so
 * it is the one operation that may reuse a removed layer id. The mask-ordinal check exists because on After Effects 26.2.1 a later
 * ordinal silently wrote to a different mask after a removal; descending removals stay legal.
 */
export function earlierRemovalError(operation: JsonObject, removed: RemovalState, index: number): Refusal | undefined {
  const target = targetOf(operation);
  if (!target) return undefined;
  return removedLayerReferenceError(operation, target, removed)
    ?? removedItemReferenceError(operation, target, removed)
    ?? removedMaskReferenceError(operation, target, removed)
    ?? shiftedMaskOrdinalError(operation, target, removed, index)
    ?? removedMarkerError(operation, target, removed);
}

function removedLayerReferenceError(operation: JsonObject, target: JsonObject, removed: RemovalState): Refusal | undefined {
  const layerId = target.layerId;
  if (typeof layerId === "string" && operation.type !== "create_layer" && removed.layers.has(layerId)) return invalid("TARGET_NOT_FOUND", `The target layer ${JSON.stringify(layerId)} was removed earlier in this plan and no longer exists; propose the remaining operations against a refreshed snapshot.`);
  return removedLayerIdFieldError(operation, removed) ?? removedLayerIdListError(operation, removed);
}

function removedLayerIdFieldError(operation: JsonObject, removed: RemovalState): Refusal | undefined {
  for (const key of LAYER_REFERENCE_FIELDS) {
    const value = operation[key];
    if (typeof value === "string" && removed.layers.has(value)) return invalid("TARGET_NOT_FOUND", `The ${key} ${JSON.stringify(value)} was removed earlier in this plan and no longer exists.`);
  }
  return undefined;
}

function removedLayerIdListError(operation: JsonObject, removed: RemovalState): Refusal | undefined {
  const layerIds = operation.layerIds;
  const id = isJsonArray(layerIds) ? layerIds.find((candidate) => typeof candidate === "string" && removed.layers.has(candidate)) : undefined;
  return id === undefined ? undefined : invalid("TARGET_NOT_FOUND", `Layer ${JSON.stringify(id)} was removed earlier in this plan and cannot be precomposed.`);
}

function removedItemReferenceError(operation: JsonObject, target: JsonObject, removed: RemovalState): Refusal | undefined {
  const itemId = target.itemId;
  if (typeof itemId === "string" && removed.items.has(itemId)) return invalid("TARGET_NOT_FOUND", `The target project item ${JSON.stringify(itemId)} was deleted earlier in this plan and no longer exists; propose the remaining operations against a refreshed snapshot.`);
  const sourceItemId = operation.sourceItemId;
  if (typeof sourceItemId === "string" && removed.items.has(sourceItemId)) return invalid("TARGET_NOT_FOUND", `The footage source item ${JSON.stringify(sourceItemId)} was deleted earlier in this plan and no longer exists.`);
  return removedFolderReferenceError(operation, removed);
}

function removedFolderReferenceError(operation: JsonObject, removed: RemovalState): Refusal | undefined {
  for (const key of FOLDER_REFERENCE_FIELDS) {
    const value = operation[key];
    if (typeof value === "string" && removed.items.has(value)) return invalid("TARGET_NOT_FOUND", `The destination folder ${JSON.stringify(value)} was deleted earlier in this plan and no longer exists.`);
  }
  return undefined;
}

function removedMaskReferenceError(operation: JsonObject, target: JsonObject, removed: RemovalState): Refusal | undefined {
  const maskId = operation.maskId, layerId = target.layerId, compositionId = target.compositionId;
  if (typeof maskId !== "string" || typeof layerId !== "string" || typeof compositionId !== "string") return undefined;
  return removed.masks.has(maskRemovalKey(compositionId, layerId, maskId)) ? invalid("TARGET_NOT_FOUND", `Mask ${JSON.stringify(maskId)} on layer ${JSON.stringify(layerId)} was removed earlier in this plan; After Effects renumbers the remaining masks, so this operation cannot address what it names.`) : undefined;
}

function shiftedMaskOrdinalError(operation: JsonObject, target: JsonObject, removed: RemovalState, index: number): Refusal | undefined {
  const addressedOrdinal = maskOrdinal(operation.maskId), layerId = target.layerId, compositionId = target.compositionId;
  if (addressedOrdinal === undefined || typeof layerId !== "string" || typeof compositionId !== "string") return undefined;
  const shifting = removed.maskOrdinals.find((removal) => removal.compositionId === compositionId && removal.layerId === layerId && removal.ordinal <= addressedOrdinal);
  if (!shifting) return undefined;
  return invalid("MASK_ORDINAL_SHIFTED", `This operation (index ${index}) addresses mask ordinal ${addressedOrdinal} on layer ${JSON.stringify(layerId)}, but the removal at index ${shifting.index} already removed mask ordinal ${shifting.ordinal} on that layer; After Effects renumbers the remaining masks, so this address now names a different mask and the host would fail mid-apply. Address the mask by the ordinal it holds after the removal, or move the removals to the end of the plan.`);
}

function removedMarkerError(operation: JsonObject, target: JsonObject, removed: RemovalState): Refusal | undefined {
  const time = operation.time, layerId = target.layerId ?? "", compositionId = target.compositionId;
  if (typeof layerId !== "string" || typeof compositionId !== "string" || typeof time !== "number" || !MARKER_OPERATIONS.includes(String(operation.type))) return undefined;
  if (!removed.markers.some((marker) => marker.compositionId === compositionId && marker.layerId === layerId && Math.abs(marker.time - time) < MARKER_TIME_TOLERANCE_SECONDS)) return undefined;
  return invalid("TARGET_NOT_FOUND", `A marker at ${String(time)}s on ${layerId === "" ? "the composition" : `layer ${JSON.stringify(layerId)}`} was removed earlier in this plan; update_marker changes a marker in place, and re-adding one at the removed time contradicts that removal.`);
}
