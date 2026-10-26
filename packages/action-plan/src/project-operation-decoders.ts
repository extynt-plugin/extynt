// The decoders and types of the project-level operations: folders, items, imports, footage, compositions, rendering, saving and cleanup.
import { array, boolean, literal, number, optional, string, strictObject, tuple, type Infer } from "@extynt/decode";
import { FOOTAGE_ALPHA_MODES, FOOTAGE_FIELD_SEPARATIONS, FOOTAGE_PULLDOWN_METHODS, FOOTAGE_PULLDOWN_PHASES, SCENE_EDIT_MODES } from "./plan-constants.js";
import { folderReference, planIdentity, rgbColor, v2CompositionTarget, v2ItemTarget } from "./operation-parts.js";
import { v2Target } from "./plan-decoders.js";

export const MEDIA_ENCODER_MODES = ["queue", "start"] as const;
export const CLEANUP_MODES = ["reduce", "remove_unused_footage", "consolidate_footage"] as const;

const renderOutputSettings = strictObject({
  format: optional(string()), videoCodec: optional(string()), videoOutput: optional(boolean()), depth: optional(string()),
  resize: optional(strictObject({ width: number(), height: number(), quality: optional(literal("Low", "Medium", "High", "Best")) })),
  crop: optional(strictObject({ top: optional(number()), left: optional(number()), bottom: optional(number()), right: optional(number()) })),
  audio: optional(strictObject({ output: optional(literal("Auto", "On", "Off")), sampleRate: optional(literal(22050, 32000, 44100, 48000, 96000)), bitDepth: optional(literal(8, 16)), channels: optional(literal("Mono", "Stereo")) })),
});
const blendSwitch = literal("On for Checked Layers", "Off for All Layers");
const renderQueueSettings = strictObject({
  quality: optional(literal("Best", "Draft", "Wireframe")), resolution: optional(literal("Full", "Half", "Third", "Quarter")),
  motionBlur: optional(blendSwitch), frameBlending: optional(blendSwitch),
  effects: optional(literal("All On", "Current Settings", "All Off")), timeSpan: optional(literal("Length of Comp", "Work Area Only")),
});
const footageInterpretation = strictObject({
  conformFrameRate: optional(number()), alphaMode: optional(literal(...FOOTAGE_ALPHA_MODES)), premulColor: optional(rgbColor), loop: optional(number()), pixelAspect: optional(number()),
  fieldSeparationType: optional(literal(...FOOTAGE_FIELD_SEPARATIONS)), invertAlpha: optional(boolean()), guessAlpha: optional(literal(true)), highQualityFieldSeparation: optional(boolean()),
  removePulldown: optional(literal(...FOOTAGE_PULLDOWN_PHASES)), guessPulldown: optional(literal(...FOOTAGE_PULLDOWN_METHODS)), resetFrameRate: optional(literal(true)),
});
const compositionSettings = strictObject({
  width: optional(number()), height: optional(number()), pixelAspect: optional(number()), durationSeconds: optional(number()), frameRate: optional(number()), backgroundColor: optional(rgbColor),
  workAreaStart: optional(number()), workAreaDuration: optional(number()), motionBlur: optional(boolean()), shutterAngle: optional(number()), shutterPhase: optional(number()),
  motionBlurSamplesPerFrame: optional(number()), motionBlurAdaptiveSampleLimit: optional(number()), frameBlending: optional(boolean()), draft3d: optional(boolean()),
  resolutionFactor: optional(tuple(number(), number())), renderer: optional(string()),
});
const projectSettings = strictObject({ bitsPerChannel: optional(literal(8, 16, 32)), linearBlending: optional(boolean()), workingSpace: optional(string()), linearizeWorkingSpace: optional(boolean()) });
const exportAuthorization = literal("EXPORT_NOW");

