/**
 * The fixture's vocabulary as data: the path constants, the plan-type sets, the declaring fields, the shape item and 3D option
 * tables and the effect controls it can mint. Nothing here computes.
 */

import type { PropertySnapshot } from "@extynt/project-graph";

export const CANONICAL_PREFIX = "__new__:";

export const UNSUPPORTED_IN_FIXTURE = "UNSUPPORTED_IN_FIXTURE";

export const DEPENDENCY_FAILED = "DEPENDENCY_FAILED";

/** The fixture's minted-id namespace; `fx-` cannot collide with a fixture id. */
export const MINT_PREFIX = "fx-";

export const TRANSFORM = "ADBE Transform Group";

export const ANCHOR_PATH = `${TRANSFORM}/ADBE Anchor Point`;

export const POSITION_PATH = `${TRANSFORM}/ADBE Position`;

export const SCALE_PATH = `${TRANSFORM}/ADBE Scale`;

export const ROTATION_PATH = `${TRANSFORM}/ADBE Rotate Z`;

export const OPACITY_PATH = `${TRANSFORM}/ADBE Opacity`;

export const TEXT_PROPERTIES = "ADBE Text Properties";

export const TEXT_DOCUMENT_PATH = `${TEXT_PROPERTIES}/ADBE Text Document`;

export const MARKER_PATH = "ADBE Marker";

export const MASK_PARADE = "ADBE Mask Parade";

export const MASK_ATOM = "ADBE Mask Atom";

export const SHAPE_ROOT = "ADBE Root Vectors Group";

export const VECTOR_GROUP = "ADBE Vector Group";

export const VECTOR_CONTENTS = "ADBE Vectors Group";

export const EFFECT_PARADE = "ADBE Effect Parade";

/** The transform roles `set_layer_property` may address; the host's exact table. */
export const NATIVE_PROPERTY_PATHS: Readonly<Record<string, string>> = {
  "transform.anchor": ANCHOR_PATH,
  "transform.position": POSITION_PATH,
  "transform.scale": SCALE_PATH,
  "transform.rotation": ROTATION_PATH,
  "transform.opacity": OPACITY_PATH,
};

/** The plan types this fixture applies. Everything else in the 55-type vocabulary is refused. */
export const IMPLEMENTED_TYPES: ReadonlySet<string> = new Set([
  "create_composition", "create_layer", "create_shape_group", "add_shape_item", "update_shape_item",
  "set_shape_path", "ensure_shape_fill", "ensure_shape_stroke", "set_composition_settings",
  "set_layer_name", "set_layer_parent", "set_layer_timing", "set_layer_property", "set_layer_attribute",
  "animate_property", "set_expression", "ensure_effect", "ensure_layer_style", "set_effect_control",
  "add_mask", "update_mask", "add_marker", "update_marker", "remove_marker",
  "reorder_layer", "remove_layer", "duplicate_layer", "set_track_matte", "set_text_document", "draw_vector_shapes",
  "add_text_animator", "update_text_animator", "set_camera_options", "set_light_options", "set_material_options", "add_essential_property", "animate_control",
]);

/** The whole typed plan vocabulary, so a type outside it gets a truthful "not a plan type" refusal. */
export const PLAN_TYPES: ReadonlySet<string> = new Set([
  "add_essential_property", "add_marker", "add_mask", "add_shape_item", "add_text_animator", "animate_control",
  "animate_property", "apply_preset", "clear_footage_proxy", "create_composition", "create_folder", "create_layer",
  "cleanup_project", "create_shape_group", "delete_project_item", "detect_scene_edits", "draw_vector_shapes", "duplicate_layer", "ensure_effect", "ensure_layer_style",
  "ensure_shape_fill", "ensure_shape_stroke", "ensure_text_animator", "export_mogrt", "import_file",
  "move_item_to_folder", "precompose_layers", "remove_layer", "remove_marker", "remove_mask", "render_composition",
  "reorder_layer", "replace_footage", "set_audio", "set_camera_options", "set_composition_guides",
  "set_composition_settings", "set_effect_control", "set_expression", "set_footage_interpretation", "set_footage_proxy", "set_item_name",
  "set_layer_attribute", "set_layer_name", "set_layer_parent", "set_layer_property", "set_layer_timing",
  "set_light_options", "set_loop", "set_material_options", "set_project_settings", "set_shape_path",
  "set_text_document", "set_time_remap", "set_track_matte", "update_marker", "update_mask", "update_shape_item",
  "update_text_animator",
]);

