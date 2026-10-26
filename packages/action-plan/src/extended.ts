// The typed settings tables for the native families (text animators, shape items, layer switches) and the list of operation types that are validated outside the core plan rules.
// Each table is the single source for the validator, the host compiler and the registry.

/** How a setting's value is shaped and checked. */
export type SpecKind = "number" | "vec2" | "vec23" | "color" | "menu" | "boolean";
export interface ValueSpec { path: string; kind: SpecKind; min?: number; max?: number }
const n = (path: string, min = -1_000_000, max = 1_000_000): ValueSpec => ({ path, kind: "number", min, max });
const v2 = (path: string, min = -1_000_000, max = 1_000_000): ValueSpec => ({ path, kind: "vec2", min, max });
const v23 = (path: string, min = -1_000_000, max = 1_000_000): ValueSpec => ({ path, kind: "vec23", min, max });
const menu = (path: string, max: number): ValueSpec => ({ path, kind: "menu", min: 1, max });
const color = (path: string): ValueSpec => ({ path, kind: "color" });
const bool = (path: string): ValueSpec => ({ path, kind: "boolean" });

const ANIMATOR_PROPS = "ADBE Text Animator Properties";
/** Every property offered by a text animator's Add > Property menu. */
export const TEXT_ANIMATOR_PROPERTIES = {
  anchorPoint: v23(`${ANIMATOR_PROPS}/ADBE Text Anchor Point 3D`), position: v23(`${ANIMATOR_PROPS}/ADBE Text Position 3D`), scale: v23(`${ANIMATOR_PROPS}/ADBE Text Scale 3D`, -100_000, 100_000),
  skew: n(`${ANIMATOR_PROPS}/ADBE Text Skew`, -85, 85), skewAxis: n(`${ANIMATOR_PROPS}/ADBE Text Skew Axis`), rotation: n(`${ANIMATOR_PROPS}/ADBE Text Rotation`), rotationX: n(`${ANIMATOR_PROPS}/ADBE Text Rotation X`), rotationY: n(`${ANIMATOR_PROPS}/ADBE Text Rotation Y`),
  opacity: n(`${ANIMATOR_PROPS}/ADBE Text Opacity`, 0, 100),
  fillColor: color(`${ANIMATOR_PROPS}/ADBE Text Fill Color`), fillHue: n(`${ANIMATOR_PROPS}/ADBE Text Fill Hue`), fillSaturation: n(`${ANIMATOR_PROPS}/ADBE Text Fill Saturation`, -100, 100), fillBrightness: n(`${ANIMATOR_PROPS}/ADBE Text Fill Brightness`, -100, 100), fillOpacity: n(`${ANIMATOR_PROPS}/ADBE Text Fill Opacity`, 0, 100),
  strokeColor: color(`${ANIMATOR_PROPS}/ADBE Text Stroke Color`), strokeHue: n(`${ANIMATOR_PROPS}/ADBE Text Stroke Hue`), strokeSaturation: n(`${ANIMATOR_PROPS}/ADBE Text Stroke Saturation`, -100, 100), strokeBrightness: n(`${ANIMATOR_PROPS}/ADBE Text Stroke Brightness`, -100, 100), strokeOpacity: n(`${ANIMATOR_PROPS}/ADBE Text Stroke Opacity`, 0, 100), strokeWidth: n(`${ANIMATOR_PROPS}/ADBE Text Stroke Width`, 0, 10_000),
  lineAnchor: n(`${ANIMATOR_PROPS}/ADBE Text Line Anchor`, 0, 100), lineSpacing: v2(`${ANIMATOR_PROPS}/ADBE Text Line Spacing`), trackingType: menu(`${ANIMATOR_PROPS}/ADBE Text Track Type`, 3), trackingAmount: n(`${ANIMATOR_PROPS}/ADBE Text Tracking Amount`),
  characterAlignment: menu(`${ANIMATOR_PROPS}/ADBE Text Character Change Type`, 4), characterRange: menu(`${ANIMATOR_PROPS}/ADBE Text Character Range`, 2), characterValue: n(`${ANIMATOR_PROPS}/ADBE Text Character Replace`, 0, 65_535), characterOffset: n(`${ANIMATOR_PROPS}/ADBE Text Character Offset`, -65_535, 65_535),
  blur: v2(`${ANIMATOR_PROPS}/ADBE Text Blur`, 0, 10_000),
} as const satisfies Record<string, ValueSpec>;
export type TextAnimatorPropertyKey = keyof typeof TEXT_ANIMATOR_PROPERTIES;

