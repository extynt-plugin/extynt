// set_composition_settings: the typed composition settings (size, duration, frame rate, work area, motion blur, renderer),
// checked against the observed composition when the snapshot holds it.
import type { CompositionSnapshot } from "@extynt/project-graph";
import { isJsonArray, type JsonObject, type JsonValue } from "@extynt/decode";
import { unknownCompositionError } from "./composition-rules.js";
import { validColor } from "./geometry-rules.js";
import { isJsonObject } from "./json-shape.js";
import type { OperationContext } from "./layer-targets.js";
import { compositionTarget } from "./plan-shape.js";
import { ACCEPTED, invalid, isBoundedName, isIntegerInRange, isOptionalBoolean, isOptionalFiniteInRange, isOptionalIntegerInRange, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

type Field = JsonValue | undefined;

const COMPOSITION_SETTING_KEYS = ["width", "height", "pixelAspect", "durationSeconds", "frameRate", "backgroundColor", "workAreaStart", "workAreaDuration", "motionBlur", "shutterAngle", "shutterPhase", "motionBlurSamplesPerFrame", "motionBlurAdaptiveSampleLimit", "frameBlending", "draft3d", "resolutionFactor", "renderer"];
const WORK_AREA_TOLERANCE_SECONDS = 0.0005;
const NO_TIMING: Partial<Pick<CompositionSnapshot, "duration" | "workAreaStart" | "workAreaDuration">> = {};

function settingsObject(settings: Field): JsonObject | Refusal {
  if (!isJsonObject(settings)) return invalid("INVALID_VALUE", "Composition settings must be a non-empty typed object.");
  const keys = Object.keys(settings);
  return keys.length === 0 || keys.some((key) => !COMPOSITION_SETTING_KEYS.includes(key)) ? invalid("INVALID_VALUE", "Composition settings include an unsupported field.") : settings;
}

function sizeAndTimingError(settings: JsonObject): Refusal | undefined {
  const backgroundColor = settings.backgroundColor;
  if (!isOptionalIntegerInRange(settings.width, 4, 8192) || !isOptionalIntegerInRange(settings.height, 4, 8192) || !isOptionalFiniteInRange(settings.pixelAspect, 0.01, 100) || !isOptionalFiniteInRange(settings.durationSeconds, 0.01, 10_800) || !isOptionalFiniteInRange(settings.frameRate, 1, 120) || (backgroundColor !== undefined && !validColor(backgroundColor))) return invalid("INVALID_VALUE", "Composition settings are outside the typed bounds; width and height must be integers from 4 to 8192.");
  return undefined;
}

function motionBlurSettingsValid(settings: JsonObject): boolean {
  return isOptionalBoolean(settings.motionBlur) && isOptionalFiniteInRange(settings.shutterAngle, 0, 720) && isOptionalFiniteInRange(settings.shutterPhase, -360, 360) && isOptionalIntegerInRange(settings.motionBlurSamplesPerFrame, 2, 64) && isOptionalIntegerInRange(settings.motionBlurAdaptiveSampleLimit, 2, 256);
}

function resolutionFactorValid(value: Field): boolean {
  return value === undefined || (isJsonArray(value) && value.length === 2 && value.every((part) => isIntegerInRange(part, 1, 16)));
}

function numberOr(value: Field, fallback: number | undefined): number | undefined { return typeof value === "number" ? value : fallback; }

function workAreaFitError(settings: JsonObject, observed: CompositionSnapshot | undefined): Refusal | undefined {
  if (settings.workAreaStart === undefined && settings.workAreaDuration === undefined) return undefined;
  const timing = observed ?? NO_TIMING;
  const duration = numberOr(settings.durationSeconds, timing.duration);
  const start = numberOr(settings.workAreaStart, timing.workAreaStart);
  const length = numberOr(settings.workAreaDuration, timing.workAreaDuration);
  if (duration === undefined || start === undefined || length === undefined || start + length <= duration + WORK_AREA_TOLERANCE_SECONDS) return undefined;
  return invalid("INVALID_VALUE", `The work area ${start}s + ${length}s ends after the composition's ${duration}s duration.`);
}

function rendererError(settings: JsonObject, observed: CompositionSnapshot | undefined): Refusal | undefined {
  const renderer = settings.renderer;
  if (renderer === undefined) return undefined;
  if (!isBoundedName(renderer, 64)) return invalid("INVALID_VALUE", "renderer must be a 1-64 character renderer name from the composition's renderers list.");
  if (!observed?.renderers?.length || observed.renderers.includes(renderer)) return undefined;
  return invalid("INVALID_VALUE", `renderer ${JSON.stringify(renderer)} is not one this composition lists; available: ${observed.renderers.map((name) => JSON.stringify(name)).join(", ")}.`);
}

function settingsValueError(settings: JsonObject): Refusal | undefined {
  if (!isOptionalFiniteInRange(settings.workAreaStart, 0, 10_800) || !isOptionalFiniteInRange(settings.workAreaDuration, 0.001, 10_800)) return invalid("INVALID_VALUE", "workAreaStart must be 0 to 10800 seconds and workAreaDuration 0.001 to 10800 seconds.");
  if (!motionBlurSettingsValid(settings)) return invalid("INVALID_VALUE", "motionBlur must be a boolean, shutterAngle 0 to 720, shutterPhase -360 to 360, motionBlurSamplesPerFrame an integer 2 to 64 and motionBlurAdaptiveSampleLimit an integer 2 to 256.");
  if (!isOptionalBoolean(settings.frameBlending) || !isOptionalBoolean(settings.draft3d)) return invalid("INVALID_VALUE", "frameBlending and draft3d must be booleans.");
  return resolutionFactorValid(settings.resolutionFactor) ? undefined : invalid("INVALID_VALUE", "resolutionFactor must be [x, y], whole numbers from 1 to 16 (1 is full resolution, 2 half, 3 third, 4 quarter).");
}

function timelineError(settings: JsonObject, observed: CompositionSnapshot | undefined): Refusal | undefined {
  return settingsValueError(settings) ?? workAreaFitError(settings, observed) ?? rendererError(settings, observed);
}

/**
 * set_composition_settings: an exact composition that exists or is created earlier, and a non-empty set of supported settings.
 * Width and height are integers because After Effects' CompItem has no read-back for a fraction. Work area, motion blur and
 * renderer are bounded typed values, checked against the observed composition when there is one.
 */
export function validateCompositionSettings(context: OperationContext): OperationResult {
  const { operation, plan, snapshot, earlier } = context;
  const unknownField = rejectUnknown(operation, ["type", "target", "settings"]);
  if (unknownField) return unknownField;
  const target = compositionTarget(operation, plan);
  if (isRefusal(target)) return target;
  const missing = unknownCompositionError(snapshot, earlier, target.compositionId);
  if (missing) return missing;
  const settings = settingsObject(operation.settings);
  if (isRefusal(settings)) return settings;
  const observed = snapshot?.compositions.find((composition) => composition.id === target.compositionId);
  return sizeAndTimingError(settings) ?? timelineError(settings, observed) ?? ACCEPTED;
}
