// Render output settings (output module and render settings) and destructive project cleanup.
// The settings tables here are the single typed source for the validator; the host keeps its own
// copy of the matching After Effects keys, because those names only mean something inside After Effects.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import type { OperationContext } from "./layer-targets.js";
import { isCurrentIdentity } from "./plan-shape.js";
import { CLEANUP_MODES, MEDIA_ENCODER_MODES } from "./project-operation-decoders.js";
import { ACCEPTED, invalid, isBoundedName, isIntegerInRange, isNonEmptyString, isOneOf, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";



type SettingSpec = { kind: "text" } | { kind: "bool" } | { kind: "int"; min: number; max: number } | { kind: "enum"; values: readonly (string | number)[] };
const TEXT: SettingSpec = { kind: "text" };
const PIXELS: SettingSpec = { kind: "int", min: 1, max: 30_000 };
const CROP: SettingSpec = { kind: "int", min: 0, max: 30_000 };
const toggle = (...values: string[]): SettingSpec => ({ kind: "enum", values });
const BLEND = toggle("On for Checked Layers", "Off for All Layers");

export const OUTPUT_SETTING_SPECS: Readonly<Record<string, SettingSpec>> = {
  format: TEXT, videoCodec: TEXT, videoOutput: { kind: "bool" }, depth: TEXT,
  "resize.width": PIXELS, "resize.height": PIXELS, "resize.quality": toggle("Low", "Medium", "High", "Best"),
  "crop.top": CROP, "crop.left": CROP, "crop.bottom": CROP, "crop.right": CROP,
  "audio.output": toggle("Auto", "On", "Off"), "audio.sampleRate": { kind: "enum", values: [22050, 32000, 44100, 48000, 96000] }, "audio.bitDepth": { kind: "enum", values: [8, 16] }, "audio.channels": toggle("Mono", "Stereo"),
};
export const RENDER_SETTING_SPECS: Readonly<Record<string, SettingSpec>> = {
  quality: toggle("Best", "Draft", "Wireframe"), resolution: toggle("Full", "Half", "Third", "Quarter"), motionBlur: BLEND, frameBlending: BLEND,
  effects: toggle("All On", "Current Settings", "All Off"), timeSpan: toggle("Length of Comp", "Work Area Only"),
};
const CHANNELS_REFUSAL = "After Effects does not let scripts set Channels (it is read-only). For alpha, set outputModuleTemplate to \"High Quality with Alpha\", \"Lossless with Alpha\", \"TIFF Sequence with Alpha\" or \"Alpha Only\" instead.";
const NESTED_GROUPS: readonly string[] = ["resize", "crop", "audio"];

function settingError(spec: SettingSpec, value: JsonValue | undefined): boolean {
  if (spec.kind === "text") return !isBoundedName(value, 64);
  if (spec.kind === "bool") return typeof value !== "boolean";
  if (spec.kind === "int") return !isIntegerInRange(value, spec.min, spec.max);
  return !spec.values.some((allowed) => allowed === value);
}
function flattenSettings(settings: JsonObject): Readonly<Record<string, JsonValue>> | undefined {
  const flat: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!NESTED_GROUPS.includes(key)) { flat[key] = value; continue; }
    if (!isJsonObject(value) || Object.keys(value).length === 0) return undefined;
    for (const [inner, innerValue] of Object.entries(value)) flat[`${key}.${inner}`] = innerValue;
  }
  return flat;
}
function groupError(flat: Readonly<Record<string, JsonValue>>): string | undefined {
  const hasResize = Object.keys(flat).some((key) => key.startsWith("resize."));
  if (hasResize && (flat["resize.width"] === undefined || flat["resize.height"] === undefined)) return "resize needs both width and height.";
  return undefined;
}
function settingFieldError(name: string, key: string, field: JsonValue, specs: Readonly<Record<string, SettingSpec>>): string | undefined {
  const spec = Object.hasOwn(specs, key) ? specs[key] : undefined;
  if (key === "channels") return CHANNELS_REFUSAL;
  if (!spec) return `${name}.${key} is not a settable field.`;
  return settingError(spec, field) ? `${name}.${key} has a value outside its allowed set.` : undefined;
}
function settingsObjectError(name: string, value: JsonValue, specs: Readonly<Record<string, SettingSpec>>): string | undefined {
  if (!isJsonObject(value)) return `${name} must be an object.`;
  const flat = flattenSettings(value);
  if (!flat || Object.keys(flat).length === 0 || Object.keys(flat).length > 32) return `${name} must set one or more typed fields (nested groups: resize, crop, audio).`;
  for (const [key, field] of Object.entries(flat)) {
    const reason = settingFieldError(name, key, field, specs);
    if (reason) return reason;
  }
  return groupError(flat);
}
function optionalSettingsError(name: string, operation: JsonObject, specs: Readonly<Record<string, SettingSpec>>): string | undefined {
  const value = operation[name];
  return value === undefined ? undefined : settingsObjectError(name, value, specs);
}

