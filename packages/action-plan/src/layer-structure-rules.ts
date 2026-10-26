// Layer structure operation kinds: duplicating, removing and reordering a layer, and setting its track matte.
import type { JsonObject } from "@extynt/decode";
import { PLACEMENTS, TRACK_MATTE_MODES } from "./canonical-enums.js";
import { familyLayerTarget, type LayerFamilyTarget } from "./layer-family-target.js";
import { hasPlannedLayer, observedLayerExists, type OperationContext } from "./layer-targets.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isOneOf, isOptionalLayerId, isPlaceholderField, isRefusal, type OperationResult, type Refusal } from "./validation-primitives.js";

const STRUCTURE_TARGET: LayerFamilyTarget = { bare: false, stale: "Layer structure operations require an exact target.", missing: "Target layer must exist or be created earlier." };

/** duplicate_layer: an exact layer that exists or is created earlier, and a `__new__:` placeholder for the copy. */
export function validateDuplicateLayer(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "newLayerId"], STRUCTURE_TARGET);
  if (isRefusal(target)) return target;
  return isPlaceholderField(context.operation.newLayerId) ? ACCEPTED : invalid("INVALID_OPERATION", "duplicate_layer requires a new placeholder.");
}

/** remove_layer: an exact layer that exists or is created earlier, and explicit confirmation. */
export function validateRemoveLayer(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "destructive"], STRUCTURE_TARGET);
  if (isRefusal(target)) return target;
  return context.operation.destructive === true ? ACCEPTED : invalid("DESTRUCTIVE_CONFIRMATION_REQUIRED", "remove_layer requires destructive:true.");
}

function needsReference(placement: string): boolean { return placement === "before" || placement === "after"; }

function referencedLayerResult(context: OperationContext, target: V2TargetReference, referenceLayerId: string, notFoundMessage: string): OperationResult {
  const { snapshot, earlier } = context;
  const reference = { ...target, layerId: referenceLayerId };
  const observed = !snapshot || observedLayerExists(snapshot, reference);
  return !referenceLayerId || (!observed && !hasPlannedLayer(earlier, reference)) ? invalid("TARGET_NOT_FOUND", notFoundMessage) : ACCEPTED;
}

/**
 * reorder_layer: an exact layer, a placement, and for before/after a reference layer that is another layer of the same
 * composition in the snapshot or created earlier. The reference id is resolved here like set_layer_parent and set_track_matte
 * resolve theirs, so the host never refuses an already-approved plan.
 */
export function validateReorderLayer(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "placement", "referenceLayerId"], STRUCTURE_TARGET);
  if (isRefusal(target)) return target;
  const placement = context.operation.placement;
  const referenceLayerId = context.operation.referenceLayerId;
  if (!isOneOf(placement, PLACEMENTS) || (needsReference(placement) && typeof referenceLayerId !== "string")) return invalid("INVALID_OPERATION", "reorder_layer requires a bounded placement and reference when needed.");
  if (referenceLayerId === target.layerId) return invalid("INVALID_VALUE", "A layer cannot be reordered relative to itself.");
  if (!needsReference(placement) || typeof referenceLayerId !== "string") return ACCEPTED;
  return referencedLayerResult(context, target, referenceLayerId, "The reference layer must be in the same composition in the snapshot or created earlier in this plan.");
}

function matteFieldsError(operation: JsonObject, target: V2TargetReference): Refusal | undefined {
  const matteLayerId = operation.matteLayerId;
  const showMatteLayer = operation.showMatteLayer;
  if (!isOneOf(operation.mode, TRACK_MATTE_MODES) || !isOptionalLayerId(matteLayerId)) return invalid("INVALID_OPERATION", "set_track_matte requires a typed mode and layer id or null.");
  if (matteLayerId === target.layerId) return invalid("INVALID_VALUE", "A layer cannot be its own track matte.");
  return showMatteLayer !== undefined && typeof showMatteLayer !== "boolean" ? invalid("INVALID_VALUE", "showMatteLayer must be a boolean.") : undefined;
}

/** set_track_matte: an exact layer, a matte mode, and a matte layer (or null) other than itself that exists in the snapshot or is created earlier. */
export function validateSetTrackMatte(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "matteLayerId", "mode", "showMatteLayer"], STRUCTURE_TARGET);
  if (isRefusal(target)) return target;
  const problem = matteFieldsError(context.operation, target);
  if (problem) return problem;
  const matteLayerId = context.operation.matteLayerId;
  if (typeof matteLayerId !== "string" || !context.snapshot) return ACCEPTED;
  return referencedLayerResult(context, target, matteLayerId, "The matte layer must be in the same composition in the snapshot or created earlier in this plan.");
}