/**
 * Which fields *declare* an object, mirroring packages/mcp-server/src/placeholders.ts: a later
 * operation naming what a failed declaration promised reports DEPENDENCY_FAILED.
 */
export const DECLARED_FIELDS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  create_layer: [["target", "layerId"]],
  duplicate_layer: [["", "newLayerId"]],
  create_composition: [["", "newCompositionId"]],
  precompose_layers: [["", "newCompositionId"], ["", "newLayerId"]],
  create_folder: [["", "newFolderId"]],
  import_file: [["", "newItemId"]],
  add_mask: [["", "newMaskId"]],
  create_shape_group: [["", "newGroupId"]],
  add_text_animator: [["", "newAnimatorId"]],
  add_shape_item: [["", "newItemId"]],
};

/** How a shape item or animator setting reads and validates. */
export type SpecKind = "number" | "vec2" | "vec23" | "color" | "menu" | "boolean";

export interface ShapeItemSpec { matchName: string; settings: Readonly<Record<string, readonly [path: string, kind: SpecKind]>> }

export const V = "ADBE Vector";

const REPEATER_TRANSFORM = `${V} Repeater Transform`;

const WIGGLER_TRANSFORM = `${V} Wiggler Transform`;

export const SHAPE_ITEMS: Readonly<Record<string, ShapeItemSpec>> = {
  rectangle: { matchName: `${V} Shape - Rect`, settings: { size: [`${V} Rect Size`, "vec2"], position: [`${V} Rect Position`, "vec2"], roundness: [`${V} Rect Roundness`, "number"], direction: [`${V} Shape Direction`, "menu"] } },
  ellipse: { matchName: `${V} Shape - Ellipse`, settings: { size: [`${V} Ellipse Size`, "vec2"], position: [`${V} Ellipse Position`, "vec2"], direction: [`${V} Shape Direction`, "menu"] } },
  star: { matchName: `${V} Shape - Star`, settings: { type: [`${V} Star Type`, "menu"], points: [`${V} Star Points`, "number"], position: [`${V} Star Position`, "vec2"], rotation: [`${V} Star Rotation`, "number"], innerRadius: [`${V} Star Inner Radius`, "number"], outerRadius: [`${V} Star Outer Radius`, "number"], innerRoundness: [`${V} Star Inner Roundess`, "number"], outerRoundness: [`${V} Star Outer Roundess`, "number"], direction: [`${V} Shape Direction`, "menu"] } },
  "gradient-fill": { matchName: `${V} Graphic - G-Fill`, settings: { type: [`${V} Grad Type`, "menu"], startPoint: [`${V} Grad Start Pt`, "vec2"], endPoint: [`${V} Grad End Pt`, "vec2"], highlightLength: [`${V} Grad HiLite Length`, "number"], highlightAngle: [`${V} Grad HiLite Angle`, "number"], opacity: [`${V} Fill Opacity`, "number"], fillRule: [`${V} Fill Rule`, "menu"], blendMode: [`${V} Blend Mode`, "menu"] } },
  "gradient-stroke": { matchName: `${V} Graphic - G-Stroke`, settings: { type: [`${V} Grad Type`, "menu"], startPoint: [`${V} Grad Start Pt`, "vec2"], endPoint: [`${V} Grad End Pt`, "vec2"], highlightLength: [`${V} Grad HiLite Length`, "number"], highlightAngle: [`${V} Grad HiLite Angle`, "number"], opacity: [`${V} Stroke Opacity`, "number"], width: [`${V} Stroke Width`, "number"], lineCap: [`${V} Stroke Line Cap`, "menu"], lineJoin: [`${V} Stroke Line Join`, "menu"], miterLimit: [`${V} Stroke Miter Limit`, "number"], blendMode: [`${V} Blend Mode`, "menu"] } },
  "merge-paths": { matchName: `${V} Filter - Merge`, settings: { mode: [`${V} Merge Type`, "menu"] } },
  "offset-paths": { matchName: `${V} Filter - Offset`, settings: { amount: [`${V} Offset Amount`, "number"], lineJoin: [`${V} Offset Line Join`, "menu"], miterLimit: [`${V} Offset Miter Limit`, "number"], copies: [`${V} Offset Copies`, "number"], copyOffset: [`${V} Offset Copy Offset`, "number"] } },
  "pucker-bloat": { matchName: `${V} Filter - PB`, settings: { amount: [`${V} PuckerBloat Amount`, "number"] } },
  repeater: { matchName: `${V} Filter - Repeater`, settings: { copies: [`${V} Repeater Copies`, "number"], offset: [`${V} Repeater Offset`, "number"], composite: [`${V} Repeater Order`, "menu"], anchorPoint: [`${REPEATER_TRANSFORM}/${V} Repeater Anchor`, "vec2"], position: [`${REPEATER_TRANSFORM}/${V} Repeater Position`, "vec2"], scale: [`${REPEATER_TRANSFORM}/${V} Repeater Scale`, "vec2"], rotation: [`${REPEATER_TRANSFORM}/${V} Repeater Rotation`, "number"], startOpacity: [`${REPEATER_TRANSFORM}/${V} Repeater Opacity 1`, "number"], endOpacity: [`${REPEATER_TRANSFORM}/${V} Repeater Opacity 2`, "number"] } },
  "round-corners": { matchName: `${V} Filter - RC`, settings: { radius: [`${V} RoundCorner Radius`, "number"] } },
  "trim-paths": { matchName: `${V} Filter - Trim`, settings: { start: [`${V} Trim Start`, "number"], end: [`${V} Trim End`, "number"], offset: [`${V} Trim Offset`, "number"], mode: [`${V} Trim Type`, "menu"] } },
  twist: { matchName: `${V} Filter - Twist`, settings: { angle: [`${V} Twist Angle`, "number"], center: [`${V} Twist Center`, "vec2"] } },
  "wiggle-paths": { matchName: `${V} Filter - Roughen`, settings: { size: [`${V} Roughen Size`, "number"], detail: [`${V} Roughen Detail`, "number"], points: [`${V} Roughen Points`, "menu"], wigglesPerSecond: [`${V} Temporal Freq`, "number"], correlation: [`${V} Correlation`, "number"], temporalPhase: [`${V} Temporal Phase`, "number"], spatialPhase: [`${V} Spatial Phase`, "number"], randomSeed: [`${V} Random Seed`, "number"] } },
  "wiggle-transform": { matchName: `${V} Filter - Wiggler`, settings: { wigglesPerSecond: [`${V} Xform Temporal Freq`, "number"], correlation: [`${V} Correlation`, "number"], temporalPhase: [`${V} Temporal Phase`, "number"], spatialPhase: [`${V} Spatial Phase`, "number"], randomSeed: [`${V} Random Seed`, "number"], anchorPoint: [`${WIGGLER_TRANSFORM}/${V} Wiggler Anchor`, "vec2"], position: [`${WIGGLER_TRANSFORM}/${V} Wiggler Position`, "vec2"], scale: [`${WIGGLER_TRANSFORM}/${V} Wiggler Scale`, "vec2"], rotation: [`${WIGGLER_TRANSFORM}/${V} Wiggler Rotation`, "number"] } },
  "zig-zag": { matchName: `${V} Filter - Zigzag`, settings: { size: [`${V} Zigzag Size`, "number"], ridges: [`${V} Zigzag Detail`, "number"], points: [`${V} Zigzag Points`, "menu"] } },
};

