// The expression and keyframe-animation rules for a layer-grounded operation: set_expression, animate_control and animate_property.
import type { JsonValue } from "@extynt/decode";
import { EFFECT_PARADE_PREFIX } from "./effect-paths.js";
import { expressionLoopTypeError, isAnimationPayload, keyframeControlValueError, keyframeSequenceError, keyframeShapeError, withinDuration } from "./keyframe-rules.js";
import { hasPlannedEffect, hasPlannedTextDocument, type GroundedContext } from "./layer-targets.js";
import { MAX_EXPRESSION_LENGTH, TEXT_DOCUMENT_PATH } from "./plan-constants.js";
import type { V2TargetReference } from "./plan-types.js";
import { existingKeyConflict, isHostResolvablePath, isMaterialisedPropertyPath, nativeRoleForPath, observedNotAnimatable, pathLeafHint, propertyMatchesTarget } from "./property-rules.js";
import { ACCEPTED, countKeyframes, invalid, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type Field = JsonValue | undefined;
type AnimationRules = { readonly kind: string; readonly effectControl: boolean; readonly targetMessage: string; readonly targetNotFoundMessage: string; readonly notAnimatableMessage: string };

const ANIMATE_CONTROL_RULES: AnimationRules = { kind: "animate_control", effectControl: true, targetMessage: "animate_control requires exact effectPath and propertyPath targets.", targetNotFoundMessage: "The exact effect control path is not present in the current snapshot or an earlier ensure_effect operation.", notAnimatableMessage: "After Effects reports this control cannot be keyframed; set it with a static value instead." };
const ANIMATE_PROPERTY_RULES: AnimationRules = { kind: "animate_property", effectControl: false, targetMessage: "animate_property requires one exact propertyPath and no effectPath.", targetNotFoundMessage: "The exact property path is not present in the current snapshot, the native transform role table, or a property an earlier operation in this plan materialises.", notAnimatableMessage: "After Effects reports this property cannot be keyframed; set it with a static value instead." };

function boundedExpression(context: GroundedContext): string | undefined {
  const { operation, bounds } = context;
  const source = operation.source;
  const withinLimit = typeof source === "string" && source.length <= (bounds.maxExpressionLength ?? MAX_EXPRESSION_LENGTH);
  return withinLimit && typeof operation.enabled === "boolean" ? source : undefined;
}

function effectExpressionError(context: GroundedContext, propertyPath: string, effectPath: string): Refusal | undefined {
  const { target, snapshot, earlier } = context;
  if (!propertyPath.startsWith(`${effectPath}/`)) return invalid("INVALID_TARGET", `set_expression on an effect control requires target.propertyPath to be "<effectPath>/<control matchName>"; got ${JSON.stringify(propertyPath)} under ${JSON.stringify(effectPath)}.`);
  const effectSegment = effectPath.slice(EFFECT_PARADE_PREFIX.length);
  if (!effectSegment || effectSegment.includes("/")) return invalid("INVALID_TARGET", `set_expression requires the effect path spelled the way ae_inspect_layer shows it: "ADBE Effect Parade/<matchName with "/", "#" and "%" percent-escaped>"; got ${JSON.stringify(effectPath)}.`);
  const grounded = !snapshot || propertyMatchesTarget(snapshot, target, true) || hasPlannedEffect(earlier, target) || isHostResolvablePath(snapshot, target, propertyPath);
  return grounded ? undefined : invalid("TARGET_NOT_FOUND", `The expression property ${JSON.stringify(propertyPath)} is not a control of ${JSON.stringify(effectPath)} in the current snapshot and no earlier ensure_effect in this plan materialises that effect; add the effect in this plan or set the expression against a refreshed snapshot.`);
}

function propertyExpressionError(context: GroundedContext, propertyPath: string): Refusal | undefined {
  const { target, snapshot, earlier } = context;
  if (!snapshot) return undefined;
  const textDocument = propertyPath === TEXT_DOCUMENT_PATH && hasPlannedTextDocument(earlier, target);
  const grounded = propertyMatchesTarget(snapshot, target, false) || isMaterialisedPropertyPath(earlier, snapshot, target, propertyPath) || textDocument || isHostResolvablePath(snapshot, target, propertyPath);
  return grounded ? undefined : invalid("TARGET_NOT_FOUND", `The expression property ${JSON.stringify(propertyPath)} is not present in the current snapshot and no earlier operation in this plan materialises it; create or animate that exact property in this plan (native transform roles, earlier text animator properties, and the Source Text of a text layer an earlier create_layer makes), or set the expression against a refreshed snapshot.`);
}

/** set_expression: a bounded source and enabled flag on one exact property. An effect control is grounded the way set_effect_control grounds one, with the effect path spelled as the property tree spells it (a "/" in a matchName appears as %2F, and this operation carries no effectMatchName to escape with); any other property must be in the snapshot or materialised by an earlier operation of the plan. */
export function validateSetExpression(context: GroundedContext): OperationResult {
  const { operation, target } = context;
  const refused = rejectUnknown(operation, ["type", "target", "source", "enabled"]);
  if (refused) return refused;
  const source = boundedExpression(context);
  const propertyPath = target.propertyPath;
  if (!propertyPath || source === undefined) return invalid("INVALID_OPERATION", "set_expression requires a bounded source, enabled flag, and exact property path.");
  const loopType = expressionLoopTypeError(source);
  if (loopType) return loopType;
  const grounding = target.effectPath === undefined ? propertyExpressionError(context, propertyPath) : effectExpressionError(context, propertyPath, target.effectPath);
  return grounding ?? ACCEPTED;
}

function isAnimationTarget(target: V2TargetReference, rules: AnimationRules): boolean {
  if (!target.propertyPath) return false;
  return rules.effectControl ? !!target.effectPath : target.effectPath === undefined;
}

function animationTargetPresent(context: GroundedContext, rules: AnimationRules): boolean {
  const { target, snapshot, earlier } = context;
  if (!snapshot) return false;
  if (rules.effectControl) return propertyMatchesTarget(snapshot, target, true) || hasPlannedEffect(earlier, target) || isHostResolvablePath(snapshot, target, target.propertyPath);
  return propertyMatchesTarget(snapshot, target, false) || isMaterialisedPropertyPath(earlier, snapshot, target, target.propertyPath) || isHostResolvablePath(snapshot, target, target.propertyPath);
}

function animationIntroError(context: GroundedContext, rules: AnimationRules): Refusal | undefined {
  const { operation, target, snapshot, bounds } = context;
  if (operation.expression !== undefined) return invalid("EXPRESSIONS_UNSUPPORTED", "Expressions are not supported by the blur-motion executor.");
  if (!withinDuration(operation.keyframes, bounds)) return invalid("BOUNDS_EXCEEDED", "Animation time exceeds the plan duration bound.");
  if (!isAnimationTarget(target, rules)) return invalid("INVALID_TARGET", rules.targetMessage);
  if (snapshot && !animationTargetPresent(context, rules)) return invalid("TARGET_NOT_FOUND", `${rules.targetNotFoundMessage}${pathLeafHint(snapshot, target)}`);
  if (observedNotAnimatable(snapshot, target)) return invalid("PROPERTY_NOT_ANIMATABLE", rules.notAnimatableMessage);
  return undefined;
}

function animationShapeError(context: GroundedContext, rules: AnimationRules, role: Field): Refusal | undefined {
  const { operation, target } = context;
  const keyframes = operation.keyframes;
  const shapeRole = rules.effectControl ? undefined : nativeRoleForPath(target.propertyPath) ?? (typeof role === "string" ? role : undefined);
  const shape = keyframeShapeError(keyframes, shapeRole, target.propertyPath);
  if (shape) return invalid("INVALID_VALUE", `${rules.kind} ${shape}`);
  const values = rules.effectControl ? keyframeControlValueError(keyframes) : undefined;
  return values ? invalid("INVALID_VALUE", `${rules.kind} ${values}`) : undefined;
}

function validateAnimationPayload(context: GroundedContext, rules: AnimationRules, role: Field): OperationResult {
  const { operation, target, snapshot, earlier } = context;
  const refusal = animationIntroError(context, rules) ?? animationShapeError(context, rules, role) ?? existingKeyConflict(snapshot, target, operation.keyframeMode, earlier);
  return refusal ?? { ok: true, keyframes: countKeyframes(operation.keyframes) };
}

/** animate_control: keyframes for one effect control, held to the same value contract set_effect_control enforces so no object, null or string keyframe is written verbatim into the property. */
export function validateAnimateControl(context: GroundedContext): OperationResult {
  const { operation, bounds } = context;
  const refused = rejectUnknown(operation, ["type", "target", "role", "effectMatchName", "keyframes", "keyframeMode", "expression"]);
  if (refused) return refused;
  const sequence = keyframeSequenceError(operation);
  if (sequence) return sequence;
  const role = operation.role;
  if (typeof role !== "string" || !role || typeof operation.effectMatchName !== "string" || !isAnimationPayload(operation, bounds)) return invalid("INVALID_OPERATION", "animate_control requires a role, effect identity, and keyframes.");
  return validateAnimationPayload(context, ANIMATE_CONTROL_RULES, undefined);
}

/** animate_property: keyframes for one exact property path, with the role optional because the path decides a native transform's value shape. */
export function validateAnimateProperty(context: GroundedContext): OperationResult {
  const { operation, bounds } = context;
  const refused = rejectUnknown(operation, ["type", "target", "role", "keyframes", "keyframeMode", "expression"]);
  if (refused) return refused;
  const sequence = keyframeSequenceError(operation);
  if (sequence) return sequence;
  const role = operation.role;
  if ((role !== undefined && (typeof role !== "string" || !role)) || !isAnimationPayload(operation, bounds)) return invalid("INVALID_OPERATION", "animate_property requires keyframes.");
  return validateAnimationPayload(context, ANIMATE_PROPERTY_RULES, role);
}
