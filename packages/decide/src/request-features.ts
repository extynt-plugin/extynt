// The features a request can name, each with the words that name it and the executed operations that prove it was made; shared by the request-parts and completion decisions.
import { ASPECT_VARIANT_CONCEPT, CAMERA_MOVE_CONCEPT, LETTER_SPACING_CONCEPT, LINK_TO_NULL_CONCEPT, NULL_PRONOUN_LINK_CONCEPT, ORBIT_CONCEPT, PIN_TO_MOVING_CONCEPT, RAMP_CONCEPT, STEADY_CONCEPT, TEXT_ANIMATOR_CONCEPT, TEXT_MATTE_CONCEPT, TRIM_PATH_CONCEPT } from "./request-concepts.js";
import { BLUR_WORDS, CAMERA_WORDS, DROP_SHADOW_WORDS, ESSENTIAL_GRAPHICS_PATTERN, GLOW_WORDS, MARKER_WORDS, MOTION_BLUR_WORDS, NULL_WORDS, PARENT_WORDS, REPEATER_LOOPING, REPEATER_WORDS, THREE_D_PATTERN, WIGGLE_FIXING, WIGGLE_WORDS } from "./request-feature-words.js";
import { DUPLICATE_COMPOSITION_PATTERN, KEYFRAME_EDIT_PATTERN, MATTE_FINISH, MATTE_WORDS, TRACKING_PATTERN } from "./request-feature-patterns.js";
import { CAMERA_MOVE_MORE, ORBIT_MORE_WORDS, STEADY_MORE, TRIM_PATH_MORE } from "./request-concepts-motion.js";
import { ASPECT_VARIANT_MORE, GRADIENT_MORE, LETTER_SPACING_MORE, LINK_TO_NULL_MORE, TEXT_ANIMATOR_MORE, TEXT_MATTE_MORE } from "./request-concepts-text.js";
import { ATTACH_TO_NULL_CJK, ATTACH_TO_NULL_CONCEPT, CUT_THROUGH_SHAPE_CONCEPT, DRAW_START_TO_END_CONCEPT, FILL_LETTERS_CONCEPT, LIGHT_AND_SHADOW_CJK, LIGHT_AND_SHADOW_LATIN, SEND_ROUND_CONCEPT, STAMP_PATTERN_CONCEPT, STATIC_RING_ARRANGEMENT, STICK_TO_MOVING_CONCEPT, TRIM_PATH_EVERYDAY, WIGGLE_EVERYDAY } from "./request-concepts-everyday.js";
import { phraseRegex, unionRegex } from "./request-text.js";
import { RAMP_WORD, rampReading } from "./ramp-context.js";

/** An executed operation as a completion judge reads it: its type, its payload as JSON text, and the property and position keys it wrote. */
export type AppliedStep = {
  readonly type: string;
  readonly json: string;
  readonly propertyPath: string;
  readonly role: string;
  readonly positionKeys: ReadonlyArray<readonly [number, number]>;
};

interface Feature {
  readonly pattern: RegExp;
  readonly ignore?: RegExp;
  shown(applied: ReadonlyArray<AppliedStep>): boolean;
}

const MATTE_VERB_ON_TEXT = /(?<!track |alpha |luma )\bmatt(?:e|ed|ing)\b(?=[^.;]{0,40}\b(?:with|using|by|via|through|inside|to) (?:the |its |a |each |every )?(?:text|title|type|letters?|words?)\b)[^.;]*/giu;

const MIN_PATH_KEYS = 3;
const LINE_TOLERANCE = 1;
const POSITION_PATH = /(^|\/)ADBE Position$/;

function appliedWith(applied: ReadonlyArray<AppliedStep>, types: ReadonlyArray<string>, pattern?: RegExp): boolean {
  return applied.some((step) => types.includes(step.type) && (pattern === undefined || pattern.test(step.json)));
}

function curves(points: ReadonlyArray<readonly [number, number]>): boolean {
  const first = points[0];
  const second = points.find((point) => first !== undefined && (point[0] !== first[0] || point[1] !== first[1]));
  if (first === undefined || second === undefined) return false;
  const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
  const offLine = (point: readonly [number, number]): number => Math.abs((second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0])) / length;
  return points.some((point) => offLine(point) > LINE_TOLERANCE);
}

function travelsAroundCentre(applied: ReadonlyArray<AppliedStep>): boolean {
  const animatesPosition = (step: AppliedStep): boolean => step.type === "animate_property" && (step.role === "transform.position" || POSITION_PATH.test(step.propertyPath));
  return applied.some((step) => animatesPosition(step) && step.positionKeys.length >= MIN_PATH_KEYS && curves(step.positionKeys));
}

