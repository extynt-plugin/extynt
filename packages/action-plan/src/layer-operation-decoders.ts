// The decoders and types of the core layer operations: creating, duplicating, removing, ordering, naming, parenting, timing and attribute changes.
import { array, boolean, jsonValue, literal, nullable, number, optional, refine, string, strictObject, tuple, union, type Infer } from "@extynt/decode";
import { LAYER_SWITCHES, type LayerSwitchRole } from "./extended.js";
import { TEXT_JUSTIFICATIONS } from "./plan-constants.js";
import { v2CompositionTarget } from "./operation-parts.js";
import { v2Target } from "./plan-decoders.js";

export const CREATABLE_LAYER_TYPES = ["text", "shape", "null", "camera", "light", "adjustment", "solid", "footage"] as const;

function isLayerSwitch(name: string): name is LayerSwitchRole {
  return Object.hasOwn(LAYER_SWITCHES, name);
}

const layerAttributeRole = union(literal("blend-mode", "three-d", "shy", "solo", "enabled", "locked"), refine(string(), isLayerSwitch, "a layer switch name"));

export const createLayerOperation = strictObject({
  type: literal("create_layer"), target: v2Target, layerType: literal(...CREATABLE_LAYER_TYPES), name: string(), text: optional(string()), color: optional(union(tuple(number(), number(), number(), number()), tuple(number(), number(), number()))),
  box: optional(tuple(number(), number())), vertical: optional(boolean()), justification: optional(literal(...TEXT_JUSTIFICATIONS)), size: optional(tuple(number(), number())), sourceItemId: optional(string()),
});
export const duplicateLayerOperation = strictObject({ type: literal("duplicate_layer"), target: v2Target, newLayerId: string() });
export const removeLayerOperation = strictObject({ type: literal("remove_layer"), target: v2Target, destructive: literal(true) });
export const reorderLayerOperation = strictObject({ type: literal("reorder_layer"), target: v2Target, placement: literal("beginning", "end", "before", "after"), referenceLayerId: optional(string()) });
export const setTrackMatteOperation = strictObject({
  type: literal("set_track_matte"), target: v2Target, matteLayerId: nullable(string()), mode: literal("alpha", "alpha-inverted", "luma", "luma-inverted"), showMatteLayer: optional(boolean()),
});
export const setLayerNameOperation = strictObject({ type: literal("set_layer_name"), target: v2Target, name: string() });
export const setLayerParentOperation = strictObject({ type: literal("set_layer_parent"), target: v2Target, parentLayerId: nullable(string()) });
export const setLayerAttributeOperation = strictObject({ type: literal("set_layer_attribute"), target: v2Target, role: layerAttributeRole, value: jsonValue });
export const setLayerTimingOperation = strictObject({
  type: literal("set_layer_timing"), target: v2Target, inPoint: optional(number()), outPoint: optional(number()), startTime: optional(number()), stretch: optional(number()),
});
export const setLoopOperation = strictObject({ type: literal("set_loop"), target: v2Target, mode: literal("cycle", "pingpong", "offset", "continue"), count: optional(number()), direction: optional(literal("out", "in")) });
export const setAudioOperation = strictObject({ type: literal("set_audio"), target: v2Target, enabled: optional(boolean()), levelDb: optional(number()) });
export const setTimeRemapOperation = strictObject({ type: literal("set_time_remap"), target: v2Target, enabled: boolean() });
export const precomposeLayersOperation = strictObject({
  type: literal("precompose_layers"), target: v2CompositionTarget, layerIds: array(string()), name: string(), newCompositionId: string(), newLayerId: string(), moveAllAttributes: optional(boolean()),
});

export type LayerAttributeRole = Infer<typeof layerAttributeRole>;
export type CreatableLayerType = (typeof CREATABLE_LAYER_TYPES)[number];
export type CreateLayerOperation = Infer<typeof createLayerOperation>;
export type DuplicateLayerOperation = Infer<typeof duplicateLayerOperation>;
export type RemoveLayerOperation = Infer<typeof removeLayerOperation>;
export type ReorderLayerOperation = Infer<typeof reorderLayerOperation>;
export type SetTrackMatteOperation = Infer<typeof setTrackMatteOperation>;
export type SetLayerNameOperation = Infer<typeof setLayerNameOperation>;
export type SetLayerParentOperation = Infer<typeof setLayerParentOperation>;
export type SetLayerAttributeOperation = Infer<typeof setLayerAttributeOperation>;
export type SetLayerTimingOperation = Infer<typeof setLayerTimingOperation>;
export type SetLoopOperation = Infer<typeof setLoopOperation>;
export type SetAudioOperation = Infer<typeof setAudioOperation>;
export type SetTimeRemapOperation = Infer<typeof setTimeRemapOperation>;
export type PrecomposeLayersOperation = Infer<typeof precomposeLayersOperation>;
