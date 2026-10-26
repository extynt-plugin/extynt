// Composition- and project-level operations: precompose_layers, export_mogrt, export_frame, set_composition_guides, save_project and
// set_project_settings. Each rule checks one operation's fields and the composition or project identity it addresses.
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import { compTarget, hasPlannedLayer, listedLayers, observedLayerExists, type CompositionAddress, type OperationContext } from "./layer-targets.js";
import { earlierWith } from "./operation-checks.js";
import { isCurrentIdentity } from "./plan-shape.js";
import { ACCEPTED, invalid, isAbsoluteBoundedPath, isBoundedName, isFiniteInRange, isNewPlaceholderId, isOneOf, isOptionalBoolean, isOptionalIntegerInRange, isRefusal, rejectUnknown, targetOf, type OperationResult, type Refusal } from "./validation-primitives.js";

const SAVE_PROJECT_MODES = ["save", "save_as", "increment"] as const;
const PROJECT_SETTING_KEYS: readonly string[] = ["bitsPerChannel", "linearBlending", "workingSpace", "linearizeWorkingSpace"];
const BIT_DEPTHS: readonly number[] = [8, 16, 32];

function distinctLayerIds(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) return undefined;
  const ids = value.filter((id) => typeof id === "string");
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : undefined;
}

function isPlaceholder(value: JsonValue | undefined): boolean { return typeof value === "string" && isNewPlaceholderId(value); }

function precomposeNameError(name: JsonValue | undefined): Refusal | undefined {
  return typeof name !== "string" || !name.trim() || name.length > 256 ? invalid("INVALID_VALUE", "precompose_layers requires a 1-256 character composition name.") : undefined;
}

function precomposePlaceholderError({ newCompositionId, newLayerId }: JsonObject): Refusal | undefined {
  return isPlaceholder(newCompositionId) && isPlaceholder(newLayerId) ? undefined : invalid("INVALID_OPERATION", "precompose_layers requires __new__: placeholders for newCompositionId and newLayerId.");
}

function precomposeMoveError({ moveAllAttributes }: JsonObject, layerCount: number): Refusal | undefined {
  if (!isOptionalBoolean(moveAllAttributes)) return invalid("INVALID_VALUE", "moveAllAttributes must be boolean.");
  return moveAllAttributes === false && layerCount !== 1 ? invalid("INVALID_VALUE", "moveAllAttributes:false (leave attributes) only works when precomposing exactly one layer.") : undefined;
}

function precomposeFieldError(operation: JsonObject, layerCount: number): Refusal | undefined {
  return precomposeNameError(operation.name) ?? precomposePlaceholderError(operation) ?? precomposeMoveError(operation, layerCount);
}

function precomposedLayerError({ snapshot, earlier }: OperationContext, target: CompositionAddress, layerIds: readonly string[]): Refusal | undefined {
  if (!snapshot) return undefined;
  for (const layerId of layerIds) {
    const address = { compositionId: target.compositionId, layerId };
    if (!observedLayerExists(snapshot, address) && !hasPlannedLayer(earlier, address)) return invalid("TARGET_NOT_FOUND", `Layer ${layerId} is not in the composition or created earlier in this plan. ${listedLayers(snapshot, address, earlier)}`);
  }
  return undefined;
}

/** Validates precompose_layers: 1-256 distinct layers of one composition move into a new composition, which gets new layer ids. */
export function validatePrecomposeLayers(context: OperationContext): OperationResult {
  const { operation, later } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "layerIds", "name", "newCompositionId", "newLayerId", "moveAllAttributes"]);
  if (unknown) return unknown;
  const target = compTarget(context);
  if (isRefusal(target)) return target;
  const layerIds = distinctLayerIds(operation.layerIds);
  if (!layerIds) return invalid("INVALID_VALUE", "precompose_layers requires 1-256 distinct layer ids.");
  const failure = precomposeFieldError(operation, layerIds.length) ?? precomposedLayerError(context, target, layerIds);
  if (failure) return failure;
  const referenced = earlierWith(later, (op) => targetOf(op)?.compositionId === target.compositionId && layerIds.includes(String(targetOf(op)?.layerId)));
  return referenced ? invalid("PRECOMPOSED_LAYER_REFERENCED", "Layers moved into the new precomp get new ids; target newLayerId (the precomp layer) or propose a follow-up plan against the refreshed snapshot.") : ACCEPTED;
}

