// The verdicts for operations that write named property rows of a layer: camera and light options, material options, audio, layer styles and effect controls.
import type { JsonObject } from "@extynt/decode";
import { sameControlValue } from "./compare-values.js";
import type { Reading } from "./compare-values.js";
import { objectOf } from "./json-fields.js";
import { missingPropertyVerdict } from "./property-presence.js";
import { firstFault, optionSlots } from "./slot-checks.js";
import type { Slot, SlotFinding } from "./slot-checks.js";
import { layerWhere, propertyOf } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";

const OPTION_ROWS = {
  set_camera_options: {
    prefix: "ADBE Camera Options Group/",
    paths: { zoom: "ADBE Camera Zoom", depthOfField: "ADBE Camera Depth of Field", focusDistance: "ADBE Camera Focus Distance", aperture: "ADBE Camera Aperture", blurLevel: "ADBE Camera Blur Level" },
  },
  set_light_options: {
    prefix: "ADBE Light Options Group/",
    paths: {
      intensity: "ADBE Light Intensity",
      color: "ADBE Light Color",
      coneAngle: "ADBE Light Cone Angle",
      coneFeather: "ADBE Light Cone Feather 2",
      falloffType: "ADBE Light Falloff Type",
      falloffStart: "ADBE Light Falloff Start",
      falloffDistance: "ADBE Light Falloff Distance",
      castsShadows: "ADBE Casts Shadows",
      shadowDarkness: "ADBE Light Shadow Darkness",
      shadowDiffusion: "ADBE Light Shadow Diffusion",
    },
  },
  set_material_options: {
    prefix: "ADBE Material Options Group/",
    paths: {
      acceptsShadows: "ADBE Accepts Shadows",
      castsShadows: "ADBE Casts Shadows",
      lightTransmission: "ADBE Light Transmission",
      diffuse: "ADBE Diffuse Coefficient",
      specularIntensity: "ADBE Specular Coefficient",
      specularShininess: "ADBE Shininess Coefficient",
      metal: "ADBE Metal Coefficient",
    },
  },
} as const satisfies Readonly<Record<string, { readonly prefix: string; readonly paths: Readonly<Record<string, string>> }>>;

const AUDIO_LEVEL_PATH = "ADBE Audio Group/ADBE Audio Levels";
const STYLE_ROOT = "ADBE Layer Styles/";
const EXPRESSION_OWNS_VALUE = "an enabled expression owns this control's visible value, so the read-back is the expression's output and says nothing about the static value written; the write is not disproved, and the expression itself is verified by its own row";