/** Checks render_composition's optional outputSettings, renderSettings and mediaEncoder fields; each settings object is checked against the typed tables, with one level of nesting (resize, crop, audio) and every other field flat. */
export function renderSettingsRefusal(operation: JsonObject): Refusal | undefined {
  const { mediaEncoder, executeAuthorization } = operation;
  const reason = optionalSettingsError("outputSettings", operation, OUTPUT_SETTING_SPECS) ?? optionalSettingsError("renderSettings", operation, RENDER_SETTING_SPECS);
  if (reason) return invalid("INVALID_VALUE", reason);
  if (mediaEncoder !== undefined && !isOneOf(mediaEncoder, MEDIA_ENCODER_MODES)) return invalid("INVALID_VALUE", "mediaEncoder must be queue or start.");
  return mediaEncoder !== undefined && executeAuthorization !== undefined ? invalid("INVALID_VALUE", "mediaEncoder and executeAuthorization are different destinations; send one or the other.") : undefined;
}

function isDistinctIdList(ids: JsonValue | undefined): ids is string[] {
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= 64 && new Set(ids).size === ids.length && ids.every(isNonEmptyString);
}

function cleanupCompositionError({ operation, snapshot }: OperationContext): string | undefined {
  const ids = operation.compositionIds;
  if (operation.mode !== "reduce") return ids === undefined ? undefined : "compositionIds only applies to mode reduce.";
  if (!isDistinctIdList(ids)) return "reduce needs 1-64 distinct compositionIds to keep.";
  const missing = snapshot ? ids.find((id) => !snapshot.compositions.some((composition) => composition.id === id)) : undefined;
  return missing === undefined ? undefined : `Composition ${missing} is not in the current snapshot.`;
}

/** Validates cleanup_project: Reduce Project, Remove Unused Footage or Consolidate All Footage, always the last operation and always confirmed with destructive:true. */
export function validateCleanupProject(context: OperationContext): OperationResult {
  const { operation, plan, later } = context;
  const unknown = rejectUnknown(operation, ["type", "snapshotFingerprint", "selectionFingerprint", "mode", "compositionIds", "destructive"]);
  if (unknown) return unknown;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "cleanup_project requires current snapshot identity.");
  if (operation.destructive !== true) return invalid("DESTRUCTIVE_CONFIRMATION_REQUIRED", "cleanup_project removes project items and requires destructive:true.");
  if (!isOneOf(operation.mode, CLEANUP_MODES)) return invalid("INVALID_VALUE", "mode must be reduce, remove_unused_footage or consolidate_footage.");
  if (later.length > 0) return invalid("INVALID_VALUE", "cleanup_project must be the last operation: it removes project items and later operations could name them.");
  const idsError = cleanupCompositionError(context);
  return idsError ? invalid("INVALID_VALUE", idsError) : ACCEPTED;
}