const RANGE_ADVANCED = "ADBE Text Range Advanced";
export const TEXT_SELECTORS = {
  range: { matchName: "ADBE Text Selector", settings: {
    start: n("ADBE Text Percent Start", 0, 100), end: n("ADBE Text Percent End", 0, 100), offset: n("ADBE Text Percent Offset", -100, 100),
    indexStart: n("ADBE Text Index Start", 0, 100_000), indexEnd: n("ADBE Text Index End", 0, 100_000), indexOffset: n("ADBE Text Index Offset", -100_000, 100_000),
    units: menu(`${RANGE_ADVANCED}/ADBE Text Range Units`, 2), basedOn: menu(`${RANGE_ADVANCED}/ADBE Text Range Type2`, 4), mode: menu(`${RANGE_ADVANCED}/ADBE Text Selector Mode`, 6), amount: n(`${RANGE_ADVANCED}/ADBE Text Selector Max Amount`, -100, 100),
    shape: menu(`${RANGE_ADVANCED}/ADBE Text Range Shape`, 6), smoothness: n(`${RANGE_ADVANCED}/ADBE Text Selector Smoothness`, 0, 100), easeHigh: n(`${RANGE_ADVANCED}/ADBE Text Levels Max Ease`, -100, 100), easeLow: n(`${RANGE_ADVANCED}/ADBE Text Levels Min Ease`, -100, 100),
    randomize: bool(`${RANGE_ADVANCED}/ADBE Text Randomize Order`), randomSeed: n(`${RANGE_ADVANCED}/ADBE Text Random Seed`, 0, 10_000),
  } },
  wiggly: { matchName: "ADBE Text Wiggly Selector", settings: {
    mode: menu("ADBE Text Selector Mode", 6), maxAmount: n("ADBE Text Wiggly Max Amount", -100, 100), minAmount: n("ADBE Text Wiggly Min Amount", -100, 100), basedOn: menu("ADBE Text Range Type2", 4),
    wigglesPerSecond: n("ADBE Text Temporal Freq", 0, 600), correlation: n("ADBE Text Character Correlation", 0, 100), temporalPhase: n("ADBE Text Temporal Phase"), spatialPhase: n("ADBE Text Spatial Phase"),
    lockDimensions: bool("ADBE Text Wiggly Lock Dim"), randomSeed: n("ADBE Text Wiggly Random Seed", 0, 10_000),
  } },
  expression: { matchName: "ADBE Text Expressible Selector", settings: { basedOn: menu("ADBE Text Range Type2", 4), amount: n("ADBE Text Expressible Amount", -100, 100) } },
} as const satisfies Record<string, { matchName: string; settings: Record<string, ValueSpec> }>;
export type TextSelectorType = keyof typeof TEXT_SELECTORS;

const G = "ADBE Vector";
const REPEAT_T = `${G} Repeater Transform`, WIGGLE_T = `${G} Wiggler Transform`;
/**
 * Shape layer Contents items: primitives, gradient paints, and path operators.
 *
 * A gradient's colour stops are NOT reachable through the After Effects API: "ADBE
 * Vector Grad Colors" reports PropertyValueType.NO_VALUE and six independent write
 * techniques were refused on AE 26.2.1, so extynt shapes the gradient and its colours
 * are chosen in After Effects by hand. Geometry, opacity, width, blend and fill rule
 * are settable.
 */
