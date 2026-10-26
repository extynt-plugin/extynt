// add_text_animator and update_text_animator: a text layer target, an animator id, an optional selector and a payload of
// animator properties or keyframes that all fit the typed animator tables.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { TEXT_ANIMATOR_PROPERTIES, TEXT_SELECTORS, type TextSelectorType } from "./extended.js";
import { isJsonObject } from "./json-shape.js";
import { layerTarget, observedLayer, type OperationContext } from "./layer-targets.js";
import { declaresAnimatorProperty, earlierWith, keyframeChecks, sameLayer, writesNothing, type SpecWrites } from "./operation-checks.js";
import { MAX_EXPRESSION_LENGTH } from "./plan-constants.js";
import type { V2TargetReference } from "./plan-types.js";
import { resolveJsonSpecWrites, textAnimatorSpecs, writtenKeyframeCount } from "./spec-writes.js";
import { invalid, isNewPlaceholderId, isOptionalBoundedName, isRefusal, objectAt, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type AnimatorKind = {
  readonly fields: readonly string[];
  readonly idError: (context: OperationContext, target: V2TargetReference) => Refusal | undefined;
  readonly payloadError: (resolved: SpecWrites, operation: JsonObject) => Refusal | undefined;
};

const UPDATE_ID_PATTERN = /^animator:[1-9][0-9]{0,2}$/;
const MAX_NAME_LENGTH = 256;

function isTextSelectorType(value: JsonValue | undefined): value is TextSelectorType { return typeof value === "string" && Object.hasOwn(TEXT_SELECTORS, value); }
function notTextLayer(): Refusal { return invalid("INVALID_TARGET", "Text animators apply only to text layers."); }

function textAnimatorLayerError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const layer = observedLayer(context.snapshot, target);
  if (layer && layer.type !== "text") return notTextLayer();
  return earlierWith(context.earlier, (op) => op.type === "create_layer" && sameLayer(op, target) && op.layerType !== "text") ? notTextLayer() : undefined;
}

function addAnimatorIdError({ operation, earlier }: OperationContext): Refusal | undefined {
  const newAnimatorId = operation.newAnimatorId;
  if (typeof newAnimatorId !== "string" || !isNewPlaceholderId(newAnimatorId) || earlierWith(earlier, (op) => op.type === "add_text_animator" && op.newAnimatorId === newAnimatorId)) return invalid("INVALID_OPERATION", "add_text_animator requires a unique __new__: newAnimatorId.");
  return isOptionalBoundedName(operation.name, MAX_NAME_LENGTH) ? undefined : invalid("INVALID_VALUE", "Animator name must be 1-256 characters.");
}

function updateAnimatorIdError({ operation, earlier }: OperationContext, target: V2TargetReference): Refusal | undefined {
  const animatorId = operation.animatorId;
  if (typeof animatorId === "string" && UPDATE_ID_PATTERN.test(animatorId)) return undefined;
  if (typeof animatorId === "string" && isNewPlaceholderId(animatorId) && earlierWith(earlier, (op) => op.type === "add_text_animator" && op.newAnimatorId === animatorId && sameLayer(op, target))) return undefined;
  return invalid("TARGET_NOT_FOUND", "animatorId must be animator:<n> (1-based, from ae_inspect_layer) or a newAnimatorId added earlier on this layer.");
}

function selectorAmountExpressionError(selector: JsonObject, context: OperationContext): Refusal | undefined {
  const amountExpression = selector.amountExpression;
  if (amountExpression === undefined) return undefined;
  const expressionLimit = context.bounds.maxExpressionLength ?? MAX_EXPRESSION_LENGTH;
  if (selector.type === "expression" && typeof amountExpression === "string" && amountExpression.length <= expressionLimit) return undefined;
  return invalid("INVALID_VALUE", `amountExpression applies only to an expression selector and must be at most ${expressionLimit} characters.`);
}

