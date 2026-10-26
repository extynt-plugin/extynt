// The curated After Effects capabilities: the effects and native property families that ship with After Effects, as declared data.
import type { LayerType } from "@extynt/project-graph";

import type { CuratedEffectRow } from "./effects/types.js";
import { PRESET_CONTROL_EFFECTS, PRESET_CONTROL_REQUIREMENT } from "./effects/preset-controls.js";
import { COLOR_CHANNEL_UTILITY_EFFECTS } from "./effects/color-channel-utility.js";
import { BLUR_DISTORT_PERSPECTIVE_EFFECTS } from "./effects/blur-distort-perspective.js";
import { GENERATE_STYLIZE_TRANSITION_EFFECTS } from "./effects/generate-stylize-transition.js";
import { KEYING_MATTE_NOISE_TIME_EFFECTS } from "./effects/keying-matte-noise-time.js";
import { AUDIO_IMMERSIVE_SIMULATION_EFFECTS } from "./effects/audio-immersive-simulation.js";
import { OBSOLETE_EFFECTS } from "./effects/obsolete.js";
import { sha256Hex, stableJson } from "./canonical.js";
import { CATALOGUE_SCHEMA } from "./catalogue-model.js";
import type { Capability, CatalogueGraph, ControlSchema, NativeFamily, SemanticControlRole } from "./catalogue-model.js";

interface AdobeSpec { displayName: string; matchName: string; controls?: ControlSchema[]; description: string; id?: string; options?: CapabilityOptions }

interface NativeCapabilitySpec { id: string; displayName: string; family: NativeFamily; matchName: string; controls: ControlSchema[]; description: string; layerTypes?: LayerType[]; semanticRoles?: SemanticControlRole[] }

interface EffectCapabilitySpec { id: string; displayName: string; matchName: string; category: string; description: string; semanticRoles?: SemanticControlRole[]; controls?: ControlSchema[] }

type CapabilityOptions = Pick<Capability, "category" | "compatibility" | "layerTypes" | "nativeFamily" | "semanticRoles" | "requirements">;

const transformControls: ControlSchema[] = [
  { path: "ADBE Transform Group/ADBE Anchor Point", matchName: "ADBE Anchor Point", displayName: "Anchor Point", valueType: "vector", dimensions: 2, canSetValue: true, role: "transform.anchor-point" },
  { path: "ADBE Transform Group/ADBE Position", matchName: "ADBE Position", displayName: "Position", valueType: "vector", dimensions: 2, canSetValue: true, role: "transform.position" },
  { path: "ADBE Transform Group/ADBE Scale", matchName: "ADBE Scale", displayName: "Scale", valueType: "vector", dimensions: 2, canSetValue: true, role: "transform.scale" },
  { path: "ADBE Transform Group/ADBE Rotate Z", matchName: "ADBE Rotate Z", displayName: "Rotation", valueType: "number", canSetValue: true, role: "transform.rotation" },
  { path: "ADBE Transform Group/ADBE Opacity", matchName: "ADBE Opacity", displayName: "Opacity", valueType: "number", canSetValue: true, role: "transform.opacity" },
];

const textControls: ControlSchema[] = [
  { path: "ADBE Text Properties/ADBE Text Document", matchName: "ADBE Text Document", displayName: "Source Text", valueType: "string", canSetValue: true, role: "text.source" },
  { path: "ADBE Text Properties/ADBE Text Path Options", matchName: "ADBE Text Path Options", displayName: "Path Options", valueType: "unknown", canSetValue: false },
  { path: "ADBE Text Properties/ADBE Text Animators", matchName: "ADBE Text Animators", displayName: "Animators", valueType: "unknown", canSetValue: false },
];

