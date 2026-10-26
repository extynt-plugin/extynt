// The keyframe contract: what one keyframe is, what an animation payload is, the sequence rules (bounded count, strictly increasing
// times, curve only on a segment), and the value rules each keyframe meets on the property it writes.
import { isJsonArray } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { unknownExpressionFunctionError } from "./expression-names.js";
import { isShapePath } from "./geometry-rules.js";
import { isJsonObject } from "./json-shape.js";
import { nativeValueError } from "./native-property-rules.js";
import { CURVE_PRESETS, MAX_EXPRESSION_LENGTH, MAX_KEYFRAMES_PER_ANIMATION, TEXT_DOCUMENT_PATH } from "./plan-constants.js";
import type { PlanBounds } from "./plan-types.js";
import { hasOptionalStrings, invalid, isBoundedString, isFiniteInRange, isFiniteJson, isNonNegativeFinite, isOptionalBoolean, isStaticControlValue, rejectUnknown, type Refusal } from "./validation-primitives.js";

const KEYFRAME_FIELDS = ["time", "value", "interpolation", "ease", "curve", "spatial", "temporal", "roving"];
const LOOP_TYPES = ["cycle", "pingpong", "offset", "continue"];
const LOOP_CALL = /\bloop(?:Out|In)(?:Duration)?\s*\(\s*(["'])([^"']*)\1/g;
const TEXT_SELECTOR_PERCENT = /ADBE Text Selector\/ADBE Text Percent (Start|End|Offset)$/;
const SHAPE_VALUED_PATH = /(^|\/)(ADBE Mask Shape|ADBE Vector Shape)$/;
const TANGENT_BOUND = 1e7;
const MAX_SHAPE_KEY_VERTICES = 50_000;
const MAX_SOURCE_TEXT_LENGTH = 4096;

type TimedKeyframe = JsonObject & { readonly time: number };
type ShapeContext = { readonly first: string; readonly role: string | undefined; readonly propertyPath: string | undefined };

/** True when the operation carries keyframes, an expression, or both, each well-formed and within the plan's bounds. */
export function isAnimationPayload(operation: JsonObject, bounds: PlanBounds): boolean {
  const keyframes = operation.keyframes;
  const expression = operation.expression;
  if (keyframes === undefined && expression === undefined) return false;
  if (keyframes !== undefined && !isKeyframeList(keyframes, bounds)) return false;
  return expression === undefined || isExpression(expression, bounds);
}

/** The refusal for a keyframeMode outside reject, merge and replace, more keyframes than one animation may hold, a malformed or unordered keyframe, or a curve on the last keyframe. */
export function keyframeSequenceError(operation: JsonObject): Refusal | undefined {
  const modeError = keyframeModeError(operation.keyframeMode);
  if (modeError) return modeError;
  const keyframes = operation.keyframes;
  if (!isJsonArray(keyframes)) return undefined;
  if (keyframes.length > MAX_KEYFRAMES_PER_ANIMATION) return invalid("BOUNDS_EXCEEDED", `An animation operation may contain at most ${MAX_KEYFRAMES_PER_ANIMATION} keyframes.`);
  for (let index = 0; index < keyframes.length; index += 1) {
    const error = keyframeEntryError(keyframes, index);
    if (error) return error;
  }
  return undefined;
}

/** The refusal for what the expression engine rejects only once it runs, which is mid-apply: a source that does not parse, a function it does not know, or a loopOut/loopIn type it does not know. Refused while it is still a queue fix. */
export function expressionLoopTypeError(source: string): Refusal | undefined {
  const syntax = expressionSyntaxError(source);
  if (syntax) return syntax;
  const unknownFunction = unknownExpressionFunctionError(source);
  if (unknownFunction) return unknownFunction;
  for (const match of source.matchAll(LOOP_CALL)) {
    const loopType = match[2] ?? "";
    if (LOOP_TYPES.includes(loopType)) continue;
    return invalid("EXPRESSION_INVALID", `${match[0]}) names loop type "${loopType.slice(0, 32)}", which After Effects rejects. Use one of: ${LOOP_TYPES.map((type) => `"${type}"`).join(", ")} (ping-pong is spelled "pingpong").`);
  }
  return undefined;
}

/** True when every keyframe is well-formed and no keyframe time passes the plan's duration bound. */
export function withinDuration(value: JsonValue | undefined, bounds: PlanBounds): boolean {
  const max = bounds.maxKeyframeTimeSeconds;
  if (max === undefined || !isJsonArray(value)) return true;
  return value.every((candidate) => isKeyframe(candidate) && candidate.time <= max);
}

/** The message for a keyframe list whose keys do not match the property's value shape: mixed scalar/vector or 2D/3D keys are refused, never coerced. A keyframe is the property's whole value, so a null component has nothing to keep. Mask and shape paths take a Shape per key, and one write carries at most 50,000 path points across all its keys. */
export function keyframeShapeError(keyframes: JsonValue | undefined, role: string | undefined, propertyPath: string | undefined): string | undefined {
  if (!isJsonArray(keyframes) || keyframes.length === 0) return undefined;
  const budget = isShapeValuedPath(propertyPath) ? shapeBudgetError(keyframes) : undefined;
  if (budget) return budget;
  const context: ShapeContext = { first: valueShape(valueOf(keyframes[0])), role, propertyPath };
  for (let index = 0; index < keyframes.length; index += 1) {
    const error = keyframeShapeEntryError(keyframes[index], index, context);
    if (error) return error;
  }
  return undefined;
}

/** The message for an animate_control keyframe whose value is not the one control value set_effect_control takes. */
export function keyframeControlValueError(keyframes: JsonValue | undefined): string | undefined {
  if (!isJsonArray(keyframes)) return undefined;
  for (let index = 0; index < keyframes.length; index += 1) {
    const value = valueOf(keyframes[index]);
    if (!isStaticControlValue(value)) return `keyframe ${index} value ${JSON.stringify(value)} must be a finite number, boolean, or an array of 2-4 finite numbers.`;
  }
  return undefined;
}

function isKeyframeList(value: JsonValue, bounds: PlanBounds): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (bounds.maxKeyframes !== undefined && value.length > bounds.maxKeyframes) return false;
  return value.every(isKeyframe);
}

function isKeyframe(value: JsonValue | undefined): value is TimedKeyframe {
  if (!isJsonObject(value) || rejectUnknown(value, KEYFRAME_FIELDS)) return false;
  if (!isNonNegativeFinite(value.time) || !isFiniteJson(value.value)) return false;
  return hasValidMotionFields(value) && isOptionalBoolean(value.roving);
}

function hasValidMotionFields(keyframe: JsonObject): boolean {
  return isOptionalInterpolation(keyframe.interpolation) && isOptionalEase(keyframe.ease) && isOptionalCurve(keyframe.curve) && isOptionalSpatial(keyframe.spatial) && isOptionalTemporal(keyframe.temporal);
}

function isOptionalInterpolation(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value) || rejectUnknown(value, ["inType", "outType"])) return false;
  return hasOptionalStrings(value, ["inType", "outType"]);
}

