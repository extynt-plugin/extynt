// The model-facing action-plan boundary: parses and validates v0.1/v0.2 plans
// against a snapshot, binds one-time approvals, and derives review warnings.
// It performs no host calls; the host adapter owns command compilation and execution.

export * from "./extended.js";
export { canonicalEnumValue, textEnumMembers, OPERATION_ENUM_FIELDS } from "./canonical-enums.js";
export { effectPathNamesMatchName, EFFECT_PARADE_PREFIX } from "./effect-paths.js";
export * from "./layer-derive-ops.js";
export * from "./camera-dolly.js";
export { DERIVE_LAYER_KINDS, PATH_NULL_POINT_KINDS, RETIME_MODES, type CenterAnchorOperation, type CopyEffectsOperation, type DeriveLayerKind, type DeriveLayerOperation, type DollyCameraOperation, type DollyKeyframe, type EditKeyframesOperation, type PathNullPointKind, type PuppetPin, type ReadKeyframesOperation, type RemoveEffectOperation, type ReorderEffectOperation, type ReplaceLayerSourceOperation, type ResizeSolidOperation, type RetimeLayerOperation, type RetimeMode, type SaveLayerPresetOperation, type SetPuppetPinsOperation, type SetTextPathOperation, type StartAnalysisOperation, type TrackerToNullsOperation } from "./layer-edit-decoders.js";
export { CLEANUP_MODES, MEDIA_ENCODER_MODES, type CleanupMode, type CleanupProjectOperation, type CollectProjectOperation, type ExportFrameOperation, type ExportMogrtOperation, type OpenCompositionOperation, type RenderOutputSettings, type RenderQueueSettings, type SaveProjectOperation, type SetCompositionGuidesOperation, type SetProjectSettingsOperation, type SwitchProjectOperation } from "./project-operation-decoders.js";
export type { AddShapeItemOperation, UpdateShapeItemOperation } from "./shape-operation-decoders.js";
export type { AddEssentialPropertyOperation } from "./property-operation-decoders.js";
export type { AddTextAnimatorOperation, TextSelectorSpec, UpdateTextAnimatorOperation } from "./text-operation-decoders.js";
export type { PrecomposeLayersOperation } from "./layer-operation-decoders.js";
export { actionPlanOperation } from "./operation-decoder.js";
export { actionPlanV2 } from "./plan-decoder.js";
export { OUTPUT_SETTING_SPECS, RENDER_SETTING_SPECS } from "./output-cleanup-ops.js";
export * from "./plan-types.js";
export * from "./plan-approval.js";
export * from "./plan-validation.js";
export * from "./spec-writes.js";
export { acceptedFieldsOfType, acceptedTopLevelFields, flagsField, LAYER_TARGET_KEYS, targetKeyIntroducesProblem } from "./operation-fields.js";
export { NATIVE_PROPERTY_PATHS, nativeRoleForPath } from "./property-rules.js";
export * from "./svg-validation.js";
export { convertSvg, vectorArtworkFallback, type VectorArtworkFallback } from "./svg-convert.js";
export { aeVersionOf, converterTradeOffs, NATIVE_SVG_IMPORTER_MIN_MAJOR, svgImporterRoute, type SvgImporterRoute, type SvgRoutingInput } from "./svg-routing.js";
export type { ConvertedFill, ConvertedLayer, ConvertedShape, ConvertedStroke, SvgConversion, SvgConversionNotes } from "./svg-convert-types.js";
export { ALLOWED_BLEND_MODES, CURVE_PRESETS, FOOTAGE_ALPHA_MODES, FOOTAGE_FIELD_SEPARATIONS, FOOTAGE_PULLDOWN_METHODS, FOOTAGE_PULLDOWN_PHASES, LAYER_STYLES, LAYER_STYLE_GROUP, LAYER_STYLE_MAX_VALUES, MAX_EXPRESSION_LENGTH, MAX_KEYFRAMES_PER_ANIMATION, PRESET_ID_PATTERN, SCENE_EDIT_MODES, TEXT_DOCUMENT_PATH, TEXT_JUSTIFICATIONS, layerStylePath } from "./plan-constants.js";
export type { NativeVectorResolution } from "./property-rules.js";

export * from "./metadata-readset.js";
export { keyframeEditAction } from "./keyframe-edit-ops.js";
