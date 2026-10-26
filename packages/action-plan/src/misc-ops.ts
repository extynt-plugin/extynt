// Single-layer and project operations that need no shared grouping: set_text_path, open_composition, start_analysis, resize_solid,
// tracker_to_nulls, collect_project, switch_project and save_layer_preset. Each rule checks one operation's own fields and target.
import type { JsonObject } from "@extynt/decode";
import { isEffectPathList } from "./layer-more-ops.js";
import { compTarget, layerTarget, observedLayer, type OperationContext } from "./layer-targets.js";
import { ANALYSIS_KINDS } from "./layer-edit-decoders.js";
import { isCurrentIdentity } from "./plan-shape.js";
import type { V2TargetReference } from "./plan-types.js";
import { ACCEPTED, invalid, isAbsoluteBoundedPath, isBoundedName, isOneOf, isOptionalBoolean, isOptionalFiniteInRange, isOptionalIntegerInRange, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";


function layerKindError(context: OperationContext, target: V2TargetReference, expected: string, message: (layer: { name: string; type: string }) => string): Refusal | undefined {
  const layer = observedLayer(context.snapshot, target);
  return layer && layer.type !== expected ? invalid("INVALID_TARGET", message(layer)) : undefined;
}

function textPathValuesError(operation: JsonObject): Refusal | undefined {
  const { maskIndex, firstMargin, lastMargin } = operation;
  if (maskIndex === undefined && firstMargin === undefined && lastMargin === undefined) return invalid("INVALID_OPERATION", "set_text_path needs maskIndex, firstMargin or lastMargin.");
  if (!isOptionalIntegerInRange(maskIndex, 0, 1024)) return invalid("INVALID_VALUE", "maskIndex is the 1-based mask of this layer the text follows; 0 detaches the text from any path.");
  return !isOptionalFiniteInRange(firstMargin, -1_000_000, 1_000_000) || !isOptionalFiniteInRange(lastMargin, -1_000_000, 1_000_000) ? invalid("INVALID_VALUE", "firstMargin and lastMargin are pixels.") : undefined;
}

/** Validates set_text_path, which points a text layer at one of its own masks (Text > Path Options) and sets the first and last margins. */
export function validateSetTextPath(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "maskIndex", "firstMargin", "lastMargin"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  return layerKindError(context, target, "text", (layer) => `set_text_path applies to a text layer; "${layer.name}" is a ${layer.type} layer.`) ?? textPathValuesError(operation) ?? ACCEPTED;
}

/** Validates open_composition, which shows a composition in the viewer and leaves it there. */
export function validateOpenComposition(context: OperationContext): OperationResult {
  const unknown = rejectUnknown(context.operation, ["type", "target"]);
  if (unknown) return unknown;
  const target = compTarget(context);
  return isRefusal(target) ? target : ACCEPTED;
}

/** Validates start_analysis, which adds Warp Stabilizer or the 3D Camera Tracker to a layer (or, on a layer that already has the effect, reports whether it is still analysing); the 3D tracker's Create Camera button has no script route, so it is never offered. */
export function validateStartAnalysis(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "kind"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  if (!isOneOf(operation.kind, ANALYSIS_KINDS)) return invalid("INVALID_VALUE", `kind is one of ${ANALYSIS_KINDS.join(", ")}. The motion tracker's Analyze and the 3D tracker's Create Camera cannot be run from a script.`);
  return layerKindError(context, target, "av", (layer) => `${String(operation.kind)} analyses footage; "${layer.name}" is a ${layer.type} layer.`) ?? ACCEPTED;
}

function resizeSolidValuesError(operation: JsonObject): Refusal | undefined {
  const { width, height, pixelAspect, allUsers } = operation;
  if (width === undefined && height === undefined && pixelAspect === undefined) return invalid("INVALID_OPERATION", "resize_solid needs width, height or pixelAspect.");
  if (!isOptionalIntegerInRange(width, 1, 30_000) || !isOptionalIntegerInRange(height, 1, 30_000)) return invalid("INVALID_VALUE", "width and height are whole pixels from 1 to 30000.");
  if (!isOptionalFiniteInRange(pixelAspect, 0.01, 100)) return invalid("INVALID_VALUE", "pixelAspect is from 0.01 to 100.");
  return isOptionalBoolean(allUsers) ? undefined : invalid("INVALID_VALUE", "allUsers is a boolean.");
}

/** Validates resize_solid, which changes a solid layer's size and pixel aspect. A solid is a project item that every layer made from it shares, so the host refuses while other layers use it unless allUsers:true says resizing them all is wanted, and names those layers. */
export function validateResizeSolid(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "width", "height", "pixelAspect", "allUsers"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  return resizeSolidValuesError(operation) ?? layerKindError(context, target, "av", (layer) => `resize_solid applies to a solid layer; "${layer.name}" is a ${layer.type} layer.`) ?? ACCEPTED;
}

/** Validates tracker_to_nulls, which turns the track points a layer already holds (analysed in the Tracker panel, which has no script route) into null layers that follow them through an expression, one null per track point. Analysis itself is never started here. */
export function validateTrackerToNulls(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "trackerName", "point"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  if (operation.trackerName !== undefined && !isBoundedName(operation.trackerName, 128)) return invalid("INVALID_VALUE", "trackerName is the tracker's name in the Tracker panel (e.g. Tracker 1).");
  return operation.point !== undefined && !isOneOf(operation.point, ["attach-point", "feature-center"]) ? invalid("INVALID_VALUE", "point is attach-point (default) or feature-center.") : ACCEPTED;
}

/** Validates collect_project, which rebuilds Collect Files in script (the menu command opens a blocking dialog): footage files are copied into <destinationFolder>/(Footage), the footage items are relinked to the copies, and the project is saved there as <projectName>.aep. It cannot carry image sequences, proxies, fonts, plug-ins, or the layer choice of a layered Photoshop or Illustrator import. */
export function validateCollectProject({ operation, plan }: OperationContext): OperationResult {
  const unknown = rejectUnknown(operation, ["type", "snapshotFingerprint", "selectionFingerprint", "destinationFolder", "projectName", "exportAuthorization"]);
  if (unknown) return unknown;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "collect_project requires current snapshot identity.");
  if (!isAbsoluteBoundedPath(operation.destinationFolder, 1024)) return invalid("INVALID_VALUE", "destinationFolder must be an absolute local folder path.");
  const projectName = operation.projectName;
  if (!isBoundedName(projectName, 128) || /[\\/:*?"<>|]/.test(projectName)) return invalid("INVALID_VALUE", "projectName is a plain file name without a path or an extension.");
  return operation.exportAuthorization === "EXPORT_NOW" ? ACCEPTED : invalid("EXPORT_AUTHORIZATION_REQUIRED", "collect_project copies files and re-saves the project somewhere else, and cannot be undone; pass exportAuthorization:\"EXPORT_NOW\" only after the user asks to collect.");
}

function switchProjectPathError({ mode, path }: JsonObject): Refusal | undefined {
  if (mode === "open" && !(isAbsoluteBoundedPath(path, 1024) && /\.aepx?$/i.test(path))) return invalid("INVALID_VALUE", "open needs path: an absolute local path ending in .aep or .aepx.");
  return mode === "new" && path !== undefined ? invalid("INVALID_VALUE", "path only applies to mode open.") : undefined;
}

/** Validates switch_project, which closes the open project and starts a new one or opens another .aep. It never discards work quietly: while the project has unsaved changes the host refuses until the plan says discardUnsaved:true, which should follow the user's agreement (a save_project earlier in the same plan clears the changes instead). It must be the last operation, since later ones would address a project that is gone. */
export function validateSwitchProject({ operation, plan, later }: OperationContext): OperationResult {
  const unknown = rejectUnknown(operation, ["type", "snapshotFingerprint", "selectionFingerprint", "mode", "path", "discardUnsaved"]);
  if (unknown) return unknown;
  if (!isCurrentIdentity(operation, plan)) return invalid("STALE_TARGET", "switch_project requires current snapshot identity.");
  if (!isOneOf(operation.mode, ["new", "open"])) return invalid("INVALID_VALUE", "mode is new or open.");
  const pathError = switchProjectPathError(operation);
  if (pathError) return pathError;
  if (!isOptionalBoolean(operation.discardUnsaved)) return invalid("INVALID_VALUE", "discardUnsaved is a boolean.");
  return later.length > 0 ? invalid("INVALID_VALUE", "switch_project must be the last operation: the project the later operations would address is closed by it.") : ACCEPTED;
}

function presetFileError(operation: JsonObject): Refusal | undefined {
  const { outputPath, effectPaths } = operation;
  if (!isAbsoluteBoundedPath(outputPath, 1024) || !/\.ffx$/i.test(outputPath)) return invalid("INVALID_VALUE", "outputPath must be an absolute local path ending in .ffx.");
  if (effectPaths !== undefined && !isEffectPathList(effectPaths)) return invalid("INVALID_VALUE", "effectPaths is 1-32 distinct \"ADBE Effect Parade/<matchName>\" paths; leave it out to save every effect on the layer.");
  return isOptionalBoolean(operation.overwrite) ? undefined : invalid("INVALID_VALUE", "overwrite must be boolean.");
}

/** Validates save_layer_preset, which writes a layer's effects (all of them, or the listed ones) as an Animation Preset (.ffx) with Layer.savePreset, which saves what is selected. apply_preset can apply the file again. It writes outside the project, so it needs the export authorization. */
export function validateSaveLayerPreset(context: OperationContext): OperationResult {
  const { operation } = context;
  const unknown = rejectUnknown(operation, ["type", "target", "effectPaths", "outputPath", "overwrite", "exportAuthorization"]);
  if (unknown) return unknown;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  const failure = presetFileError(operation);
  if (failure) return failure;
  return operation.exportAuthorization === "EXPORT_NOW" ? ACCEPTED : invalid("EXPORT_AUTHORIZATION_REQUIRED", "save_layer_preset writes a file outside the project; pass exportAuthorization:\"EXPORT_NOW\" only after the user asks to save a preset.");
}
