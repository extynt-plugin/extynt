// The decoders and types of the layer edit operations: deriving and retiming layers, camera dolly, source and anchor edits, effect stack edits, keyframe edits and puppet pins.
import { array, boolean, literal, number, optional, string, strictObject, type Infer } from "@extynt/decode";
import { keyframeCurve } from "./keyframe-decoder.js";
import { v2Target } from "./plan-decoders.js";

export const DERIVE_LAYER_KINDS = ["split", "audio-keyframes", "shapes-from-vector", "shapes-from-text", "path-null"] as const;
export const PATH_NULL_POINT_KINDS = ["vertex", "inTangent", "outTangent"] as const;
export const RETIME_MODES = ["reverse", "freeze"] as const;
export const KEYFRAME_EDIT_ACTIONS = ["delete", "move", "scale", "copy"] as const;
export const ANALYSIS_KINDS = ["warp-stabilizer", "camera-tracker-3d"] as const;

const layerEditTarget = strictObject({ compositionId: string(), layerId: string(), snapshotFingerprint: string(), selectionFingerprint: string() });
const propertyTarget = strictObject({ compositionId: string(), layerId: string(), propertyPath: string(), snapshotFingerprint: string(), selectionFingerprint: string() });
const keyframeSource = strictObject({ compositionId: string(), layerId: string(), propertyPath: string() });
const dollyKeyframe = strictObject({ time: number(), distance: number(), curve: optional(keyframeCurve) });
const puppetPinKeyframe = strictObject({ time: number(), x: number(), y: number() });
const puppetPin = strictObject({ x: number(), y: number(), keyframes: optional(array(puppetPinKeyframe)) });

export const deriveLayerOperation = strictObject({
  type: literal("derive_layer"), target: v2Target, kind: literal(...DERIVE_LAYER_KINDS), newLayerId: string(), time: optional(number()), pointIndex: optional(number()),
  pointKind: optional(literal(...PATH_NULL_POINT_KINDS)), name: optional(string()),
});
export const retimeLayerOperation = strictObject({ type: literal("retime_layer"), target: v2Target, mode: literal(...RETIME_MODES), time: optional(number()) });
export const dollyCameraOperation = strictObject({ type: literal("dolly_camera"), target: v2Target, keyframes: array(dollyKeyframe) });
export const replaceLayerSourceOperation = strictObject({ type: literal("replace_layer_source"), target: layerEditTarget, sourceItemId: string() });
export const centerAnchorOperation = strictObject({ type: literal("center_anchor"), target: layerEditTarget, time: optional(number()) });
export const copyEffectsOperation = strictObject({
  type: literal("copy_effects"), target: layerEditTarget, source: strictObject({ compositionId: string(), layerId: string() }), effectPaths: optional(array(string())),
});
export const removeEffectOperation = strictObject({ type: literal("remove_effect"), target: v2Target, destructive: literal(true) });
export const reorderEffectOperation = strictObject({ type: literal("reorder_effect"), target: v2Target, index: number() });
export const editKeyframesOperation = strictObject({
  type: literal("edit_keyframes"), target: propertyTarget, action: optional(literal(...KEYFRAME_EDIT_ACTIONS)), times: optional(array(number())), indices: optional(array(number())), all: optional(boolean()),
  offset: optional(number()), about: optional(number()), factor: optional(number()), source: optional(keyframeSource), timeOffset: optional(number()), keyframeMode: optional(literal("merge", "replace")),
});
export const readKeyframesOperation = strictObject({ type: literal("read_keyframes"), target: propertyTarget, maxKeys: optional(number()) });
export const setPuppetPinsOperation = strictObject({ type: literal("set_puppet_pins"), target: v2Target, pins: array(puppetPin), relative: optional(boolean()) });
export const setTextPathOperation = strictObject({ type: literal("set_text_path"), target: v2Target, maskIndex: optional(number()), firstMargin: optional(number()), lastMargin: optional(number()) });
export const startAnalysisOperation = strictObject({ type: literal("start_analysis"), target: v2Target, kind: literal(...ANALYSIS_KINDS) });
export const resizeSolidOperation = strictObject({
  type: literal("resize_solid"), target: v2Target, width: optional(number()), height: optional(number()), pixelAspect: optional(number()), allUsers: optional(boolean()),
});
export const trackerToNullsOperation = strictObject({ type: literal("tracker_to_nulls"), target: v2Target, trackerName: optional(string()), point: optional(literal("attach-point", "feature-center")) });
export const saveLayerPresetOperation = strictObject({
  type: literal("save_layer_preset"), target: v2Target, effectPaths: optional(array(string())), outputPath: string(), overwrite: optional(boolean()), exportAuthorization: literal("EXPORT_NOW"),
});

export type DeriveLayerKind = (typeof DERIVE_LAYER_KINDS)[number];
export type PathNullPointKind = (typeof PATH_NULL_POINT_KINDS)[number];
export type RetimeMode = (typeof RETIME_MODES)[number];
export type KeyframeEditAction = (typeof KEYFRAME_EDIT_ACTIONS)[number];
export type DollyKeyframe = Infer<typeof dollyKeyframe>;
export type PuppetPin = Infer<typeof puppetPin>;
export type DeriveLayerOperation = Infer<typeof deriveLayerOperation>;
export type RetimeLayerOperation = Infer<typeof retimeLayerOperation>;
export type DollyCameraOperation = Infer<typeof dollyCameraOperation>;
export type ReplaceLayerSourceOperation = Infer<typeof replaceLayerSourceOperation>;
export type CenterAnchorOperation = Infer<typeof centerAnchorOperation>;
export type CopyEffectsOperation = Infer<typeof copyEffectsOperation>;
export type RemoveEffectOperation = Infer<typeof removeEffectOperation>;
export type ReorderEffectOperation = Infer<typeof reorderEffectOperation>;
export type EditKeyframesOperation = Infer<typeof editKeyframesOperation>;
export type ReadKeyframesOperation = Infer<typeof readKeyframesOperation>;
export type SetPuppetPinsOperation = Infer<typeof setPuppetPinsOperation>;
export type SetTextPathOperation = Infer<typeof setTextPathOperation>;
export type StartAnalysisOperation = Infer<typeof startAnalysisOperation>;
export type ResizeSolidOperation = Infer<typeof resizeSolidOperation>;
export type TrackerToNullsOperation = Infer<typeof trackerToNullsOperation>;
export type SaveLayerPresetOperation = Infer<typeof saveLayerPresetOperation>;
