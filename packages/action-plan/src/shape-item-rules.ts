// add_shape_item and update_shape_item: a shape layer target, a group and item id, and a payload of values or keyframes that
// all fit the typed settings of the chosen shape item.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { SHAPE_ITEMS, type ShapeItemKind } from "./extended.js";
import { isJsonObject } from "./json-shape.js";
import { layerTarget, observedLayer, type OperationContext } from "./layer-targets.js";
import { earlierWith, keyframeChecks, sameLayer, writesNothing, type SpecWrites } from "./operation-checks.js";
import type { V2TargetReference } from "./plan-types.js";
import { resolveJsonSpecWrites, writtenKeyframeCount } from "./spec-writes.js";
import { invalid, isNewPlaceholderId, isOptionalBoundedName, isRefusal, objectAt, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type ShapeItemKindRules = {
  readonly fields: readonly string[];
  readonly idError: (context: OperationContext, target: V2TargetReference) => Refusal | undefined;
  readonly payloadError: (resolved: SpecWrites) => Refusal | undefined;
};

const GROUP_ID_PATTERN = /^shape:[1-9][0-9]{0,2}$/;
const ITEM_ID_PATTERN = /^item:[1-9][0-9]{0,2}$/;
const MAX_NAME_LENGTH = 256;

function isShapeItemKind(value: JsonValue | undefined): value is ShapeItemKind { return typeof value === "string" && Object.hasOwn(SHAPE_ITEMS, value); }

function shapeItemLayerError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const layer = observedLayer(context.snapshot, target);
  return layer && layer.type !== "shape" ? invalid("INVALID_TARGET", "Shape items apply only to shape layers.") : undefined;
}

function shapeGroupIdError({ operation, earlier }: OperationContext, target: V2TargetReference): Refusal | undefined {
  const groupId = operation.groupId;
  const isCreatedGroup = typeof groupId === "string" && isNewPlaceholderId(groupId) && earlierWith(earlier, (op) => op.type === "create_shape_group" && op.newGroupId === groupId && sameLayer(op, target));
  if (typeof groupId !== "string" || !(groupId === "root" || GROUP_ID_PATTERN.test(groupId) || isCreatedGroup)) return invalid("TARGET_NOT_FOUND", "groupId must be root, shape:<n>, or a create_shape_group placeholder created earlier on this layer.");
  return undefined;
}

function addShapeItemIdError({ operation, earlier }: OperationContext): Refusal | undefined {
  const newItemId = operation.newItemId;
  if (typeof newItemId !== "string" || !isNewPlaceholderId(newItemId) || earlierWith(earlier, (op) => op.type === "add_shape_item" && op.newItemId === newItemId)) return invalid("INVALID_OPERATION", "add_shape_item requires a unique __new__: newItemId.");
  return isOptionalBoundedName(operation.name, MAX_NAME_LENGTH) ? undefined : invalid("INVALID_VALUE", "Shape item name must be 1-256 characters.");
}

function updateShapeItemIdError({ operation, earlier }: OperationContext, target: V2TargetReference): Refusal | undefined {
  const itemId = operation.itemId;
  if (typeof itemId === "string" && ITEM_ID_PATTERN.test(itemId)) return undefined;
  const isAddedHere = (op: JsonObject): boolean => op.type === "add_shape_item" && op.newItemId === itemId && op.item === operation.item && op.groupId === operation.groupId && sameLayer(op, target);
  if (typeof itemId === "string" && isNewPlaceholderId(itemId) && earlierWith(earlier, isAddedHere)) return undefined;
  return invalid("TARGET_NOT_FOUND", "itemId must be item:<n> (the nth item of that kind in the group) or a newItemId of the same kind added earlier in this group.");
}

function shapeItemPayload(context: OperationContext, item: ShapeItemKind, kind: ShapeItemKindRules): SpecWrites | Refusal {
  const { operation } = context;
  if (operation.values !== undefined && !isJsonObject(operation.values)) return invalid("INVALID_VALUE", "values must be an object.");
  const frames = keyframeChecks(context);
  if (frames) return frames;
  const resolved = resolveJsonSpecWrites(SHAPE_ITEMS[item].settings, objectAt(operation, "values"), objectAt(operation, "keyframes"), item);
  if (typeof resolved === "string") return invalid("INVALID_VALUE", resolved);
  return kind.payloadError(resolved) ?? resolved;
}

const ADD_KIND: ShapeItemKindRules = {
  fields: ["type", "target", "groupId", "item", "newItemId", "name", "values", "keyframes", "keyframeMode"],
  idError: addShapeItemIdError,
  payloadError: () => undefined,
};

const UPDATE_KIND: ShapeItemKindRules = {
  fields: ["type", "target", "groupId", "item", "itemId", "values", "keyframes", "keyframeMode"],
  idError: updateShapeItemIdError,
  payloadError: (resolved) => writesNothing(resolved) ? invalid("INVALID_OPERATION", "update_shape_item requires values or keyframes.") : undefined,
};

function validateShapeItem(context: OperationContext, kind: ShapeItemKindRules): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, kind.fields);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  const layerError = shapeItemLayerError(context, target);
  if (layerError) return layerError;
  const item = operation.item;
  if (!isShapeItemKind(item)) return invalid("INVALID_VALUE", `item must be one of ${Object.keys(SHAPE_ITEMS).join(", ")}.`);
  const failure = shapeGroupIdError(context, target) ?? kind.idError(context, target);
  if (failure) return failure;
  const payload = shapeItemPayload(context, item, kind);
  return isRefusal(payload) ? payload : { ok: true, keyframes: writtenKeyframeCount(payload) };
}

/** Validates add_shape_item. */
export function validateAddShapeItem(context: OperationContext): OperationResult { return validateShapeItem(context, ADD_KIND); }

/** Validates update_shape_item. */
export function validateUpdateShapeItem(context: OperationContext): OperationResult { return validateShapeItem(context, UPDATE_KIND); }