/**
 * Controls the fixture mints for an effect it creates. Only effects the repository has measured
 * evidence for appear here; any other effect is created with no invented control list.
 */
export const EFFECT_CONTROLS: Readonly<Record<string, readonly PropertySnapshot[]>> = {
  "ADBE Gaussian Blur 2": [
    { path: `${EFFECT_PARADE}/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001`, matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", kind: "property", valueType: "number", value: 25, canSetValue: true },
    { path: `${EFFECT_PARADE}/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0002`, matchName: "ADBE Gaussian Blur 2-0002", displayName: "Blur Dimensions", kind: "property", valueType: "number", value: 1, canSetValue: true },
    { path: `${EFFECT_PARADE}/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0003`, matchName: "ADBE Gaussian Blur 2-0003", displayName: "Repeat Edge Pixels", kind: "property", valueType: "boolean", value: false, canSetValue: true },
  ],
};

/** Layer types that carry a Material Options group once their 3D switch is on. */
export const MATERIAL_LAYER_TYPES: ReadonlySet<string> = new Set(["text", "shape", "solid", "footage"]);

/** The three operations that write a 3D option group. */
export type ThreeDOperation = "set_camera_options" | "set_light_options" | "set_material_options";

/** One typed 3D option: the matchName inside its group, how it reads, and the bounds the host validates. */
export type ThreeDOption = { matchName: string; displayName: string } & ({ kind: "number"; min: number; max: number } | { kind: "boolean" | "color" });

/** A 3D option group: where it lives, the layer type that carries it (none for materials) and its options. */
export interface ThreeDOptionGroup { matchName: string; displayName: string; layerType?: "camera" | "light"; options: Readonly<Record<string, ThreeDOption>> }

const number = (matchName: string, displayName: string, min: number, max: number): ThreeDOption => ({ matchName, displayName, kind: "number", min, max });

const toggle = (matchName: string, displayName: string): ThreeDOption => ({ matchName, displayName, kind: "boolean" });

/** Camera, light and material option groups, copied from apps/panel/host/apply-layers.jsx and apply-validate-rules.jsx. */
export const THREE_D_OPTION_GROUPS: Readonly<Record<ThreeDOperation, ThreeDOptionGroup>> = {
  set_camera_options: { matchName: "ADBE Camera Options Group", displayName: "Camera Options", layerType: "camera", options: {
    zoom: number("ADBE Camera Zoom", "Zoom", 1, 100_000), depthOfField: toggle("ADBE Camera Depth of Field", "Depth of Field"), focusDistance: number("ADBE Camera Focus Distance", "Focus Distance", 0, 1_000_000),
    aperture: number("ADBE Camera Aperture", "Aperture", 0.01, 10_000), blurLevel: number("ADBE Camera Blur Level", "Blur Level", 0, 100),
  } },
  set_light_options: { matchName: "ADBE Light Options Group", displayName: "Light Options", layerType: "light", options: {
    intensity: number("ADBE Light Intensity", "Intensity", 0, 10_000), color: { matchName: "ADBE Light Color", displayName: "Color", kind: "color" },
    coneAngle: number("ADBE Light Cone Angle", "Cone Angle", 0, 180), coneFeather: number("ADBE Light Cone Feather 2", "Cone Feather", 0, 100),
  } },
  set_material_options: { matchName: "ADBE Material Options Group", displayName: "Material Options", options: {
    acceptsShadows: toggle("ADBE Accepts Shadows", "Accepts Shadows"), castsShadows: toggle("ADBE Casts Shadows", "Casts Shadows"), lightTransmission: number("ADBE Light Transmission", "Light Transmission", 0, 100),
    diffuse: number("ADBE Diffuse Coefficient", "Diffuse", 0, 100), specularIntensity: number("ADBE Specular Coefficient", "Specular Intensity", 0, 100), specularShininess: number("ADBE Shininess Coefficient", "Specular Shininess", 0, 100), metal: number("ADBE Metal Coefficient", "Metal", 0, 100),
  } },
};