/** Validates export_mogrt, which writes a file outside the project and so needs the explicit EXPORT_NOW authorization. */
export function validateExportMogrt(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "templateName", "outputPath", "overwrite", "exportAuthorization"]);
  if (unknown) return unknown;
  const target = compTarget(context);
  if (isRefusal(target)) return target;
  const outputPath = operation.outputPath;
  if (!isBoundedName(operation.templateName, 256)) return invalid("INVALID_VALUE", "templateName must be 1-256 characters.");
  if (!isAbsoluteBoundedPath(outputPath, 1024) || !/\.mogrt$/i.test(outputPath)) return invalid("INVALID_VALUE", "outputPath must be an absolute local path ending in .mogrt.");
  if (!isOptionalBoolean(operation.overwrite)) return invalid("INVALID_VALUE", "overwrite must be boolean.");
  return operation.exportAuthorization === "EXPORT_NOW" ? ACCEPTED : invalid("EXPORT_AUTHORIZATION_REQUIRED", "export_mogrt writes a file outside the project and cannot be undone; pass exportAuthorization:\"EXPORT_NOW\" only after the user asks to export.");
}

function exportFrameTimeError(operation: JsonObject, duration: number | undefined): Refusal | undefined {
  const time = operation.time;
  if (!isFiniteInRange(time, 0, 86_400)) return invalid("INVALID_VALUE", "time must be composition seconds from 0 to 86400.");
  return typeof duration === "number" && time > duration ? invalid("INVALID_VALUE", `time ${String(time)}s is past the end of the composition (${duration}s).`) : undefined;
}

function exportFrameFileError(operation: JsonObject): Refusal | undefined {
  const outputPath = operation.outputPath;
  if (!isAbsoluteBoundedPath(outputPath, 1024) || !/\.png$/i.test(outputPath)) return invalid("INVALID_VALUE", "outputPath must be an absolute local path ending in .png.");
  if (!isOptionalBoolean(operation.overwrite)) return invalid("INVALID_VALUE", "overwrite must be boolean.");
  return isOptionalIntegerInRange(operation.resolution, 1, 16) ? undefined : invalid("INVALID_VALUE", "resolution is the whole-number divisor of full size: 1 (the default) is full size, 2 half, 4 quarter.");
}

/** Validates export_frame, which writes a PNG outside the project and so needs the explicit EXPORT_NOW authorization. */
export function validateExportFrame(context: OperationContext): OperationResult {
  const { operation, snapshot } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "time", "outputPath", "overwrite", "resolution", "exportAuthorization"]);
  if (unknown) return unknown;
  const target = compTarget(context);
  if (isRefusal(target)) return target;
  const duration = snapshot?.compositions.find((composition) => composition.id === target.compositionId)?.duration;
  const failure = exportFrameTimeError(operation, duration) ?? exportFrameFileError(operation);
  if (failure) return failure;
  return operation.exportAuthorization === "EXPORT_NOW" ? ACCEPTED : invalid("EXPORT_AUTHORIZATION_REQUIRED", "export_frame writes a file outside the project and cannot be undone; pass exportAuthorization:\"EXPORT_NOW\" only after the user asks to export a frame.");
}

function isGuide(guide: JsonValue): boolean {
  return isJsonObject(guide) && !rejectUnknown(guide, ["orientation", "position"]) && isOneOf(guide.orientation, ["horizontal", "vertical"]) && isFiniteInRange(guide.position, -100_000, 100_000);
}

