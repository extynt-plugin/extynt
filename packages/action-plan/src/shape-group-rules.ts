// Shape group operation kinds: creating a group on a shape layer, setting its path, and ensuring its fill and stroke.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isShapePath, validColor, validShapeId } from "./geometry-rules.js";
import { familyLayerTarget, type LayerFamilyTarget } from "./layer-family-target.js";
import type { OperationContext } from "./layer-targets.js";
import { earlierWith, sameLayer } from "./operation-checks.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isBoundedName, isFiniteInRange, isPlaceholderField, isPositiveFiniteUpTo, isRefusal, type OperationResult, type Refusal } from "./validation-primitives.js";

const SHAPE_TARGET: LayerFamilyTarget = { bare: true, stale: "Shape operations require an exact layer target without property paths.", missing: "Shape layer must exist or be created earlier in this plan." };

function hasEarlierShapeGroup(earlier: readonly JsonValue[], target: V2TargetReference, groupId: string): boolean {
  return earlierWith(earlier, (operation) => operation.type === "create_shape_group" && operation.newGroupId === groupId && sameLayer(operation, target));
}

/** create_shape_group: an exact layer, a unique `__new__:` group placeholder and a bounded name. */
export function validateCreateShapeGroup(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "newGroupId", "name"], SHAPE_TARGET);
  if (isRefusal(target)) return target;
  const { operation, earlier } = context;
  const newGroupId = operation.newGroupId;
  if (!isPlaceholderField(newGroupId) || hasEarlierShapeGroup(earlier, target, newGroupId) || !isBoundedName(operation.name, 256)) return invalid("INVALID_OPERATION", "create_shape_group requires a unique placeholder and bounded name.");
  return ACCEPTED;
}

function shapeGroupError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const groupId = context.operation.groupId;
  if (validShapeId(groupId) && (!groupId.startsWith("__new__:") || hasEarlierShapeGroup(context.earlier, target, groupId))) return undefined;
  return invalid("TARGET_NOT_FOUND", "Shape group must be \"root\", an explicit ordinal (shape:1), or a create_shape_group placeholder created earlier on this layer.");
}

function shapePaintError(operation: JsonObject): Refusal | undefined {
  if (!validColor(operation.color)) return invalid("INVALID_VALUE", "Shape colors must contain three normalized channels.");
  const opacity = operation.opacity;
  return opacity !== undefined && !isFiniteInRange(opacity, 0, 100) ? invalid("INVALID_VALUE", "Shape opacity must be 0-100.") : undefined;
}

/** set_shape_path: an exact layer, a shape group id that is `root`, an ordinal or created earlier, and a bounded Shape DTO. */
export function validateSetShapePath(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "groupId", "path"], SHAPE_TARGET);
  if (isRefusal(target)) return target;
  const problem = shapeGroupError(context, target);
  if (problem) return problem;
  return isShapePath(context.operation.path) ? ACCEPTED : invalid("INVALID_VALUE", "set_shape_path requires a bounded Shape DTO.");
}

/** ensure_shape_fill: an exact layer, a shape group id that exists or is created earlier, a normalized colour and an optional 0-100 opacity. */
export function validateEnsureShapeFill(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "groupId", "color", "opacity"], SHAPE_TARGET);
  if (isRefusal(target)) return target;
  return shapeGroupError(context, target) ?? shapePaintError(context.operation) ?? ACCEPTED;
}

/** ensure_shape_stroke: ensure_shape_fill's checks plus a stroke width greater than 0 and at most 10000. */
export function validateEnsureShapeStroke(context: OperationContext): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "groupId", "color", "width", "opacity"], SHAPE_TARGET);
  if (isRefusal(target)) return target;
  const problem = shapeGroupError(context, target) ?? shapePaintError(context.operation);
  if (problem) return problem;
  return isPositiveFiniteUpTo(context.operation.width, 10_000) ? ACCEPTED : invalid("INVALID_VALUE", "Shape stroke width must be greater than 0 and at most 10000.");
}
