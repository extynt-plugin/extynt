// Camera, light and material option operation kinds: a typed object of bounded options on an exact layer.
import type { JsonObject } from "@extynt/decode";
import { validColor } from "./geometry-rules.js";
import { isJsonObject } from "./json-shape.js";
import { familyLayerTarget, type LayerFamilyTarget } from "./layer-family-target.js";
import type { OperationContext } from "./layer-targets.js";
import { ACCEPTED, invalid, isOptionalBoolean, isOptionalFiniteInRange, isRefusal, type OperationResult } from "./validation-primitives.js";

type NumberOption = { readonly key: string; readonly min: number; readonly max: number };
type ThreeDOptionRule = { readonly allowed: readonly string[]; readonly numbers: readonly NumberOption[]; readonly booleans: readonly string[]; readonly colors: readonly string[]; readonly message: string };

const THREE_D_TARGET: LayerFamilyTarget = { bare: true, stale: "3D options require an exact layer target without property paths.", missing: "3D layer must exist or be created earlier in this plan." };
const range = (key: string, min: number, max: number): NumberOption => ({ key, min, max });

const CAMERA_OPTIONS: ThreeDOptionRule = {
  allowed: ["zoom", "depthOfField", "focusDistance", "aperture", "blurLevel"],
  numbers: [range("zoom", 1, 100_000), range("focusDistance", 0, 1_000_000), range("aperture", 0.01, 10_000), range("blurLevel", 0, 100)],
  booleans: ["depthOfField"],
  colors: [],
  message: "Camera options are outside the typed bounds.",
};

const LIGHT_OPTIONS: ThreeDOptionRule = {
  allowed: ["intensity", "color", "coneAngle", "coneFeather", "falloffType", "falloffStart", "falloffDistance", "castsShadows", "shadowDarkness", "shadowDiffusion"],
  numbers: [range("intensity", 0, 10_000), range("coneAngle", 0, 180), range("coneFeather", 0, 100), range("falloffType", 1, 3), range("falloffStart", 0, 1_000_000), range("falloffDistance", 0, 1_000_000), range("shadowDarkness", 0, 100), range("shadowDiffusion", 0, 500)],
  booleans: ["castsShadows"],
  colors: ["color"],
  message: "Light options are outside the typed bounds.",
};

const MATERIAL_OPTIONS: ThreeDOptionRule = {
  allowed: ["acceptsShadows", "castsShadows", "lightTransmission", "diffuse", "specularIntensity", "specularShininess", "metal"],
  numbers: [range("lightTransmission", 0, 100), range("diffuse", 0, 100), range("specularIntensity", 0, 100), range("specularShininess", 0, 100), range("metal", 0, 100)],
  booleans: ["acceptsShadows", "castsShadows"],
  colors: [],
  message: "Material options are outside the typed bounds.",
};

function optionsFit(options: JsonObject, rule: ThreeDOptionRule): boolean {
  return Object.keys(options).every((key) => rule.allowed.includes(key))
    && rule.numbers.every((spec) => isOptionalFiniteInRange(options[spec.key], spec.min, spec.max))
    && rule.booleans.every((key) => isOptionalBoolean(options[key]))
    && rule.colors.every((key) => options[key] === undefined || validColor(options[key]));
}

function validateThreeDOptions(context: OperationContext, rule: ThreeDOptionRule): OperationResult {
  const target = familyLayerTarget(context, ["type", "target", "options"], THREE_D_TARGET);
  if (isRefusal(target)) return target;
  const options = context.operation.options;
  if (!isJsonObject(options)) return invalid("INVALID_VALUE", "3D options must be a non-empty typed object.");
  if (Object.keys(options).length === 0) return invalid("INVALID_VALUE", "At least one typed 3D option is required.");
  return optionsFit(options, rule) ? ACCEPTED : invalid("INVALID_VALUE", rule.message);
}

/** set_camera_options: an exact camera layer and bounded zoom, depth of field, focus distance, aperture and blur level. */
export function validateCameraOptions(context: OperationContext): OperationResult { return validateThreeDOptions(context, CAMERA_OPTIONS); }

/** set_light_options: an exact light layer and bounded intensity, colour, cone, falloff and shadow options. */
export function validateLightOptions(context: OperationContext): OperationResult { return validateThreeDOptions(context, LIGHT_OPTIONS); }

/** set_material_options: an exact 3D layer and bounded shadow, transmission and specular material options. */
export function validateMaterialOptions(context: OperationContext): OperationResult { return validateThreeDOptions(context, MATERIAL_OPTIONS); }