/** The feature ids, in the order a request's features are listed. */
export const FEATURE_IDS = [
  "text-animator", "selector-offset", "matte", "text-matte", "blur", "glow", "drop-shadow", "ramp", "wiggle", "repeater", "trim-paths", "camera",
  "camera-move", "null", "parent", "orbit", "markers", "three-d", "edit-keyframes", "tracking", "duplicate-composition", "essential-graphics",
] as const;

/** One of the nameable features. */
export type FeatureId = (typeof FEATURE_IDS)[number];

const EDIT_PROOF = ["edit_keyframes", "read_keyframes", "animate_property", "animate_control", "set_layer_property", "dolly_camera"];

/** What each feature means in plain words, for a reader or a model that does not know the jargon. */
export const FEATURE_DESCRIPTIONS = {
  "text-animator": "a text animator on a text layer, such as a range selector or per-character animation",
  "selector-offset": "keyframes on a text animator's range selector offset, asked only when the request names the offset, the range selector or keyframing them",
  matte: "a track matte",
  "text-matte": "a track matte that involves a text layer, so a layer shows only inside the letters",
  blur: "a blur effect such as Gaussian, box, directional, radial or lens blur; not the motion blur layer switch",
  glow: "a glow effect or glow layer style",
  "drop-shadow": "a drop shadow effect or layer style",
  ramp: "a gradient ramp effect: a colour or gradient running from one colour to another; a ramp of timing, speed or easing on an animation is not this",
  wiggle: "a wiggle expression that shakes a property randomly",
  repeater: "a shape repeater that duplicates a shape in a pattern",
  "trim-paths": "trim paths on a shape, so a stroke or outline is drawn on, drawn off or revealed along its path, as when someone draws an outline on",
  camera: "a camera layer",
  "camera-move": "a camera move such as a push-in, pull-out or dolly",
  null: "a null layer used as a controller",
  parent: "parenting one layer to another",
  orbit: "orbit motion, a layer travelling around a centre rather than spinning in place",
  markers: "composition or layer markers",
  "three-d": "a 3D layer",
  "edit-keyframes": "an edit of existing keyframes: reading, shifting, retiming, deleting or copying them",
  tracking: "tracking or stabilizing footage, or the letter spacing of text (typographic tracking, kerning)",
  "duplicate-composition": "a duplicate of a composition to edit as a variant",
  "essential-graphics": "an Essential Graphics property exposed for a motion graphics template",
} as const satisfies Readonly<Record<FeatureId, string>>;

/** The span of a request a feature reading ignores: the bare word ramp, unless the request reads it as a gradient (ramp-context.ts). */
export function ignoredSpans(id: FeatureId, request: string): RegExp | undefined {
  if (id === "ramp") return rampReading(request) === "gradient" ? undefined : RAMP_WORD;
  return FEATURES[id].ignore;
}

