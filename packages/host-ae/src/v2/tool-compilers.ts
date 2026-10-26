// Compilers for the whole-tool kinds: derive and retime, dolly, keyframe and effect edits, analysis, puppet pins and project switching.
import { keyframeEditAction, resolveCurve, type DollyKeyframe } from "@extynt/action-plan";
import type { DollyHostKeyframe, KeyframeAdjustment, KeyframeSelection } from "../host-tool-operations.js";
import { compilerTable, refuse, type HostOutcome, type OperationOf } from "./compiler-table.js";
import { layerRef } from "./host-values.js";

type EditKeyframesOperation = OperationOf<"edit_keyframes">;

function dollyKeyframe({ time, distance, curve }: DollyKeyframe): DollyHostKeyframe {
  return { time, distance, ...(curve === undefined ? {} : { curve: resolveCurve(curve) }) };
}

function keyframeSelection(operation: EditKeyframesOperation): KeyframeSelection {
  return {
    ...(operation.times === undefined ? {} : { times: operation.times }),
    ...(operation.indices === undefined ? {} : { indices: operation.indices }),
    ...(operation.all === undefined ? {} : { all: operation.all }),
    ...(operation.source === undefined ? {} : { source: operation.source }),
  };
}

function keyframeAdjustment(operation: EditKeyframesOperation): KeyframeAdjustment {
  return {
    ...(operation.offset === undefined ? {} : { offset: operation.offset }),
    ...(operation.about === undefined ? {} : { about: operation.about }),
    ...(operation.factor === undefined ? {} : { factor: operation.factor }),
    ...(operation.timeOffset === undefined ? {} : { timeOffset: operation.timeOffset }),
    ...(operation.keyframeMode === undefined ? {} : { keyframeMode: operation.keyframeMode }),
  };
}

function editKeyframesOperation(operation: EditKeyframesOperation): HostOutcome {
  const action = keyframeEditAction(operation);
  if (action === undefined) return refuse("INVALID_OPERATION", "edit_keyframes names no action and none can be inferred from its fields.");
  return { operation: "edit_keyframes", ...layerRef(operation.target), propertyPath: operation.target.propertyPath, action, ...keyframeSelection(operation), ...keyframeAdjustment(operation) };
}

export const KEYFRAME_COMPILERS = compilerTable({
  derive_layer: (operation) => ({ operation: "derive_layer", ...layerRef(operation.target), kind: operation.kind, newLayerId: operation.newLayerId, time: operation.time, propertyPath: operation.target.propertyPath, pointIndex: operation.pointIndex, pointKind: operation.pointKind, name: operation.name }),
  retime_layer: (operation) => ({ operation: "retime_layer", ...layerRef(operation.target), mode: operation.mode, time: operation.time }),
  dolly_camera: (operation) => ({ operation: "dolly_camera", ...layerRef(operation.target), keyframes: operation.keyframes.map(dollyKeyframe) }),
  edit_keyframes: editKeyframesOperation,
  read_keyframes: (operation) => ({ operation: "read_keyframes", ...layerRef(operation.target), propertyPath: operation.target.propertyPath, ...(operation.maxKeys === undefined ? {} : { maxKeys: operation.maxKeys }) }),
  remove_effect: (operation) => ({ operation: "remove_effect", ...layerRef(operation.target), effectPath: operation.target.effectPath ?? "", destructive: true }),
  reorder_effect: (operation) => ({ operation: "reorder_effect", ...layerRef(operation.target), effectPath: operation.target.effectPath ?? "", index: operation.index }),
  copy_effects: (operation) => ({ operation: "copy_effects", ...layerRef(operation.target), source: operation.source, ...(operation.effectPaths === undefined ? {} : { effectPaths: operation.effectPaths }) }),
});

export const TOOL_COMPILERS = compilerTable({
  tracker_to_nulls: (operation) => ({ operation: "tracker_to_nulls", ...layerRef(operation.target), ...(operation.trackerName === undefined ? {} : { trackerName: operation.trackerName }), point: operation.point ?? "attach-point" }),
  save_layer_preset: (operation) => ({ operation: "save_layer_preset", ...layerRef(operation.target), ...(operation.effectPaths === undefined ? {} : { effectPaths: operation.effectPaths }), outputPath: operation.outputPath, overwrite: operation.overwrite ?? false, exportAuthorization: operation.exportAuthorization }),
  resize_solid: (operation) => ({ operation: "resize_solid", ...layerRef(operation.target), ...(operation.width === undefined ? {} : { width: operation.width }), ...(operation.height === undefined ? {} : { height: operation.height }), ...(operation.pixelAspect === undefined ? {} : { pixelAspect: operation.pixelAspect }), allUsers: operation.allUsers ?? false }),
  set_text_path: (operation) => ({ operation: "set_text_path", ...layerRef(operation.target), ...(operation.maskIndex === undefined ? {} : { maskIndex: operation.maskIndex }), ...(operation.firstMargin === undefined ? {} : { firstMargin: operation.firstMargin }), ...(operation.lastMargin === undefined ? {} : { lastMargin: operation.lastMargin }) }),
  start_analysis: (operation) => ({ operation: "start_analysis", ...layerRef(operation.target), kind: operation.kind }),
  replace_layer_source: (operation) => ({ operation: "replace_layer_source", ...layerRef(operation.target), sourceItemId: operation.sourceItemId }),
  center_anchor: (operation) => ({ operation: "center_anchor", ...layerRef(operation.target), ...(operation.time === undefined ? {} : { time: operation.time }) }),
  set_puppet_pins: (operation) => ({ operation: "set_puppet_pins", ...layerRef(operation.target), pins: operation.pins, ...(operation.relative === true ? { relative: true } : {}) }),
  switch_project: (operation) => ({ operation: "switch_project", mode: operation.mode, ...(operation.path === undefined ? {} : { path: operation.path }), discardUnsaved: operation.discardUnsaved ?? false }),
  collect_project: (operation) => ({ operation: "collect_project", destinationFolder: operation.destinationFolder, projectName: operation.projectName, exportAuthorization: operation.exportAuthorization }),
  open_composition: (operation) => ({ operation: "open_composition", compositionId: operation.target.compositionId }),
});