function selectorFieldsError(selector: JsonObject, context: OperationContext): Refusal | undefined {
  const unknownSelector = rejectUnknown(selector, ["type", "settings", "amountExpression"]);
  if (unknownSelector) return unknownSelector;
  if (selector.type !== undefined && !Object.hasOwn(TEXT_SELECTORS, String(selector.type))) return invalid("INVALID_VALUE", `selector.type must be one of ${Object.keys(TEXT_SELECTORS).join(", ")}.`);
  const amountError = selectorAmountExpressionError(selector, context);
  if (amountError) return amountError;
  return selector.settings !== undefined && !isJsonObject(selector.settings) ? invalid("INVALID_VALUE", "selector.settings must be an object.") : undefined;
}

function animatorPropertiesError(operation: JsonObject): Refusal | undefined {
  return operation.properties !== undefined && !isJsonObject(operation.properties) ? invalid("INVALID_VALUE", "properties must be an object of animator property values.") : undefined;
}

function selectorShapeError(context: OperationContext): Refusal | undefined {
  const selector = context.operation.selector;
  if (selector === undefined) return animatorPropertiesError(context.operation);
  if (!isJsonObject(selector)) return invalid("INVALID_VALUE", "selector must be an object.");
  return selectorFieldsError(selector, context) ?? animatorPropertiesError(context.operation);
}

function resolvedTextAnimatorWrites(operation: JsonObject): SpecWrites | string {
  const selector = objectAt(operation, "selector");
  const selectorType = selector?.type;
  const settings = Object.entries(objectAt(selector, "settings") ?? {}).map(([key, value]): [string, JsonValue] => [`selector.${key}`, value]);
  const values: JsonObject = { ...objectAt(operation, "properties"), ...Object.fromEntries(settings) };
  return resolveJsonSpecWrites(textAnimatorSpecs(isTextSelectorType(selectorType) ? selectorType : "range"), values, objectAt(operation, "keyframes"), "text animator");
}

function textAnimatorPayload(context: OperationContext, kind: AnimatorKind): SpecWrites | Refusal {
  const frames = keyframeChecks(context);
  if (frames) return frames;
  const resolved = resolvedTextAnimatorWrites(context.operation);
  if (typeof resolved === "string") return invalid("INVALID_VALUE", resolved);
  return kind.payloadError(resolved, context.operation) ?? resolved;
}

const ADD_KIND: AnimatorKind = {
  fields: ["type", "target", "newAnimatorId", "name", "properties", "selector", "keyframes", "keyframeMode"],
  idError: addAnimatorIdError,
  payloadError: (resolved) => declaresAnimatorProperty(resolved) ? undefined : invalid("INVALID_OPERATION", `add_text_animator needs at least one animator property in properties or keyframes (${Object.keys(TEXT_ANIMATOR_PROPERTIES).join(", ")}).`),
};

const UPDATE_KIND: AnimatorKind = {
  fields: ["type", "target", "animatorId", "properties", "selector", "keyframes", "keyframeMode"],
  idError: updateAnimatorIdError,
  payloadError: (resolved, operation) => writesNothing(resolved) && objectAt(objectAt(operation, "selector"), "amountExpression") === undefined ? invalid("INVALID_OPERATION", "update_text_animator requires properties, selector settings, or keyframes.") : undefined,
};

function validateTextAnimator(context: OperationContext, kind: AnimatorKind): OperationResult {
  const unknown = rejectUnknown(context.operation, kind.fields);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  const failure = textAnimatorLayerError(context, target) ?? kind.idError(context, target) ?? selectorShapeError(context);
  if (failure) return failure;
  const payload = textAnimatorPayload(context, kind);
  return isRefusal(payload) ? payload : { ok: true, keyframes: writtenKeyframeCount(payload) };
}

/** Validates add_text_animator. */
export function validateAddTextAnimator(context: OperationContext): OperationResult { return validateTextAnimator(context, ADD_KIND); }

/** Validates update_text_animator. */
export function validateUpdateTextAnimator(context: OperationContext): OperationResult { return validateTextAnimator(context, UPDATE_KIND); }