export const createFolderOperation = strictObject({ type: literal("create_folder"), newFolderId: string(), ...planIdentity, name: string(), parentFolderId: optional(folderReference) });
export const setItemNameOperation = strictObject({ type: literal("set_item_name"), target: v2ItemTarget, name: string() });
export const moveItemToFolderOperation = strictObject({ type: literal("move_item_to_folder"), target: v2ItemTarget, folderId: folderReference });
export const deleteProjectItemOperation = strictObject({ type: literal("delete_project_item"), target: v2ItemTarget, destructive: literal(true) });
export const importFileOperation = strictObject({
  type: literal("import_file"), newItemId: string(), ...planIdentity, path: string(),
  importAs: optional(literal("auto", "footage", "composition", "composition-cropped-layers", "project")),
  destinationFolderId: optional(folderReference), sequence: optional(boolean()), forceAlphabetical: optional(boolean()),
});
export const replaceFootageOperation = strictObject({ type: literal("replace_footage"), target: v2ItemTarget, path: string() });
export const setFootageProxyOperation = strictObject({ type: literal("set_footage_proxy"), target: v2ItemTarget, path: string() });
export const clearFootageProxyOperation = strictObject({ type: literal("clear_footage_proxy"), target: v2ItemTarget });
export const setFootageInterpretationOperation = strictObject({ type: literal("set_footage_interpretation"), target: v2ItemTarget, interpretation: footageInterpretation });
export const detectSceneEditsOperation = strictObject({ type: literal("detect_scene_edits"), target: v2Target, mode: literal(...SCENE_EDIT_MODES) });
export const renderCompositionOperation = strictObject({
  type: literal("render_composition"), compositionId: string(), ...planIdentity, renderSettingsTemplate: optional(string()), outputModuleTemplate: optional(string()), outputPath: string(),
  destinationPolicy: literal("explicit-local-path"), executeAuthorization: optional(literal("RENDER_NOW")), outputSettings: optional(renderOutputSettings), renderSettings: optional(renderQueueSettings),
  mediaEncoder: optional(literal(...MEDIA_ENCODER_MODES)),
});
export const createCompositionOperation = strictObject({ type: literal("create_composition"), newCompositionId: string(), ...planIdentity, name: string(), width: number(), height: number(), durationSeconds: number(), frameRate: number() });
export const duplicateCompositionOperation = strictObject({ type: literal("duplicate_composition"), target: v2CompositionTarget, newCompositionId: string(), name: optional(string()) });
export const setCompositionSettingsOperation = strictObject({ type: literal("set_composition_settings"), target: v2CompositionTarget, settings: compositionSettings });
export const setCompositionGuidesOperation = strictObject({
  type: literal("set_composition_guides"), target: v2CompositionTarget,
  guides: array(strictObject({ orientation: literal("horizontal", "vertical"), position: number() })), replace: optional(boolean()),
});
export const openCompositionOperation = strictObject({ type: literal("open_composition"), target: v2CompositionTarget });
export const exportFrameOperation = strictObject({
  type: literal("export_frame"), target: v2CompositionTarget, time: number(), outputPath: string(), overwrite: optional(boolean()), resolution: optional(number()), exportAuthorization,
});
export const exportMogrtOperation = strictObject({ type: literal("export_mogrt"), target: v2CompositionTarget, templateName: string(), outputPath: string(), overwrite: optional(boolean()), exportAuthorization });
export const saveProjectOperation = strictObject({ type: literal("save_project"), ...planIdentity, mode: literal("save", "save_as", "increment"), path: optional(string()), overwrite: optional(boolean()) });
export const setProjectSettingsOperation = strictObject({ type: literal("set_project_settings"), ...planIdentity, settings: projectSettings });
export const collectProjectOperation = strictObject({ type: literal("collect_project"), ...planIdentity, destinationFolder: string(), projectName: string(), exportAuthorization });
export const switchProjectOperation = strictObject({ type: literal("switch_project"), ...planIdentity, mode: literal("new", "open"), path: optional(string()), discardUnsaved: optional(boolean()) });
export const cleanupProjectOperation = strictObject({ type: literal("cleanup_project"), ...planIdentity, mode: literal(...CLEANUP_MODES), compositionIds: optional(array(string())), destructive: literal(true) });

export type RenderOutputSettings = Infer<typeof renderOutputSettings>;
export type RenderQueueSettings = Infer<typeof renderQueueSettings>;
export type FootageInterpretationValues = Infer<typeof footageInterpretation>;
export type CompositionSettingsFields = Infer<typeof compositionSettings>;
export type CleanupMode = (typeof CLEANUP_MODES)[number];
export type CreateFolderOperation = Infer<typeof createFolderOperation>;
export type SetItemNameOperation = Infer<typeof setItemNameOperation>;
export type MoveItemToFolderOperation = Infer<typeof moveItemToFolderOperation>;
export type DeleteProjectItemOperation = Infer<typeof deleteProjectItemOperation>;
export type ImportFileOperation = Infer<typeof importFileOperation>;
export type ReplaceFootageOperation = Infer<typeof replaceFootageOperation>;
export type SetFootageProxyOperation = Infer<typeof setFootageProxyOperation>;
export type ClearFootageProxyOperation = Infer<typeof clearFootageProxyOperation>;
export type SetFootageInterpretationOperation = Infer<typeof setFootageInterpretationOperation>;
export type DetectSceneEditsOperation = Infer<typeof detectSceneEditsOperation>;
export type RenderCompositionOperation = Infer<typeof renderCompositionOperation>;
export type CreateCompositionOperation = Infer<typeof createCompositionOperation>;
export type DuplicateCompositionOperation = Infer<typeof duplicateCompositionOperation>;
export type SetCompositionSettingsOperation = Infer<typeof setCompositionSettingsOperation>;
export type SetCompositionGuidesOperation = Infer<typeof setCompositionGuidesOperation>;
export type OpenCompositionOperation = Infer<typeof openCompositionOperation>;
export type ExportFrameOperation = Infer<typeof exportFrameOperation>;
export type ExportMogrtOperation = Infer<typeof exportMogrtOperation>;
export type SaveProjectOperation = Infer<typeof saveProjectOperation>;
export type SetProjectSettingsOperation = Infer<typeof setProjectSettingsOperation>;
export type CollectProjectOperation = Infer<typeof collectProjectOperation>;
export type SwitchProjectOperation = Infer<typeof switchProjectOperation>;
export type CleanupProjectOperation = Infer<typeof cleanupProjectOperation>;