function isOptionalEase(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  return isJsonObject(value) && !rejectUnknown(value, ["in", "out"]) && isEaseSide(value.in) && isEaseSide(value.out);
}

function isOptionalCurve(value: JsonValue | undefined): boolean { return value === undefined || isCurve(value); }

function isOptionalSpatial(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value) || rejectUnknown(value, ["inTangent", "outTangent", "continuous", "autoBezier"])) return false;
  return isOptionalTangent(value.inTangent) && isOptionalTangent(value.outTangent) && isOptionalBoolean(value.continuous) && isOptionalBoolean(value.autoBezier);
}

function isOptionalTemporal(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value) || rejectUnknown(value, ["continuous", "autoBezier"])) return false;
  return isOptionalBoolean(value.continuous) && isOptionalBoolean(value.autoBezier);
}

function isEase(value: JsonValue | undefined): boolean {
  return isJsonObject(value) && !rejectUnknown(value, ["speed", "influence"]) && isFiniteInRange(value.speed, -TANGENT_BOUND, TANGENT_BOUND) && isFiniteInRange(value.influence, 0.1, 100);
}

function isEaseSide(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length >= 1 && value.length <= 3 && value.every(isEase);
  return isEase(value);
}

function isCurve(value: JsonValue): boolean {
  if (typeof value === "string") return Object.hasOwn(CURVE_PRESETS, value);
  if (!isJsonObject(value) || rejectUnknown(value, ["x1", "y1", "x2", "y2"])) return false;
  return isFiniteInRange(value.x1, 0, 1) && isFiniteInRange(value.x2, 0, 1) && isFiniteInRange(value.y1, -10, 10) && isFiniteInRange(value.y2, -10, 10);
}

function isOptionalTangent(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  return isJsonArray(value) && value.length >= 2 && value.length <= 3 && value.every((entry) => isFiniteInRange(entry, -TANGENT_BOUND, TANGENT_BOUND));
}

function isExpression(value: JsonValue, bounds: PlanBounds): boolean {
  if (!isJsonObject(value) || rejectUnknown(value, ["source", "enabled"])) return false;
  return isBoundedString(value.source, bounds.maxExpressionLength ?? MAX_EXPRESSION_LENGTH) && typeof value.enabled === "boolean";
}

function keyframeModeError(mode: JsonValue | undefined): Refusal | undefined {
  if (mode === undefined || mode === "reject" || mode === "merge" || mode === "replace") return undefined;
  return invalid("INVALID_VALUE", "keyframeMode must be reject, merge, or replace.");
}

function keyframeEntryError(keyframes: readonly JsonValue[], index: number): Refusal | undefined {
  const keyframe = keyframes[index];
  const presetError = unknownCurvePresetError(keyframe, index);
  if (presetError) return presetError;
  if (!isKeyframe(keyframe)) return invalid("INVALID_VALUE", `Keyframe ${index} has an invalid time, value, ease, curve, spatial, temporal, or roving field.`);
  const previousTime = timeOf(keyframes[index - 1]);
  if (previousTime !== undefined && keyframe.time <= previousTime) return invalid("INVALID_VALUE", "Keyframe times must be strictly increasing within one operation.");
  if (keyframe.curve !== undefined && index === keyframes.length - 1) return invalid("INVALID_VALUE", "A curve shapes the segment to the next keyframe, so the last keyframe cannot carry one.");
  return undefined;
}

