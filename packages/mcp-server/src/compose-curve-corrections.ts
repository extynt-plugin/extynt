// Custom ease curves and keyframe times: the host can shape a curve only between two numeric keys that are apart in time.
// A curve on keys it cannot shape has one safe reading (plain interpolation), so it is dropped and said; two keys at one
// time have no reading, so that is refused here, by name, instead of at the last step in After Effects.
import { ANIMATING_TYPES, recordChange } from "./compose-correction-core.js";
import type { CorrectionStep } from "./compose-correction-core.js";
import { arrayAt, asObject, numberAt, objectAt, stringAt } from "./json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { OperationFields } from "./operation-fields.js";

const SHAPE_VALUED = /ADBE (Mask|Vector) Shape/;

function numericVector(value: JsonValue | undefined): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function propertyLabel(operation: OperationFields): string {
  return stringAt(objectAt(operation, "target"), "propertyPath") ?? stringAt(operation, "role") ?? "this property";
}

function shapeValued(operation: OperationFields): boolean {
  return SHAPE_VALUED.test(stringAt(objectAt(operation, "target"), "propertyPath") ?? "");
}

/** Two consecutive keys at one time are refused naming the property and the time. */
export const refuseSameTimeKeyframes: CorrectionStep = (operation, context) => {
  const keyframes = ANIMATING_TYPES.has(context.type) ? arrayAt(operation, "keyframes") : undefined;
  if (!keyframes) return undefined;
  for (let at = 1; at < keyframes.length; at += 1) {
    const time = numberAt(asObject(keyframes[at]), "time");
    if (time !== undefined && time === numberAt(asObject(keyframes[at - 1]), "time")) {
      return { code: "INVALID_ARGUMENT", message: `two keyframes at ${time} s on ${propertyLabel(operation)}; give each a distinct time.` };
    }
  }
  return undefined;
};

function withoutUnshapableCurve(keyframe: JsonValue, following: JsonValue | undefined): JsonObject | undefined {
  const row = asObject(keyframe), next = asObject(following);
  if (!row || row.curve === undefined || !next) return undefined;
  if (numericVector(row.value) && numericVector(next.value)) return undefined;
  if (objectAt(row, "value")?.vertices !== undefined) return undefined;
  return Object.fromEntries(Object.entries(row).filter(([name]) => name !== "curve"));
}

/** A curve on a segment whose keys are not numeric vectors (text, booleans, objects) is dropped; shape paths keep theirs. */
export const dropCurveOnNonNumericKeys: CorrectionStep = (operation, context) => {
  const keyframes = ANIMATING_TYPES.has(context.type) ? arrayAt(operation, "keyframes") : undefined;
  if (!keyframes || shapeValued(operation)) return undefined;
  const rewritten = keyframes.map((keyframe, at) => withoutUnshapableCurve(keyframe, keyframes[at + 1]) ?? keyframe);
  const dropped = rewritten.filter((keyframe, at) => keyframe !== keyframes[at]).length;
  if (!dropped) return undefined;
  recordChange(context, { field: "keyframes[].curve", from: `${dropped} curve${dropped === 1 ? "" : "s"}`, to: "(removed)", why: `custom curve dropped: ${propertyLabel(operation)} keyframes are not numeric` });
  operation.keyframes = rewritten;
  return undefined;
};