export const SHAPE_ITEMS = {
  rectangle: { matchName: `${G} Shape - Rect`, family: "primitive", settings: { size: v2(`${G} Rect Size`, 0), position: v2(`${G} Rect Position`), roundness: n(`${G} Rect Roundness`, 0), direction: menu(`${G} Shape Direction`, 3) } },
  ellipse: { matchName: `${G} Shape - Ellipse`, family: "primitive", settings: { size: v2(`${G} Ellipse Size`, 0), position: v2(`${G} Ellipse Position`), direction: menu(`${G} Shape Direction`, 3) } },
  star: { matchName: `${G} Shape - Star`, family: "primitive", settings: { type: menu(`${G} Star Type`, 2), points: n(`${G} Star Points`, 3, 1000), position: v2(`${G} Star Position`), rotation: n(`${G} Star Rotation`), innerRadius: n(`${G} Star Inner Radius`, 0), outerRadius: n(`${G} Star Outer Radius`, 0), innerRoundness: n(`${G} Star Inner Roundess`, -1000, 1000), outerRoundness: n(`${G} Star Outer Roundess`, -1000, 1000), direction: menu(`${G} Shape Direction`, 3) } },
  "gradient-fill": { matchName: `${G} Graphic - G-Fill`, family: "gradient", settings: { type: menu(`${G} Grad Type`, 2), startPoint: v2(`${G} Grad Start Pt`), endPoint: v2(`${G} Grad End Pt`), highlightLength: n(`${G} Grad HiLite Length`, -100, 100), highlightAngle: n(`${G} Grad HiLite Angle`), opacity: n(`${G} Fill Opacity`, 0, 100), fillRule: menu(`${G} Fill Rule`, 2), blendMode: menu(`${G} Blend Mode`, 30) } },
  "gradient-stroke": { matchName: `${G} Graphic - G-Stroke`, family: "gradient", settings: { type: menu(`${G} Grad Type`, 2), startPoint: v2(`${G} Grad Start Pt`), endPoint: v2(`${G} Grad End Pt`), highlightLength: n(`${G} Grad HiLite Length`, -100, 100), highlightAngle: n(`${G} Grad HiLite Angle`), opacity: n(`${G} Stroke Opacity`, 0, 100), width: n(`${G} Stroke Width`, 0, 10_000), lineCap: menu(`${G} Stroke Line Cap`, 3), lineJoin: menu(`${G} Stroke Line Join`, 3), miterLimit: n(`${G} Stroke Miter Limit`, 1, 100), blendMode: menu(`${G} Blend Mode`, 30) } },
  "merge-paths": { matchName: `${G} Filter - Merge`, family: "operator", settings: { mode: menu(`${G} Merge Type`, 5) } },
  "offset-paths": { matchName: `${G} Filter - Offset`, family: "operator", settings: { amount: n(`${G} Offset Amount`), lineJoin: menu(`${G} Offset Line Join`, 3), miterLimit: n(`${G} Offset Miter Limit`, 1, 100), copies: n(`${G} Offset Copies`, 0, 100), copyOffset: n(`${G} Offset Copy Offset`) } },
  "pucker-bloat": { matchName: `${G} Filter - PB`, family: "operator", settings: { amount: n(`${G} PuckerBloat Amount`, -100_000, 100_000) } },
  repeater: { matchName: `${G} Filter - Repeater`, family: "operator", settings: { copies: n(`${G} Repeater Copies`, 0, 10_000), offset: n(`${G} Repeater Offset`), composite: menu(`${G} Repeater Order`, 2), anchorPoint: v2(`${REPEAT_T}/${G} Repeater Anchor`), position: v2(`${REPEAT_T}/${G} Repeater Position`), scale: v2(`${REPEAT_T}/${G} Repeater Scale`, -100_000, 100_000), rotation: n(`${REPEAT_T}/${G} Repeater Rotation`), startOpacity: n(`${REPEAT_T}/${G} Repeater Opacity 1`, 0, 100), endOpacity: n(`${REPEAT_T}/${G} Repeater Opacity 2`, 0, 100) } },
  "round-corners": { matchName: `${G} Filter - RC`, family: "operator", settings: { radius: n(`${G} RoundCorner Radius`, 0) } },
  "trim-paths": { matchName: `${G} Filter - Trim`, family: "operator", settings: { start: n(`${G} Trim Start`, 0, 100), end: n(`${G} Trim End`, 0, 100), offset: n(`${G} Trim Offset`), mode: menu(`${G} Trim Type`, 2) } },
  twist: { matchName: `${G} Filter - Twist`, family: "operator", settings: { angle: n(`${G} Twist Angle`), center: v2(`${G} Twist Center`) } },
  "wiggle-paths": { matchName: `${G} Filter - Roughen`, family: "operator", settings: { size: n(`${G} Roughen Size`, 0), detail: n(`${G} Roughen Detail`, 0, 1000), points: menu(`${G} Roughen Points`, 2), wigglesPerSecond: n(`${G} Temporal Freq`, 0, 600), correlation: n(`${G} Correlation`, 0, 100), temporalPhase: n(`${G} Temporal Phase`), spatialPhase: n(`${G} Spatial Phase`), randomSeed: n(`${G} Random Seed`, 0, 10_000) } },
  "wiggle-transform": { matchName: `${G} Filter - Wiggler`, family: "operator", settings: { wigglesPerSecond: n(`${G} Xform Temporal Freq`, 0, 600), correlation: n(`${G} Correlation`, 0, 100), temporalPhase: n(`${G} Temporal Phase`), spatialPhase: n(`${G} Spatial Phase`), randomSeed: n(`${G} Random Seed`, 0, 10_000), anchorPoint: v2(`${WIGGLE_T}/${G} Wiggler Anchor`), position: v2(`${WIGGLE_T}/${G} Wiggler Position`), scale: v2(`${WIGGLE_T}/${G} Wiggler Scale`, -100_000, 100_000), rotation: n(`${WIGGLE_T}/${G} Wiggler Rotation`) } },
  "zig-zag": { matchName: `${G} Filter - Zigzag`, family: "operator", settings: { size: n(`${G} Zigzag Size`), ridges: n(`${G} Zigzag Detail`, 0, 1000), points: menu(`${G} Zigzag Points`, 2) } },
} as const satisfies Record<string, { matchName: string; family: "primitive" | "gradient" | "operator"; settings: Record<string, ValueSpec> }>;
export type ShapeItemKind = keyof typeof SHAPE_ITEMS;

