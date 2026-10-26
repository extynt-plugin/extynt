// The native features a request can name, each tied to the operations that make it and the project or applied-operation fact that proves it; sits under request-coverage.
import { orbitPresent } from "./orbit-coverage.js";
import { anyLayer, appliedWith, cameraMoved, hasEffect, hasExpression, hasProperty, propertiesOf, textMatteShown, type Evidence } from "./coverage-evidence.js";

/** The feature ids in the order a request's features are listed. */
export const FEATURE_IDS = ["text-animator", "selector-offset", "matte", "text-matte", "blur", "glow", "drop-shadow", "ramp", "wiggle", "repeater", "trim-paths", "camera", "camera-move", "null", "parent", "orbit", "markers", "three-d", "edit-keyframes", "tracking", "duplicate-composition", "essential-graphics"] as const;

/** One of the nameable features. */
export type FeatureId = (typeof FEATURE_IDS)[number];

/** A feature: how a request names it (a global pattern, read only through matchAll), the operations that make it, and the proof that the project shows it. */
export interface CoverageFeature {
  id: FeatureId;
  label: string;
  pattern: RegExp;
  operations: readonly string[];
  present(evidence: Evidence): boolean;
}

type FeatureDefinition = Omit<CoverageFeature, "id">;

const DEFINITIONS: Readonly<Record<FeatureId, FeatureDefinition>> = {
  "text-animator": {
    label: "a text animator (add_text_animator)",
    pattern: /\btext animators?\b|\brange selector\b|\bper[- ]character\b/gi,
    operations: ["add_text_animator", "ensure_text_animator", "update_text_animator"],
    present: ({ snapshot, applied }) => hasProperty(snapshot, (path) => path.includes("ADBE Text Animator")) || appliedWith(applied, ["add_text_animator", "ensure_text_animator"]),
  },
  "selector-offset": {
    label: "keyframes on the text animator's Range Selector Offset (ADBE Text Percent Offset)",
    pattern: /\b(selector|range)[- ]offset\b|\boffset (animation|from|0)\b/gi,
    operations: ["add_text_animator", "update_text_animator"],
    present: ({ snapshot, applied }) => hasProperty(snapshot, (path, keyed) => keyed && path.endsWith("ADBE Text Percent Offset")) || appliedWith(applied, ["add_text_animator", "update_text_animator", "set_layer_property"], /Percent Offset[^}]*keyframes|keyframes[^}]*Percent Offset|"offset"\s*:\s*\{[^}]*keyframes/),
  },
  matte: {
    label: "a track matte (set_track_matte)",
    pattern: /\b(track )?mattes?\b|\bmatted\b/gi,
    operations: ["set_track_matte"],
    present: ({ snapshot, applied }) => anyLayer(snapshot, (layer) => layer.matteType !== "none" || layer.matteLayerId !== null) || appliedWith(applied, ["set_track_matte"]),
  },
  "text-matte": {
    label: "a track matte that involves the text layer (set_track_matte: the layer that should show only inside the letters takes the text layer as its alpha matte)",
    pattern: /\bmatte\b[^.;]{0,40}\b(over|on|across|onto|inside|through) (the |its )?(word|text|title|letters|type)\b/gi,
    operations: ["set_track_matte"],
    present: textMatteShown,
  },
  blur: {
    label: "a blur effect (ensure_effect, e.g. ADBE Gaussian Blur 2)",
    pattern: /(?<!motion[- ])\bblur(red|s)?\b/gi,
    operations: ["ensure_effect"],
    present: ({ snapshot, applied }) => hasEffect(snapshot, (name) => /blur/i.test(name) && !/motion blur/i.test(name)) || appliedWith(applied, ["ensure_effect"], /Blur/),
  },
  glow: {
    label: "a Glow effect (ensure_effect ADBE Glo2)",
    pattern: /\bglows?\b/gi,
    operations: ["ensure_effect"],
    present: ({ snapshot, applied }) => hasEffect(snapshot, (name) => /glo(w|2)/i.test(name)) || hasProperty(snapshot, (path) => /outerGlow|innerGlow/i.test(path)) || appliedWith(applied, ["ensure_effect", "ensure_layer_style"], /Glo2|glow/i),
  },
  "drop-shadow": {
    label: "a drop shadow (ensure_effect ADBE Drop Shadow, or ensure_layer_style)",
    pattern: /\bdrop[- ]?shadows?\b/gi,
    operations: ["ensure_effect", "ensure_layer_style"],
    present: ({ snapshot, applied }) => hasEffect(snapshot, (name) => name === "ADBE Drop Shadow") || hasProperty(snapshot, (path) => /dropShadow/i.test(path)) || appliedWith(applied, ["ensure_effect", "ensure_layer_style"], /Drop Shadow|dropShadow|drop-shadow/i),
  },
  ramp: {
    label: "a Gradient Ramp effect (ensure_effect ADBE Ramp)",
    pattern: /\b(gradient )?ramp\b(?!\s+(up|down)\b)/gi,
    operations: ["ensure_effect"],
    present: ({ snapshot, applied }) => hasEffect(snapshot, (name) => name === "ADBE Ramp") || appliedWith(applied, ["ensure_effect"], /ADBE Ramp/),
  },
  wiggle: {
    label: "a wiggle() expression (set_expression)",
    pattern: /\bwiggl(e|es|ing)\b/gi,
    operations: ["set_expression"],
    present: ({ snapshot, applied }) => hasExpression(snapshot, /wiggle\s*\(/) || appliedWith(applied, ["set_expression"], /wiggle\s*\(/),
  },
  repeater: {
    label: "a shape Repeater (add_shape_item ADBE Vector Filter - Repeater)",
    pattern: /\brepeaters?\b/gi,
    operations: ["add_shape_item"],
    present: ({ snapshot, applied }) => hasProperty(snapshot, (path) => path.includes("ADBE Vector Filter - Repeater")) || appliedWith(applied, ["add_shape_item"], /"item":"repeater"/),
  },
  "trim-paths": {
    label: "Trim Paths (add_shape_item ADBE Vector Filter - Trim)",
    pattern: /\btrim[- ]?paths?\b/gi,
    operations: ["add_shape_item"],
    present: ({ snapshot, applied }) => hasProperty(snapshot, (path) => path.includes("ADBE Vector Filter - Trim")) || appliedWith(applied, ["add_shape_item"], /"item":"trim-paths"/),
  },
  camera: {
    label: "a camera layer (create_layer layerType camera)",
    pattern: /\bcameras?\b/gi,
    operations: ["create_layer", "set_camera_options"],
    present: ({ snapshot, applied }) => anyLayer(snapshot, (layer) => layer.type === "camera") || appliedWith(applied, ["create_layer"], /"layerType":"camera"/),
  },
  "camera-move": {
    label: "a camera move: keyed camera Position (dolly_camera, with create_layer camera in the same queue)",
    pattern: /\bcamera\b[^.;]{0,40}\b(?:push(?:ing)?|pull(?:ing)?)[- ](?:in|out)\b|\b(?:push(?:ing)?|pull(?:ing)?)[- ](?:in|out)\b[^.;]{0,40}\bcamera\b|\bpush-in\b|\bdolly(?:ing)?\b|\bcamera (?:moves?|movement|zoom[- ]?(?:in|out))\b/gi,
    operations: ["create_layer", "dolly_camera"],
    present: cameraMoved,
  },
  null: {
    label: "a null layer (create_layer layerType null)",
    pattern: /\bnull\b/gi,
    operations: ["create_layer"],
    present: ({ snapshot, applied }) => anyLayer(snapshot, (layer) => layer.type === "null") || appliedWith(applied, ["create_layer"], /"layerType":"null"/),
  },
  parent: {
    label: "a parented layer (set_layer_parent)",
    pattern: /\bparent(ed|ing|s)?\b/gi,
    operations: ["set_layer_parent"],
    present: ({ snapshot, applied }) => anyLayer(snapshot, (layer) => layer.parentId !== null) || appliedWith(applied, ["set_layer_parent"], /"parentLayerId":"[^"]/),
  },
  orbit: {
    label: "orbit motion: the orbiting layer must travel around the centre — keyed Position along the path (ae_solve_arc_path gives the keys), or a pivot null AT the centre whose Rotation is keyed and the orbiting layer parented to it, offset from it by the radius (rotating a holder the layer sits on only spins it in place)",
    pattern: /\borbit(s|ing|ed)?\b|\bcircl(e|es|ing) (around|round)\b|\brevolv(e|es|ing) around\b/gi,
    operations: ["animate_property", "set_layer_property", "set_layer_parent", "create_layer"],
    present: orbitPresent,
  },
  markers: {
    label: "markers (add_marker)",
    pattern: /\bmarkers?\b/gi,
    operations: ["add_marker"],
    present: ({ snapshot, applied }) => snapshot.compositions.some((composition) => (composition.markers?.count ?? 0) > 0) || hasProperty(snapshot, (path, keyed) => keyed && path.endsWith("ADBE Marker")) || appliedWith(applied, ["add_marker"]),
  },
  "three-d": {
    label: "a 3D layer (set_layer_attribute three-d)",
    pattern: /\b3d\b/gi,
    operations: ["set_layer_attribute"],
    present: ({ snapshot, applied }) => anyLayer(snapshot, (layer) => layer.threeD === true || propertiesOf(layer).some((property) => property.path.endsWith("ADBE Orientation"))) || appliedWith(applied, ["set_layer_attribute"], /three-?d/i),
  },
  "edit-keyframes": {
    label: "an edit of existing keyframes (edit_keyframes: delete, move, scale or copy keys)",
    pattern: /\b(?:read|inspect|list|show|see|delete|remove|shift|retime|re-time|stretch|slide|offset|copy|paste|move)\b[^.;]{0,30}\bkey ?frames?\b|\bkey ?frames?\b[^.;]{0,30}\b(?:delete|shift|retime|re-time|copy|paste|stretch|slide)\b/gi,
    operations: ["edit_keyframes", "read_keyframes"],
    present: ({ applied }) => appliedWith(applied, ["edit_keyframes", "read_keyframes", "animate_property", "animate_control", "set_layer_property", "dolly_camera"]),
  },
  tracking: {
    label: "tracking or stabilizing footage (start_analysis, tracker_to_nulls; the user clicks Analyze and Create Camera)",
    pattern: /\b(?:warp[- ]?stabili[sz]\w*|stabili[sz]e\b|3d (?:camera )?track\w*|camera track\w*|motion track\w*|track motion|track points?|create camera)\b/gi,
    operations: ["start_analysis", "tracker_to_nulls"],
    present: ({ applied }) => appliedWith(applied, ["start_analysis", "tracker_to_nulls", "create_layer", "set_layer_parent"]),
  },
  "duplicate-composition": {
    label: "a copy of the source composition (duplicate_composition, then edit the copy)",
    pattern: /\b(?:duplicate|copy|clone|variants?|variations?)\b[^.;]{0,40}\bcomp(?:osition)?s?\b|\bcomp(?:osition)?s?\b[^.;]{0,30}\b(?:duplicate|copy|clone)\b|\bcycles?\b[^.;]{0,50}\b(?:from|of|based on)\b[^.;]{0,30}\bcomp(?:osition)?s?\b/gi,
    operations: ["duplicate_composition"],
    present: ({ snapshot, applied }) => snapshot.compositions.length > 1 || appliedWith(applied, ["duplicate_composition", "create_composition"]),
  },
  "essential-graphics": {
    label: "an Essential Graphics property (add_essential_property)",
    pattern: /\bessential (graphics|propert(y|ies))\b|\bmogrt\b/gi,
    operations: ["add_essential_property"],
    present: ({ applied }) => appliedWith(applied, ["add_essential_property"]),
  },
};

/** The feature with this id. */
export const featureOf = (id: FeatureId): CoverageFeature => ({ id, ...DEFINITIONS[id] });
