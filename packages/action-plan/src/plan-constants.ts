// The plan's shared constant tables: curve presets, layer styles, the keyframe
// ceiling, and the preset-id pattern. Validators, the host compiler, and the panel
// all read the same table, so a value is stated once here.
import type { CubicBezierCurve } from "./bezier-curve.js";

export const CURVE_PRESETS: Readonly<Record<string, CubicBezierCurve>> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 }, ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }, "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 }, "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 }, "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  "easy-ease": { x1: 0.333333, y1: 0, x2: 0.666667, y2: 1 },
  "in-sine": { x1: 0.12, y1: 0, x2: 0.39, y2: 0 }, "out-sine": { x1: 0.61, y1: 1, x2: 0.88, y2: 1 }, "in-out-sine": { x1: 0.37, y1: 0, x2: 0.63, y2: 1 },
  "in-quad": { x1: 0.11, y1: 0, x2: 0.5, y2: 0 }, "out-quad": { x1: 0.5, y1: 1, x2: 0.89, y2: 1 }, "in-out-quad": { x1: 0.45, y1: 0, x2: 0.55, y2: 1 },
  "in-cubic": { x1: 0.32, y1: 0, x2: 0.67, y2: 0 }, "out-cubic": { x1: 0.33, y1: 1, x2: 0.68, y2: 1 }, "in-out-cubic": { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
  "in-quart": { x1: 0.5, y1: 0, x2: 0.75, y2: 0 }, "out-quart": { x1: 0.25, y1: 1, x2: 0.5, y2: 1 }, "in-out-quart": { x1: 0.76, y1: 0, x2: 0.24, y2: 1 },
  "in-quint": { x1: 0.64, y1: 0, x2: 0.78, y2: 0 }, "out-quint": { x1: 0.22, y1: 1, x2: 0.36, y2: 1 }, "in-out-quint": { x1: 0.83, y1: 0, x2: 0.17, y2: 1 },
  "in-expo": { x1: 0.7, y1: 0, x2: 0.84, y2: 0 }, "out-expo": { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }, "in-out-expo": { x1: 0.87, y1: 0, x2: 0.13, y2: 1 },
  "in-circ": { x1: 0.55, y1: 0, x2: 1, y2: 0.45 }, "out-circ": { x1: 0, y1: 0.55, x2: 0.45, y2: 1 }, "in-out-circ": { x1: 0.85, y1: 0, x2: 0.15, y2: 1 },
  "in-back": { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 }, "out-back": { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }, "in-out-back": { x1: 0.68, y1: -0.6, x2: 0.32, y2: 1.6 },
};
export const MAX_KEYFRAMES_PER_ANIMATION = 1024;
export const PRESET_ID_PATTERN = /^preset:(ae-presets|user-presets):[0-9a-f]{20}$/;
/** Layer Styles need the Layer > Layer Styles menu command (addProperty/enabled=true do not work on AE 26.2.1); Pattern Overlay has no menu command and is not offered. */
export const LAYER_STYLES = {
  "drop-shadow": { matchName: "dropShadow/enabled", menu: "Drop Shadow", commandId: 9000 },
  "inner-shadow": { matchName: "innerShadow/enabled", menu: "Inner Shadow", commandId: 9001 },
  "outer-glow": { matchName: "outerGlow/enabled", menu: "Outer Glow", commandId: 9002 },
  "inner-glow": { matchName: "innerGlow/enabled", menu: "Inner Glow", commandId: 9003 },
  "bevel-emboss": { matchName: "bevelEmboss/enabled", menu: "Bevel and Emboss", commandId: 9004 },
  "satin": { matchName: "chromeFX/enabled", menu: "Satin", commandId: 9005 },
  "color-overlay": { matchName: "solidFill/enabled", menu: "Color Overlay", commandId: 9006 },
  "gradient-overlay": { matchName: "gradientFill/enabled", menu: "Gradient Overlay", commandId: 9007 },
  "stroke": { matchName: "frameFX/enabled", menu: "Stroke", commandId: 9008 },
} as const;
export const LAYER_STYLE_GROUP = "ADBE Layer Styles";
/** Snapshot path of a style group; matchNames containing "/" are escaped as %2F. */
export function layerStylePath(style: keyof typeof LAYER_STYLES): string { return `${LAYER_STYLE_GROUP}/${LAYER_STYLES[style].matchName.replace(/%/g, "%25").replace(/\//g, "%2F")}`; }
export const LAYER_STYLE_MAX_VALUES = 16;

/** The longest expression a plan may carry: rigs written by hand run to tens of thousands of characters, and a host request (16 MiB) carries many of these. */
export const MAX_EXPRESSION_LENGTH = 65_536;

/** The Source Text property of a text layer. After Effects creates it with the layer itself, so an earlier text create_layer materialises it; only set_expression takes this ground, because a keyframe would need a TextDocument value the keyframe contract does not carry. */
export const TEXT_DOCUMENT_PATH = "ADBE Text Properties/ADBE Text Document";
export const TEXT_JUSTIFICATIONS = ["LEFT_JUSTIFY", "CENTER_JUSTIFY", "RIGHT_JUSTIFY", "FULL_JUSTIFY_LASTLINE_LEFT", "FULL_JUSTIFY_LASTLINE_RIGHT", "FULL_JUSTIFY_LASTLINE_CENTER", "FULL_JUSTIFY_LASTLINE_FULL"] as const;
export const FOOTAGE_ALPHA_MODES = ["ignore", "straight", "premultiplied"] as const;
export const FOOTAGE_PULLDOWN_PHASES = ["off", "WSSWW", "SSWWW", "SWWWS", "WWWSS", "WWSSW"] as const;
export const FOOTAGE_PULLDOWN_METHODS = ["pulldown-3-2", "advance-24p"] as const;
export const FOOTAGE_FIELD_SEPARATIONS = ["off", "upper-field-first", "lower-field-first"] as const;
export const SCENE_EDIT_MODES = ["markers", "split", "split-precomp"] as const;
export const ALLOWED_BLEND_MODES = ["NORMAL", "MULTIPLY", "SCREEN", "OVERLAY", "LIGHTEN", "DARKEN", "DIFFERENCE", "ADD"] as const;