function compositionGuidesError(guides: JsonValue | undefined, replace: JsonValue | undefined): Refusal | undefined {
  if (!Array.isArray(guides) || guides.length > 64 || (guides.length === 0 && replace !== true)) return invalid("INVALID_VALUE", "guides must hold up to 64 entries (an empty list only with replace:true to clear).");
  return guides.every(isGuide) ? undefined : invalid("INVALID_VALUE", "Each guide needs orientation horizontal|vertical and a finite pixel position.");
}

/** Validates set_composition_guides. */
export function validateSetCompositionGuides(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "guides", "replace"]);
  if (unknown) return unknown;
  const target = compTarget(context);
  if (isRefusal(target)) return target;
  const guidesError = compositionGuidesError(operation.guides, operation.replace);
  if (guidesError) return guidesError;
  return isOptionalBoolean(operation.replace) ? ACCEPTED : invalid("INVALID_VALUE", "replace must be boolean.");
}

function saveProjectPathError({ mode, path }: JsonObject): Refusal | undefined {
  const saveAs = mode === "save_as";
  if (saveAs && !(isAbsoluteBoundedPath(path, 1024) && /\.aepx?$/i.test(path))) return invalid("INVALID_VALUE", "save_as needs path: an absolute local path ending in .aep (or .aepx).");
  return !saveAs && path !== undefined ? invalid("INVALID_VALUE", `path only applies to mode save_as; ${String(mode)} saves beside the project's current file.`) : undefined;
}

function saveOverwriteError({ mode, overwrite }: JsonObject): Refusal | undefined {
  return overwrite !== undefined && (typeof overwrite !== "boolean" || mode !== "save_as") ? invalid("INVALID_VALUE", "overwrite is a boolean that only applies to save_as: without it an existing file is not replaced.") : undefined;
}

/** Validates save_project: save in place, save to a new .aep path, or save the next numbered copy beside the current file. It never discards anything. */
export function validateSaveProject({ operation, plan }: OperationContext): OperationResult {
  const unknown = rejectUnknown(operation, ["type", "snapshotFingerprint", "selectionFingerprint", "mode", "path", "overwrite"]);
  if (unknown) return unknown;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "save_project requires current snapshot identity.");
  if (!isOneOf(operation.mode, SAVE_PROJECT_MODES)) return invalid("INVALID_VALUE", `mode must be one of ${SAVE_PROJECT_MODES.join(", ")}.`);
  return saveProjectPathError(operation) ?? saveOverwriteError(operation) ?? ACCEPTED;
}

function projectSettingsValuesError(settings: JsonObject): Refusal | undefined {
  const { bitsPerChannel, linearBlending, linearizeWorkingSpace, workingSpace } = settings;
  if (bitsPerChannel !== undefined && !BIT_DEPTHS.some((depth) => depth === bitsPerChannel)) return invalid("INVALID_VALUE", "bitsPerChannel must be 8, 16, or 32.");
  if (!isOptionalBoolean(linearBlending) || !isOptionalBoolean(linearizeWorkingSpace)) return invalid("INVALID_VALUE", "linearBlending and linearizeWorkingSpace must be boolean.");
  return workingSpace !== undefined && (typeof workingSpace !== "string" || workingSpace.length > 256) ? invalid("INVALID_VALUE", "workingSpace must be a color profile name (empty string for None).") : undefined;
}

/** Validates set_project_settings: bit depth, linear blending and the working color space. */
export function validateSetProjectSettings({ operation, plan }: OperationContext): OperationResult {
  const unknown = rejectUnknown(operation, ["type", "snapshotFingerprint", "selectionFingerprint", "settings"]);
  if (unknown) return unknown;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "set_project_settings requires current snapshot identity.");
  const settings = operation.settings;
  if (!isJsonObject(settings) || !Object.keys(settings).length || Object.keys(settings).some((key) => !PROJECT_SETTING_KEYS.includes(key))) return invalid("INVALID_VALUE", "settings must set bitsPerChannel, linearBlending, workingSpace, and/or linearizeWorkingSpace.");
  return projectSettingsValuesError(settings) ?? ACCEPTED;
}
