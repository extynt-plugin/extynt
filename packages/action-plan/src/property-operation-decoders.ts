// The decoders and types of the effect, expression, marker, animation and property operations.
import { array, boolean, jsonValue, literal, number, optional, record, refine, string, strictObject, union, type Infer, type ObjectOf } from "@extynt/decode";
import { keyframeSpec } from "./keyframe-decoder.js";
import { expressionSpec, keyframeModeDecoder, v2CompositionTarget } from "./operation-parts.js";
import { LAYER_STYLES } from "./plan-constants.js";
import { v2Target } from "./plan-decoders.js";

function isLayerStyleName(name: string): name is keyof typeof LAYER_STYLES {
  return Object.hasOwn(LAYER_STYLES, name);
}

const markerTarget = union(v2Target, v2CompositionTarget);
const markerFields = { comment: optional(string()), duration: optional(number()), chapter: optional(string()), url: optional(string()), cuePointName: optional(string()), label: optional(number()) } as const;
const layerStyleValue = union(number(), boolean(), array(number()));

export const ensureEffectOperation = strictObject({
  type: literal("ensure_effect"), target: v2Target, capabilityId: string(), effectMatchName: string(), effectPath: string(), enabled: optional(boolean()),
  initialization: optional(strictObject({ blurriness: number(), dimensions: literal(1, 2, 3), repeatEdgePixels: boolean() })),
});
export const applyPresetOperation = strictObject({ type: literal("apply_preset"), target: v2Target, presetId: optional(string()), presetFile: optional(string()) });
export const ensureLayerStyleOperation = strictObject({
  type: literal("ensure_layer_style"), target: v2Target, style: refine(string(), isLayerStyleName, "a layer style name"), enabled: optional(boolean()), values: optional(record(string(), layerStyleValue)),
});
export const setEffectControlOperation = strictObject({ type: literal("set_effect_control"), target: v2Target, effectMatchName: string(), value: jsonValue });
export const setExpressionOperation = strictObject({ type: literal("set_expression"), target: v2Target, source: string(), enabled: boolean() });
export const addMarkerOperation = strictObject({ type: literal("add_marker"), target: markerTarget, time: number(), ...markerFields });
export const updateMarkerOperation = strictObject({ type: literal("update_marker"), target: markerTarget, time: number(), ...markerFields });
export const removeMarkerOperation = strictObject({ type: literal("remove_marker"), target: markerTarget, time: number(), destructive: literal(true) });
export const animateControlOperation = strictObject({
  type: literal("animate_control"), target: v2Target, role: string(), effectMatchName: string(), keyframes: optional(array(keyframeSpec)), keyframeMode: optional(keyframeModeDecoder), expression: optional(expressionSpec),
});
export const animatePropertyOperation = strictObject({
  type: literal("animate_property"), target: v2Target, role: optional(string()), keyframes: optional(array(keyframeSpec)), keyframeMode: optional(keyframeModeDecoder), expression: optional(expressionSpec),
});
export const setLayerPropertyOperation = strictObject({ type: literal("set_layer_property"), target: v2Target, role: string(), propertyPath: string(), value: jsonValue });
export const addEssentialPropertyOperation = strictObject({ type: literal("add_essential_property"), target: v2Target, name: optional(string()) });

export type LayerStyleName = keyof typeof LAYER_STYLES;
export type MarkerFields = ObjectOf<typeof markerFields>;
export type MarkerTarget = Infer<typeof markerTarget>;
export type EnsureEffectOperation = Infer<typeof ensureEffectOperation>;
export type ApplyPresetOperation = Infer<typeof applyPresetOperation>;
export type EnsureLayerStyleOperation = Infer<typeof ensureLayerStyleOperation>;
export type SetEffectControlOperation = Infer<typeof setEffectControlOperation>;
export type SetExpressionOperation = Infer<typeof setExpressionOperation>;
export type AddMarkerOperation = Infer<typeof addMarkerOperation>;
export type UpdateMarkerOperation = Infer<typeof updateMarkerOperation>;
export type RemoveMarkerOperation = Infer<typeof removeMarkerOperation>;
export type AnimateControlOperation = Infer<typeof animateControlOperation>;
export type AnimatePropertyOperation = Infer<typeof animatePropertyOperation>;
export type SetLayerPropertyOperation = Infer<typeof setLayerPropertyOperation>;
export type AddEssentialPropertyOperation = Infer<typeof addEssentialPropertyOperation>;