function timeOf(keyframe: JsonValue | undefined): number | undefined {
  const time = isJsonObject(keyframe) ? keyframe.time : undefined;
  return typeof time === "number" ? time : undefined;
}

function unknownCurvePresetError(keyframe: JsonValue | undefined, index: number): Refusal | undefined {
  const curve = isJsonObject(keyframe) ? keyframe.curve : undefined;
  if (typeof curve !== "string" || Object.hasOwn(CURVE_PRESETS, curve)) return undefined;
  return invalid("INVALID_VALUE", `Keyframe ${index} uses unknown curve preset "${curve.slice(0, 64)}". Use {x1,y1,x2,y2} or one of: ${Object.keys(CURVE_PRESETS).join(", ")}.`);
}

function expressionSyntaxError(source: string): Refusal | undefined {
  try {
    new Function(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) return undefined;
    return invalid("EXPRESSION_INVALID", `The expression does not parse as JavaScript (${error.message.slice(0, 120)}), so After Effects would disable it mid-apply. Fix the source: for example "if (a) b else c" needs a semicolon before else, and "a ? b : c" is the one-line form.`);
  }
  return undefined;
}

function valueOf(keyframe: JsonValue | undefined): JsonValue | undefined { return isJsonObject(keyframe) ? keyframe.value : undefined; }

function valueShape(value: JsonValue | undefined): string {
  if (typeof value === "number") return "scalar";
  return Array.isArray(value) ? `vector${value.length}` : typeof value;
}

function isShapeValuedPath(propertyPath: string | undefined): boolean { return propertyPath !== undefined && SHAPE_VALUED_PATH.test(propertyPath); }

function shapeBudgetError(keyframes: readonly JsonValue[]): string | undefined {
  const total = keyframes.reduce<number>((sum, keyframe) => sum + vertexCount(valueOf(keyframe)), 0);
  return total > MAX_SHAPE_KEY_VERTICES ? `path keyframes carry ${total} vertices in total; at most ${MAX_SHAPE_KEY_VERTICES} per operation, so split a long roto into several operations with keyframeMode merge.` : undefined;
}

function vertexCount(value: JsonValue | undefined): number {
  const vertices = isJsonObject(value) ? value.vertices : undefined;
  return Array.isArray(vertices) ? vertices.length : 0;
}

function keyframeShapeEntryError(keyframe: JsonValue | undefined, index: number, context: ShapeContext): string | undefined {
  const value = valueOf(keyframe);
  if (valueShape(value) !== context.first) return `keyframe ${index} value ${JSON.stringify(value)} does not match the shape of keyframe 0 (${context.first}).`;
  const sourceText = context.propertyPath === TEXT_DOCUMENT_PATH ? sourceTextKeyError(keyframe, index) : undefined;
  return sourceText ?? keyframeValueError(context, value, index);
}

function sourceTextKeyError(keyframe: JsonValue | undefined, index: number): string | undefined {
  const record = isJsonObject(keyframe) ? keyframe : {};
  const text = record.value;
  if (typeof text !== "string" || text.length > MAX_SOURCE_TEXT_LENGTH) return `keyframe ${index}: a Source Text keyframe value is the text itself, a string of at most ${MAX_SOURCE_TEXT_LENGTH} characters; got ${JSON.stringify(text)?.slice(0, 80)}.`;
  const extras = Object.keys(record).filter((key) => key !== "time" && key !== "value");
  return extras.length ? `keyframe ${index}: Source Text keys carry only time and value (${extras.join(", ")} would be ignored: After Effects always holds a text key).` : undefined;
}

function keyframeValueError(context: ShapeContext, value: JsonValue | undefined, index: number): string | undefined {
  const { role, propertyPath } = context;
  if (isShapeValuedPath(propertyPath)) return shapeKeyError(value, index);
  if (role) {
    const error = nativeValueError(role, value);
    return error ? `keyframe ${index}: ${error}` : undefined;
  }
  if (!propertyPath || !TEXT_SELECTOR_PERCENT.test(propertyPath)) return undefined;
  const min = propertyPath.endsWith("Offset") ? -100 : 0;
  return isFiniteInRange(value, min, 100) ? undefined : `keyframe ${index}: selector percent must be one number from ${min} to 100; got ${JSON.stringify(value)}.`;
}

function shapeKeyError(value: JsonValue | undefined, index: number): string | undefined {
  return isShapePath(value) ? undefined : `keyframe ${index}: a path keyframe value must be {vertices: [[x, y], ...] (1-1000), closed: boolean, inTangents?, outTangents?} with tangents matching vertices in length; got ${JSON.stringify(value)?.slice(0, 120)}.`;
}