function escapedSegment(text: string): string {
  return text.replace(/%/g, "%25").replace(/\//g, "%2F");
}

function truncatedBasis(state: LayerState, whole: string): string {
  return state.layer.propertyPathsTruncated === true ? whole.replace("-not-in-", "-not-in-truncated-") : whole;
}

function observedDetail(finding: SlotFinding): Reading {
  return finding.observed ?? null;
}

/** The verdict for set_camera_options and set_light_options: each option's row holds the requested value. */
export function verifyThreeDOptions(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const rows = kind === "set_camera_options" ? OPTION_ROWS.set_camera_options : OPTION_ROWS.set_light_options;
  const finding = firstFault(state.layer, optionSlots(state.request.options, rows, "option"));
  const where = layerWhere(state);
  return finding ? failedStep(kind, "three-d-option-mismatch", { ...where, option: finding.slot.key }) : exactStep(kind, "three-d-options", where);
}

/** The verdict for set_material_options: each option's row holds the requested value, or the row is not in the read. */
export function verifyMaterialOptions(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const slots = optionSlots(state.request.options, OPTION_ROWS.set_material_options, "option");
  const finding = firstFault(state.layer, slots);
  const where = layerWhere(state);
  if (finding?.fault === "missing") return unverifiedStep(kind, truncatedBasis(state, "material-path-not-in-snapshot"), { ...where, propertyPath: finding.slot.path });
  if (finding) return failedStep(kind, "material-option-mismatch", { ...where, propertyPath: finding.slot.path, observedValue: observedDetail(finding) });
  return slots.length > 0 ? exactStep(kind, "material-options", where) : unverifiedStep(kind, "no-material-options-to-check", where);
}

/** The verdict for set_audio: the layer's audio switch and its level row. */
export function verifyAudio(state: LayerState): VerifiedStep {
  const { request, layer } = state;
  const kind = request.operation;
  const where = layerWhere(state);
  if (request.enabled !== undefined) {
    if (typeof layer.audioEnabled !== "boolean") return unverifiedStep(kind, "audio-enabled-not-in-snapshot", where);
    if (layer.audioEnabled !== request.enabled) return failedStep(kind, "audio-enabled-mismatch", where);
  }
  if (request.levelDb === undefined) return exactStep(kind, "audio-enabled-and-level", where);
  const finding = firstFault(layer, [{ key: "levelDb", path: AUDIO_LEVEL_PATH, expected: request.levelDb, compare: "control" }]);
  if (finding?.fault === "missing") return unverifiedStep(kind, truncatedBasis(state, "audio-level-not-in-snapshot"), where);
  return finding ? failedStep(kind, "audio-level-mismatch", { ...where, observedValue: observedDetail(finding) }) : exactStep(kind, "audio-enabled-and-level", where);
}

function styleSlots(stylePath: string, values: JsonObject, hostValues: JsonObject): ReadonlyArray<Slot> {
  return Object.entries(values).map(([key, expected]) => ({ key, path: `${stylePath}/${escapedSegment(key)}`, expected, compare: "control", fallback: hostValues[key], unreadWhenNull: true }));
}

function styleValueVerdict(state: LayerState, finding: SlotFinding): VerifiedStep {
  const where = { ...layerWhere(state), style: state.request.style, setting: finding.slot.key };
  const kind = state.request.operation;
  return finding.fault === "mismatch" ? failedStep(kind, "layer-style-value-mismatch", { ...where, observedValue: observedDetail(finding) }) : unverifiedStep(kind, "layer-style-value-not-in-snapshot", where);
}

function styleStateFault(state: LayerState, stylePath: string): VerifiedStep | null {
  const { request, step, layer } = state;
  const row = propertyOf(layer, stylePath);
  const enabled = typeof row?.enabled === "boolean" ? row.enabled : step.enabled;
  const where = { ...layerWhere(state), style: request.style };
  if (enabled === undefined) return unverifiedStep(request.operation, "layer-style-state-not-in-snapshot", { ...where, hostEnabled: null });
  return enabled === request.enabled ? null : failedStep(request.operation, "layer-style-enabled-mismatch", { ...where, observedEnabled: enabled });
}

/** The verdict for ensure_layer_style: the style's enabled state, then each requested value, from the snapshot row or else the host's own read. */
export function verifyLayerStyle(state: LayerState): VerifiedStep {
  const { request, step, layer } = state;
  const kind = request.operation;
  const stylePath = STYLE_ROOT + escapedSegment(request.styleMatchName ?? "");
  const fault = styleStateFault(state, stylePath);
  if (fault) return fault;
  const where = { ...layerWhere(state), style: request.style };
  const slots = styleSlots(stylePath, request.values ?? {}, objectOf(step.row.values) ?? {});
  const finding = firstFault(layer, slots);
  if (finding) return styleValueVerdict(state, finding);
  return exactStep(kind, slots.length > 0 ? "layer-style-enabled-and-values" : "layer-style-enabled", where);
}

/** The verdict for set_effect_control: the control's row holds the requested value, or an expression owns it. */
export function verifyEffectControl(state: LayerState): VerifiedStep {
  const { request, layer } = state;
  const kind = request.operation;
  const control = propertyOf(layer, request.propertyPath);
  if (!control) return missingPropertyVerdict(state, request.propertyPath, "a later remove_effect in this plan removed this effect");
  const where = { ...layerWhere(state), propertyPath: request.propertyPath };
  if (sameControlValue(control.value, request.value)) return exactStep(kind, "effect-control-value", where);
  if (control.expressionEnabled === true) return unverifiedStep(kind, "effect-control-under-expression", { ...where, expressionEnabled: true, observedValue: control.value, reason: EXPRESSION_OWNS_VALUE });
  return failedStep(kind, "effect-control-value-mismatch", { ...where, observedValue: control.value });
}
