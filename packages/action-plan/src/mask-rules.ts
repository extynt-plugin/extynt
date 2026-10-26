// Mask operation kinds: adding, updating and removing the masks of a layer.
import type { JsonValue } from "@extynt/decode";
import { isMaskValues, validMaskId } from "./geometry-rules.js";
import { familyLayerTarget, type LayerFamilyTarget } from "./layer-family-target.js";
import type { OperationContext } from "./layer-targets.js";
import { earlierWith, sameLayer } from "./operation-checks.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isBoundedName, isPlaceholderField, isRefusal, type OperationResult, type Refusal } from "./validation-primitives.js";

const MASK_TARGET: LayerFamilyTarget = { bare: true, stale: "Mask operations require an exact layer target without property paths.", missing: "Mask layer must exist or be created earlier in this plan." };
const ADD_MASK_MESSAGE = "add_mask requires a unique placeholder, bounded name, and bounded values.";

function hasEarlierMask(earlier: readonly JsonValue[], target: V2TargetReference, maskId: string): boolean {
  return earlierWith(earlier, (operation) => operation.type === "add_mask" && operation.newMaskId === maskId && sameLayer(operation, target));
}

/** add_mask: an exact layer, a unique `__new__:` mask placeholder, a bounded name, and optional bounded mask values. */
export function validateAddMask(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "newMaskId", "name", "values"], MASK_TARGET);
  if (isRefusal(target)) return target;
  const { operation, earlier } = context;
  const newMaskId = operation.newMaskId;
  if (!isPlaceholderField(newMaskId) || hasEarlierMask(earlier, target, newMaskId) || !isBoundedName(operation.name, 256)) return invalid("INVALID_OPERATION", ADD_MASK_MESSAGE);
  const values = operation.values;
  return values !== undefined && !isMaskValues(values, false) ? invalid("INVALID_OPERATION", ADD_MASK_MESSAGE) : ACCEPTED;
}

function maskIdError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const maskId = context.operation.maskId;
  if (validMaskId(maskId) && (!maskId.startsWith("__new__:") || hasEarlierMask(context.earlier, target, maskId))) return undefined;
  return invalid("TARGET_NOT_FOUND", "Mask target must be an explicit ordinal or be added earlier on this layer.");
}

/** update_mask: an exact layer, a mask id that is an ordinal or added earlier on the layer, and one or more bounded mask values. */
export function validateUpdateMask(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "maskId", "values"], MASK_TARGET);
  if (isRefusal(target)) return target;
  const problem = maskIdError(context, target);
  if (problem) return problem;
  return isMaskValues(context.operation.values, true) ? ACCEPTED : invalid("INVALID_VALUE", "update_mask requires one or more bounded mask values.");
}

/** remove_mask: an exact layer, a mask id that is an ordinal or added earlier on the layer, and explicit confirmation. */
export function validateRemoveMask(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "maskId", "destructive"], MASK_TARGET);
  if (isRefusal(target)) return target;
  const problem = maskIdError(context, target);
  if (problem) return problem;
  return context.operation.destructive === true ? ACCEPTED : invalid("DESTRUCTIVE_CONFIRMATION_REQUIRED", "remove_mask requires destructive:true.");
}