/** Every BlendingMode enum name in AE (SILHOUETE_ALPHA is AE's own spelling). */
export const ALL_BLEND_MODES = ["NORMAL", "DISSOLVE", "DANCING_DISSOLVE", "DARKEN", "MULTIPLY", "COLOR_BURN", "CLASSIC_COLOR_BURN", "LINEAR_BURN", "DARKER_COLOR", "ADD", "LIGHTEN", "SCREEN", "COLOR_DODGE", "CLASSIC_COLOR_DODGE", "LINEAR_DODGE", "LIGHTER_COLOR", "OVERLAY", "SOFT_LIGHT", "HARD_LIGHT", "LINEAR_LIGHT", "VIVID_LIGHT", "PIN_LIGHT", "HARD_MIX", "DIFFERENCE", "CLASSIC_DIFFERENCE", "EXCLUSION", "SUBTRACT", "DIVIDE", "HUE", "SATURATION", "COLOR", "LUMINOSITY", "STENCIL_ALPHA", "STENCIL_LUMA", "SILHOUETE_ALPHA", "SILHOUETTE_LUMA", "ALPHA_ADD", "LUMINESCENT_PREMUL"] as const;
/** Extra layer switches; the value kind decides validation. Enum values are AE enum member names. */
export const LAYER_SWITCHES = {
  "motion-blur": { host: "motionBlur", kind: "boolean" }, "collapse-transformation": { host: "collapseTransformation", kind: "boolean" }, "guide-layer": { host: "guideLayer", kind: "boolean" },
  "per-character-3d": { host: "threeDPerChar", kind: "boolean" }, "adjustment": { host: "adjustmentLayer", kind: "boolean" }, "effects-active": { host: "effectsActive", kind: "boolean" },
  "quality": { host: "quality", kind: "enum", enumObject: "LayerQuality", values: ["BEST", "DRAFT", "WIREFRAME"] },
  "sampling": { host: "samplingQuality", kind: "enum", enumObject: "LayerSamplingQuality", values: ["BILINEAR", "BICUBIC"] },
  "frame-blending": { host: "frameBlendingType", kind: "enum", enumObject: "FrameBlendingType", values: ["NO_FRAME_BLEND", "FRAME_MIX", "PIXEL_MOTION"] },
  "label": { host: "label", kind: "integer", min: 0, max: 16 },
  "light-type": { host: "lightType", kind: "enum", enumObject: "LightType", values: ["PARALLEL", "SPOT", "POINT", "AMBIENT"] },
  "preserve-transparency": { host: "preserveTransparency", kind: "boolean" },
  "auto-orient": { host: "autoOrient", kind: "enum", enumObject: "AutoOrientType", values: ["NO_AUTO_ORIENT", "ALONG_PATH", "CAMERA_OR_POINT_OF_INTEREST", "CHARACTERS_TOWARD_CAMERA"] },
} as const;
export type LayerSwitchRole = keyof typeof LAYER_SWITCHES;

export const EXTENDED_OPERATION_TYPES = ["precompose_layers", "add_text_animator", "update_text_animator", "add_shape_item", "update_shape_item", "add_essential_property", "export_mogrt", "export_frame", "save_project", "set_composition_guides", "set_project_settings", "derive_layer", "retime_layer", "dolly_camera", "edit_keyframes", "read_keyframes", "remove_effect", "reorder_effect", "set_puppet_pins", "replace_layer_source", "center_anchor", "copy_effects", "set_text_path", "open_composition", "start_analysis", "resize_solid", "tracker_to_nulls", "collect_project", "switch_project", "save_layer_preset", "cleanup_project"] as const;
