// The decoder for one keyframe of an animation payload: its time, finite value, interpolation, ease, curve and tangents; its types are what the decoder produces.
import { array, boolean, jsonValue, number, optional, refine, string, strictObject, union, type Infer } from "@extynt/decode";
import { cubicBezierCurve } from "./bezier-curve.js";
import { CURVE_PRESETS } from "./plan-constants.js";

const TANGENT_BOUND = 1e7;

function isCurvePreset(name: string): name is string {
  return Object.hasOwn(CURVE_PRESETS, name);
}

/** A curve between keyframes: a known preset name or explicit control points. */
export const keyframeCurve = union(refine(string(), isCurvePreset, "a known curve preset"), cubicBezierCurve);
const keyframeEase = strictObject({ speed: number({ min: -TANGENT_BOUND, max: TANGENT_BOUND }), influence: number({ min: 0.1, max: 100 }) });
const easeSide = union(array(keyframeEase, { minLength: 1, maxLength: 3 }), keyframeEase);
const tangent = array(number({ min: -TANGENT_BOUND, max: TANGENT_BOUND }), { minLength: 2, maxLength: 3 });

/** One keyframe exactly as the plan rules accept it: a non-negative finite time, a finite JSON value and well-formed optional motion fields; no other field. */
export const keyframeSpec = strictObject({
  time: number({ min: 0 }),
  value: jsonValue,
  interpolation: optional(strictObject({ inType: optional(string()), outType: optional(string()) })),
  ease: optional(strictObject({ in: optional(easeSide), out: optional(easeSide) })),
  curve: optional(keyframeCurve),
  spatial: optional(strictObject({ inTangent: optional(tangent), outTangent: optional(tangent), continuous: optional(boolean()), autoBezier: optional(boolean()) })),
  temporal: optional(strictObject({ continuous: optional(boolean()), autoBezier: optional(boolean()) })),
  roving: optional(boolean()),
});

export type KeyframeEaseSpec = Infer<typeof keyframeEase>;
export type KeyframeSpec = Infer<typeof keyframeSpec>;