/** Every feature: the words that name it in each language, and which executed operations show it was made. */
export const FEATURES: Readonly<Record<FeatureId, Feature>> = {
  "text-animator": { pattern: unionRegex([TEXT_ANIMATOR_CONCEPT, TEXT_ANIMATOR_MORE]), shown: (applied) => appliedWith(applied, ["add_text_animator", "ensure_text_animator"]) },
  "selector-offset": { pattern: /\b(selector|range)[- ]offset\b|\boffset (animation|from|0)\b/gi, shown: (applied) => appliedWith(applied, ["add_text_animator", "update_text_animator", "set_layer_property"], /Percent Offset[^}]*keyframes|keyframes[^}]*Percent Offset|"offset"\s*:\s*\{[^}]*keyframes/) },
  matte: { pattern: unionRegex([MATTE_WORDS, TEXT_MATTE_CONCEPT, TEXT_MATTE_MORE, FILL_LETTERS_CONCEPT, CUT_THROUGH_SHAPE_CONCEPT]), ignore: unionRegex([MATTE_VERB_ON_TEXT, MATTE_FINISH]), shown: (applied) => appliedWith(applied, ["set_track_matte"]) },
  "text-matte": { pattern: unionRegex([/\bmatte\b[^.;]{0,40}\b(over|on|across|onto|inside|through) (the |its )?(word|text|title|letters|type)\b/gi, TEXT_MATTE_CONCEPT, TEXT_MATTE_MORE, FILL_LETTERS_CONCEPT]), shown: (applied) => appliedWith(applied, ["set_track_matte"]) },
  blur: {
    pattern: phraseRegex(BLUR_WORDS),
    ignore: unionRegex([phraseRegex(MOTION_BLUR_WORDS), /\bsoften\p{L}* (?:the |its |that |this )?(?:ease|easing|motion|animation|curve|movement|landing|entrance|transition|timing|pacing|edges? of the (?:ease|motion))\b/giu]),
    shown: (applied) => appliedWith(applied, ["ensure_effect"], /Blur/),
  },
  glow: { pattern: unionRegex([phraseRegex(GLOW_WORDS), LIGHT_AND_SHADOW_LATIN, LIGHT_AND_SHADOW_CJK]), shown: (applied) => appliedWith(applied, ["ensure_effect", "ensure_layer_style"], /Glo2|glow/i) },
  "drop-shadow": { pattern: unionRegex([phraseRegex(DROP_SHADOW_WORDS), LIGHT_AND_SHADOW_CJK]), shown: (applied) => appliedWith(applied, ["ensure_effect", "ensure_layer_style"], /Drop Shadow|dropShadow|drop-shadow/i) },
  ramp: { pattern: unionRegex([RAMP_CONCEPT, GRADIENT_MORE, RAMP_WORD]), shown: (applied) => appliedWith(applied, ["ensure_effect"], /ADBE Ramp/) },
  wiggle: { pattern: unionRegex([phraseRegex(WIGGLE_WORDS), WIGGLE_EVERYDAY]), ignore: WIGGLE_FIXING, shown: (applied) => appliedWith(applied, ["set_expression"], /wiggle\s*\(/) },
  repeater: { pattern: unionRegex([phraseRegex(REPEATER_WORDS), STAMP_PATTERN_CONCEPT]), ignore: REPEATER_LOOPING, shown: (applied) => appliedWith(applied, ["add_shape_item"], /"item":"repeater"/) },
  "trim-paths": { pattern: unionRegex([phraseRegex(["trim path", "trimpath", "trim-path", "stroke draw"]), TRIM_PATH_CONCEPT, TRIM_PATH_MORE, TRIM_PATH_EVERYDAY, DRAW_START_TO_END_CONCEPT]), shown: (applied) => appliedWith(applied, ["add_shape_item"], /"item":"trim-paths"/) },
  camera: { pattern: phraseRegex(CAMERA_WORDS), shown: (applied) => appliedWith(applied, ["create_layer"], /"layerType":"camera"/) },
  "camera-move": {
    pattern: unionRegex([CAMERA_MOVE_CONCEPT, CAMERA_MOVE_MORE]),
    shown: (applied) => appliedWith(applied, ["dolly_camera"]),
  },
  null: { pattern: phraseRegex(NULL_WORDS), shown: (applied) => appliedWith(applied, ["create_layer"], /"layerType":"null"/) },
  parent: { pattern: unionRegex([phraseRegex(PARENT_WORDS), LINK_TO_NULL_CONCEPT, LINK_TO_NULL_MORE, NULL_PRONOUN_LINK_CONCEPT, ATTACH_TO_NULL_CONCEPT, ATTACH_TO_NULL_CJK]), shown: (applied) => appliedWith(applied, ["set_layer_parent"], /"parentLayerId":"[^"]/) },
  orbit: { pattern: unionRegex([ORBIT_CONCEPT, ORBIT_MORE_WORDS, SEND_ROUND_CONCEPT]), ignore: STATIC_RING_ARRANGEMENT, shown: travelsAroundCentre },
  markers: { pattern: phraseRegex(MARKER_WORDS), shown: (applied) => appliedWith(applied, ["add_marker"]) },
  "three-d": { pattern: THREE_D_PATTERN, shown: (applied) => appliedWith(applied, ["set_layer_attribute"], /three-?d/i) },
  "edit-keyframes": { pattern: KEYFRAME_EDIT_PATTERN, shown: (applied) => appliedWith(applied, EDIT_PROOF) },
  tracking: {
    pattern: unionRegex([TRACKING_PATTERN, STEADY_CONCEPT, STEADY_MORE, PIN_TO_MOVING_CONCEPT, STICK_TO_MOVING_CONCEPT, LETTER_SPACING_CONCEPT, LETTER_SPACING_MORE]),
    shown: (applied) => appliedWith(applied, ["start_analysis", "tracker_to_nulls", "create_layer", "set_layer_parent"]) || appliedWith(applied, ["set_text_document"], /"tracking"\s*:/) || appliedWith(applied, ["add_text_animator", "update_text_animator"], /trackingAmount/),
  },
  "duplicate-composition": { pattern: unionRegex([ASPECT_VARIANT_CONCEPT, ASPECT_VARIANT_MORE, DUPLICATE_COMPOSITION_PATTERN]), shown: (applied) => appliedWith(applied, ["duplicate_composition", "create_composition"]) },
  "essential-graphics": { pattern: ESSENTIAL_GRAPHICS_PATTERN, shown: (applied) => appliedWith(applied, ["add_essential_property"]) },
};