const maskControls: ControlSchema[] = [
  { path: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape", matchName: "ADBE Mask Shape", displayName: "Mask Path", valueType: "string", canSetValue: true, role: "mask.shape" },
  { path: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Opacity", matchName: "ADBE Mask Opacity", displayName: "Mask Opacity", valueType: "number", canSetValue: true, role: "mask.opacity" },
  { path: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Feather", matchName: "ADBE Mask Feather", displayName: "Mask Feather", valueType: "vector", canSetValue: true, role: "mask.feather" },
  { path: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Offset", matchName: "ADBE Mask Offset", displayName: "Mask Expansion", valueType: "number", canSetValue: true, role: "mask.expansion" },
];

const shapeControls: ControlSchema[] = [
  { path: "ADBE Root Vectors Group/ADBE Vector Shape - Group/ADBE Vector Shape", matchName: "ADBE Vector Shape", displayName: "Path", valueType: "string", canSetValue: true, role: "shape.path" },
  { path: "ADBE Root Vectors Group/ADBE Vector Graphic - Fill/ADBE Vector Fill Color", matchName: "ADBE Vector Fill Color", displayName: "Fill Color", valueType: "color", dimensions: 4, canSetValue: true, role: "shape.fill-color" },
  { path: "ADBE Root Vectors Group/ADBE Vector Graphic - Stroke/ADBE Vector Stroke Color", matchName: "ADBE Vector Stroke Color", displayName: "Stroke Color", valueType: "color", dimensions: 4, canSetValue: true, role: "shape.stroke-color" },
  { path: "ADBE Root Vectors Group/ADBE Vector Graphic - Stroke/ADBE Vector Stroke Width", matchName: "ADBE Vector Stroke Width", displayName: "Stroke Width", valueType: "number", canSetValue: true, role: "shape.stroke-width" },
];

const adobe = ({ displayName, matchName, controls = [], description, id = `ae:${matchName}`, options = {} }: AdobeSpec): Capability => ({ id, version: "1.0.0", kind: "effect", matchName, displayName, provider: "Adobe", description, controls, ...options, evidence: [{ kind: "documented", source: "catalogue", reference: "curated-2026-09-11", note: "Curated native matchName; installation and controls still require host evidence." }] });

const native = ({ id, displayName, family, matchName, controls, description, layerTypes = [], semanticRoles = [] }: NativeCapabilitySpec): Capability => adobe({ displayName, matchName, controls, description, id, options: { category: family, nativeFamily: family, layerTypes, semanticRoles, compatibility: { minVersion: "17.0" } } });

const effect = ({ id, displayName, matchName, category, description, semanticRoles = [], controls = [] }: EffectCapabilitySpec): Capability => adobe({ displayName, matchName, controls, description, id, options: { category, semanticRoles, compatibility: { minVersion: "17.0" } } });

/** Every other effect that ships with After Effects, as [id, display name, match name, category, description] rows. */
export const CURATED_EFFECT_ROWS: readonly CuratedEffectRow[] = [...COLOR_CHANNEL_UTILITY_EFFECTS, ...BLUR_DISTORT_PERSPECTIVE_EFFECTS, ...GENERATE_STYLIZE_TRANSITION_EFFECTS, ...KEYING_MATTE_NOISE_TIME_EFFECTS, ...AUDIO_IMMERSIVE_SIMULATION_EFFECTS, ...PRESET_CONTROL_EFFECTS, ...OBSOLETE_EFFECTS];

const curatedRow = ([id, displayName, matchName, category, description]: CuratedEffectRow): Capability => adobe({ displayName, matchName, controls: [], description, id, options: { category, compatibility: { minVersion: "17.0" }, ...(category === "preset-controls" ? { requirements: [PRESET_CONTROL_REQUIREMENT] } : {}) } });

/** The curated catalogue: Gaussian Blur, the native property families and every After Effects effect the product knows by match name. */
export const BASE_CATALOGUE: CatalogueGraph = {
  schemaVersion: CATALOGUE_SCHEMA, catalogueVersion: "2026.09.11", enumeration: { effect: "partially-observable", preset: "unknown", command: "unknown", importer: "unknown", codec: "unknown", renderer: "unknown", panel: "unknown", script: "unknown", utility: "unknown" },
  capabilities: [
    effect({ id: "adobe.gaussian-blur", displayName: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", category: "blur", description: "Softens an image with a bounded blur radius.", semanticRoles: ["blur.amount", "blur.repeat-edges"], controls: [
      { path: "ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001", matchName: "ADBE Gaussian Blur 2-0001", displayName: "Blurriness", valueType: "number", canSetValue: true, role: "blur.amount" },
      { path: "ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0003", matchName: "ADBE Gaussian Blur 2-0003", displayName: "Repeat Edge Pixels", valueType: "boolean", canSetValue: true, role: "blur.repeat-edges" },
    ] }),
    effect({ id: "adobe.fill", displayName: "Fill", matchName: "ADBE Fill", category: "color-correction", description: "Fills pixels with a chosen color.", semanticRoles: [], controls: [{ path: "ADBE Fill/ADBE Fill-0002", matchName: "ADBE Fill-0002", displayName: "Color", valueType: "color", dimensions: 4, canSetValue: true }] }),
    effect({ id: "adobe.tint", displayName: "Tint", matchName: "ADBE Tint", category: "color-correction", description: "Maps luminance to two colors.", semanticRoles: ["color.tint"] }),
    effect({ id: "adobe.levels", displayName: "Levels", matchName: "ADBE Easy Levels2", category: "color-correction", description: "Adjusts tonal input and output ranges.", semanticRoles: ["color.levels"] }),
    effect({ id: "adobe.glow", displayName: "Glow", matchName: "ADBE Glo2", category: "glow", description: "Adds a luminance-based glow.", semanticRoles: ["glow.threshold", "glow.radius", "glow.intensity"] }),
    effect({ id: "adobe.drop-shadow", displayName: "Drop Shadow", matchName: "ADBE Drop Shadow", category: "stylize", description: "Adds a configurable shadow.", semanticRoles: ["stylize.amount"] }),
    native({ id: "adobe.transform", displayName: "Transform", family: "transform", matchName: "ADBE Transform Group", controls: transformControls, description: "Controls layer transform properties.", layerTypes: ["av", "text", "shape", "camera", "light", "null", "adjustment", "unknown"], semanticRoles: ["transform.anchor-point", "transform.position", "transform.scale", "transform.rotation", "transform.opacity"] }),
    native({ id: "adobe.text", displayName: "Text", family: "text", matchName: "ADBE Text Properties", controls: textControls, description: "Text document, path, and animator properties on a text layer.", layerTypes: ["text"], semanticRoles: ["text.source", "text.font-size", "text.fill-color"] }),
    native({ id: "adobe.masks", displayName: "Masks", family: "masks", matchName: "ADBE Mask Parade", controls: maskControls, description: "Mask paths and mask compositing properties.", layerTypes: ["av", "text", "shape", "null", "adjustment", "unknown"], semanticRoles: ["mask.shape", "mask.opacity", "mask.feather", "mask.expansion"] }),
    native({ id: "adobe.shape", displayName: "Shape", family: "shape", matchName: "ADBE Root Vectors Group", controls: shapeControls, description: "Shape-layer vector contents and graphics.", layerTypes: ["shape"], semanticRoles: ["shape.path", "shape.fill-color", "shape.stroke-color", "shape.stroke-width"] }),
    native({ id: "adobe.footage", displayName: "Footage", family: "footage", matchName: "ADBE AV Layer", controls: [], description: "Audio-visual layers backed by a footage or precomposition source.", layerTypes: ["av"], semanticRoles: ["footage.source"] }),
    native({ id: "adobe.camera", displayName: "Camera", family: "camera", matchName: "ADBE Camera Layer", controls: [
      { path: "ADBE Camera Options Group/ADBE Camera Zoom", matchName: "ADBE Camera Zoom", displayName: "Zoom", valueType: "number", canSetValue: true, role: "camera.zoom" },
      { path: "ADBE Camera Options Group/ADBE Camera Focus Distance", matchName: "ADBE Camera Focus Distance", displayName: "Focus Distance", valueType: "number", canSetValue: true, role: "camera.focus-distance" },
      { path: "ADBE Camera Options Group/ADBE Camera Depth of Field", matchName: "ADBE Camera Depth of Field", displayName: "Depth of Field", valueType: "boolean", canSetValue: true, role: "camera.depth-of-field" },
    ], description: "Camera layer and camera-options properties.", layerTypes: ["camera"], semanticRoles: ["camera.zoom", "camera.focus-distance", "camera.depth-of-field"] }),
    native({ id: "adobe.light", displayName: "Light", family: "light", matchName: "ADBE Light Layer", controls: [
      { path: "ADBE Light Options Group/ADBE Light Intensity", matchName: "ADBE Light Intensity", displayName: "Intensity", valueType: "number", canSetValue: true, role: "light.intensity" },
      { path: "ADBE Light Options Group/ADBE Light Color", matchName: "ADBE Light Color", displayName: "Color", valueType: "color", dimensions: 4, canSetValue: true, role: "light.color" },
      { path: "ADBE Light Options Group/ADBE Light Cone Angle", matchName: "ADBE Light Cone Angle", displayName: "Cone Angle", valueType: "number", canSetValue: true, role: "light.cone-angle" },
    ], description: "Light layer and light-options properties.", layerTypes: ["light"], semanticRoles: ["light.intensity", "light.color", "light.cone-angle"] }),
    native({ id: "adobe.audio", displayName: "Audio", family: "audio", matchName: "ADBE Audio Levels", controls: [{ path: "ADBE Audio Levels", matchName: "ADBE Audio Levels", displayName: "Audio Levels", valueType: "vector", dimensions: 2, canSetValue: true, role: "audio.level" }], description: "Layer audio enablement and level controls.", layerTypes: ["av", "text", "shape", "null", "adjustment", "unknown"], semanticRoles: ["audio.level"] }),
    effect({ id: "adobe.slider-control", displayName: "Slider Control", matchName: "ADBE Slider Control", category: "expression-controls", description: "Adds a numeric control property.", semanticRoles: [], controls: [{ path: "ADBE Slider Control/ADBE Slider Control-0001", matchName: "ADBE Slider Control-0001", displayName: "Slider", valueType: "number", canSetValue: true }] }),
    effect({ id: "adobe.color-control", displayName: "Color Control", matchName: "ADBE Color Control", category: "expression-controls", description: "Adds a color control property." }),
    effect({ id: "adobe.checkbox-control", displayName: "Checkbox Control", matchName: "ADBE Checkbox Control", category: "expression-controls", description: "Adds a boolean control property." }),
    effect({ id: "adobe.brightness-contrast", displayName: "Brightness & Contrast", matchName: "ADBE Brightness & Contrast 2", category: "color-correction", description: "Adjusts global brightness and contrast." }),
    effect({ id: "adobe.curves", displayName: "Curves", matchName: "ADBE CurvesCustom", category: "color-correction", description: "Remaps tonal response with editable curves.", semanticRoles: ["color.curves"] }),
    effect({ id: "adobe.hue-saturation", displayName: "Hue/Saturation", matchName: "ADBE HUE SATURATION", category: "color-correction", description: "Adjusts hue, saturation, and lightness by color channel.", semanticRoles: ["color.hue-saturation"] }),
    effect({ id: "adobe.exposure", displayName: "Exposure", matchName: "ADBE Exposure2", category: "color-correction", description: "Adjusts exposure, offset, and gamma.", semanticRoles: ["color.exposure"] }),
    effect({ id: "adobe.channel-mixer", displayName: "Channel Mixer", matchName: "ADBE CHANNEL MIXER", category: "color-correction", description: "Mixes source color channels into output channels." }),
    effect({ id: "adobe.invert", displayName: "Invert", matchName: "ADBE Invert", category: "color-correction", description: "Inverts channel luminance or color." }),
    effect({ id: "adobe.sharpen", displayName: "Sharpen", matchName: "ADBE Sharpen", category: "sharpen", description: "Enhances local edge contrast.", semanticRoles: ["sharpen.amount"], controls: [{ path: "ADBE Sharpen/ADBE Sharpen-0001", matchName: "ADBE Sharpen-0001", displayName: "Sharpen Amount", valueType: "number", canSetValue: true, role: "sharpen.amount" }] }),
    effect({ id: "adobe.noise", displayName: "Noise", matchName: "ADBE Noise", category: "noise", description: "Adds bounded monochromatic or color noise.", semanticRoles: ["noise.amount"], controls: [{ path: "ADBE Noise/ADBE Noise-0001", matchName: "ADBE Noise-0001", displayName: "Amount of Noise", valueType: "number", canSetValue: true, role: "noise.amount" }] }),
    effect({ id: "adobe.add-grain", displayName: "Add Grain", matchName: "VISINF Grain Implant", category: "noise", description: "Adds film-like grain and preserves a previewable result." }),
    effect({ id: "adobe.turbulent-displace", displayName: "Turbulent Displace", matchName: "ADBE Turbulent Displace", category: "distort", description: "Displaces pixels with procedural turbulence.", semanticRoles: ["distort.amount"] }),
    effect({ id: "adobe.displacement-map", displayName: "Displacement Map", matchName: "ADBE Displacement Map", category: "distort", description: "Displaces pixels using another layer.", semanticRoles: ["distort.amount"] }),
    effect({ id: "adobe.wave-warp", displayName: "Wave Warp", matchName: "ADBE Wave Warp", category: "distort", description: "Bends pixels with a repeating wave.", semanticRoles: ["distort.amount"] }),
    effect({ id: "adobe.corner-pin", displayName: "Corner Pin", matchName: "ADBE Corner Pin", category: "distort", description: "Maps a layer to four tracked corners." }),
    effect({ id: "adobe.optics-compensation", displayName: "Optics Compensation", matchName: "ADBE Optics Compensation", category: "distort", description: "Corrects or exaggerates lens distortion." }),
    effect({ id: "adobe.mosaic", displayName: "Mosaic", matchName: "ADBE Mosaic", category: "stylize", description: "Reduces an image to colored blocks.", semanticRoles: ["stylize.amount"] }),
    effect({ id: "adobe.posterize", displayName: "Posterize", matchName: "ADBE Posterize", category: "stylize", description: "Reduces tonal levels.", semanticRoles: ["stylize.amount"] }),
    effect({ id: "adobe.find-edges", displayName: "Find Edges", matchName: "ADBE Find Edges", category: "stylize", description: "Detects and stylizes image edges.", semanticRoles: ["stylize.amount"] }),
    effect({ id: "adobe.echo", displayName: "Echo", matchName: "ADBE Echo", category: "stylize", description: "Combines time-offset copies of a layer." }),
    effect({ id: "adobe.keylight", displayName: "Keylight", matchName: "Keylight 906", category: "keying", description: "Keys a color from a layer with spill-aware controls.", semanticRoles: ["keying.amount"] }),
    effect({ id: "adobe.key-cleaner", displayName: "Key Cleaner", matchName: "ADBE KeyCleaner", category: "keying", description: "Refines an existing key matte.", semanticRoles: ["keying.amount"] }),
    effect({ id: "adobe.spill-suppressor", displayName: "Spill Suppressor", matchName: "ADBE Spill Suppressor", category: "keying", description: "Suppresses key-color spill." }),
    effect({ id: "adobe.extract", displayName: "Extract", matchName: "ADBE Extract", category: "keying", description: "Extracts a matte from luminance or color ranges.", semanticRoles: ["keying.amount"] }),
    effect({ id: "adobe.luma-key", displayName: "Luma Key", matchName: "ADBE Luma Key", category: "keying", description: "Keys pixels by luminance." }),
    effect({ id: "adobe.difference-matte", displayName: "Difference Matte", matchName: "ADBE Difference Matte2", category: "keying", description: "Creates a matte from a comparison layer." }),
    effect({ id: "adobe.linear-wipe", displayName: "Linear Wipe", matchName: "ADBE Linear Wipe", category: "transitions", description: "Reveals or conceals a layer along a line.", semanticRoles: ["transition.amount"], controls: [{ path: "ADBE Linear Wipe/ADBE Linear Wipe-0001", matchName: "ADBE Linear Wipe-0001", displayName: "Transition Completion", valueType: "number", canSetValue: true, role: "transition.amount" }] }),
    effect({ id: "adobe.radial-wipe", displayName: "Radial Wipe", matchName: "ADBE Radial Wipe", category: "transitions", description: "Reveals or conceals a layer around a center point.", semanticRoles: ["transition.amount"] }),
    effect({ id: "adobe.venetian-blinds", displayName: "Venetian Blinds", matchName: "ADBE Venetian Blinds", category: "transitions", description: "Reveals a layer through repeating slats.", semanticRoles: ["transition.amount"] }),
    effect({ id: "adobe.block-dissolve", displayName: "Block Dissolve", matchName: "ADBE Block Dissolve", category: "transitions", description: "Dissolves a layer through randomized blocks.", semanticRoles: ["transition.amount"] }),
    effect({ id: "adobe.gradient-ramp", displayName: "Gradient Ramp", matchName: "ADBE Ramp", category: "generate", description: "Fills a layer with a linear or radial two-color gradient; pair it with a track matte to give a shape or text layer a gradient fill with scriptable colors.", semanticRoles: ["gradient.start-point", "gradient.start-color", "gradient.end-point", "gradient.end-color", "gradient.shape"], controls: [
      { path: "ADBE Ramp/ADBE Ramp-0001", matchName: "ADBE Ramp-0001", displayName: "Start of Ramp", valueType: "vector", dimensions: 2, canSetValue: true, role: "gradient.start-point" },
      { path: "ADBE Ramp/ADBE Ramp-0002", matchName: "ADBE Ramp-0002", displayName: "Start Color", valueType: "color", dimensions: 4, canSetValue: true, role: "gradient.start-color" },
      { path: "ADBE Ramp/ADBE Ramp-0003", matchName: "ADBE Ramp-0003", displayName: "End of Ramp", valueType: "vector", dimensions: 2, canSetValue: true, role: "gradient.end-point" },
      { path: "ADBE Ramp/ADBE Ramp-0004", matchName: "ADBE Ramp-0004", displayName: "End Color", valueType: "color", dimensions: 4, canSetValue: true, role: "gradient.end-color" },
      { path: "ADBE Ramp/ADBE Ramp-0005", matchName: "ADBE Ramp-0005", displayName: "Ramp Shape", valueType: "enum", menu: ["Linear Ramp", "Radial Ramp"], canSetValue: true, role: "gradient.shape" },
    ] }),
    effect({ id: "adobe.four-color-gradient", displayName: "4-Color Gradient", matchName: "ADBE 4ColorGradient", category: "generate", description: "Fills a layer with a smooth blend of four positioned colors; pair it with a track matte for a multi-color fill.", semanticRoles: [], controls: [
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0001", matchName: "ADBE 4ColorGradient-0001", displayName: "Point 1", valueType: "vector", dimensions: 2, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0002", matchName: "ADBE 4ColorGradient-0002", displayName: "Color 1", valueType: "color", dimensions: 4, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0003", matchName: "ADBE 4ColorGradient-0003", displayName: "Point 2", valueType: "vector", dimensions: 2, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0004", matchName: "ADBE 4ColorGradient-0004", displayName: "Color 2", valueType: "color", dimensions: 4, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0005", matchName: "ADBE 4ColorGradient-0005", displayName: "Point 3", valueType: "vector", dimensions: 2, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0006", matchName: "ADBE 4ColorGradient-0006", displayName: "Color 3", valueType: "color", dimensions: 4, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0007", matchName: "ADBE 4ColorGradient-0007", displayName: "Point 4", valueType: "vector", dimensions: 2, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0008", matchName: "ADBE 4ColorGradient-0008", displayName: "Color 4", valueType: "color", dimensions: 4, canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0009", matchName: "ADBE 4ColorGradient-0009", displayName: "Blend", valueType: "number", canSetValue: true },
      { path: "ADBE 4ColorGradient/ADBE 4ColorGradient-0010", matchName: "ADBE 4ColorGradient-0010", displayName: "Jitter", valueType: "number", canSetValue: true },
    ] }),
    effect({ id: "adobe.gradient-wipe", displayName: "Gradient Wipe", matchName: "ADBE Gradient Wipe", category: "transitions", description: "Uses a gradient layer to control a reveal.", semanticRoles: ["transition.amount"] }),
    effect({ id: "adobe.cc-star-burst", displayName: "CC Star Burst", matchName: "CC Star Burst", category: "simulation", description: "Scatters bright bursts of particles outward from a center point; a common bounded stand-in for a 'sparkle' or 'particles' request." }),
    effect({ id: "adobe.cc-light-sweep", displayName: "CC Light Sweep", matchName: "CC Light Sweep", category: "generate", description: "Sweeps a directional band of light across a layer; a common 'shine' or 'premium reveal' request on logos and titles." }),
    effect({ id: "adobe.cc-vignette", displayName: "CC Vignette", matchName: "CS Vignette", category: "stylize", description: "Darkens or lightens the edges of a layer to draw focus toward the center." }),
    ...CURATED_EFFECT_ROWS.map(curatedRow),
  ]
};

/** A hash of what the curated entries say, so adding or editing an entry invalidates cached host profiles even when the catalogue version is unchanged. */
export const CATALOGUE_CONTENT_FINGERPRINT = sha256Hex(stableJson(BASE_CATALOGUE.capabilities.map((capability) => [capability.id, capability.matchName ?? null, capability.description ?? null, capability.requirements ?? null])));
