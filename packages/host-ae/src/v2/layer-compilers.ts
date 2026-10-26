// Compilers for the layer-scoped kinds: property writes, animation, layer state, structure, markers and precompose.
import { LAYER_SWITCHES, loopExpression, type MarkerTarget } from "@extynt/action-plan";
import { compilerTable } from "./compiler-table.js";
import { hostKeyframes, layerRef, validatedPropertyPath } from "./host-values.js";

type SwitchRole = keyof typeof LAYER_SWITCHES;

function isSwitchRole(role: string): role is SwitchRole {
  return Object.hasOwn(LAYER_SWITCHES, role);
}

function markerLayerId(target: MarkerTarget): string | undefined {
  return "layerId" in target ? target.layerId : undefined;
}

export const LAYER_WRITE_COMPILERS = compilerTable({
  set_layer_property: (operation) => ({ operation: "set_layer_property", ...layerRef(operation.target), propertyPath: operation.propertyPath, role: operation.role, value: operation.value }),
  set_layer_attribute: (operation) => ({ operation: "set_layer_attribute", ...layerRef(operation.target), role: operation.role, value: operation.value, ...(isSwitchRole(operation.role) ? { hostProperty: LAYER_SWITCHES[operation.role].host } : {}) }),
  set_layer_name: (operation) => ({ operation: "set_layer_name", ...layerRef(operation.target), name: operation.name }),
  set_layer_parent: (operation) => ({ operation: "set_layer_parent", ...layerRef(operation.target), parentLayerId: operation.parentLayerId }),
});

export const LAYER_ANIMATION_COMPILERS = compilerTable({
  animate_control: (operation) => ({ operation: "animate_control", ...layerRef(operation.target), effectMatchName: operation.effectMatchName, effectPath: operation.target.effectPath, propertyPath: validatedPropertyPath(operation.target), role: operation.role, keyframes: hostKeyframes(operation.keyframes), ...(operation.keyframeMode ? { keyframeMode: operation.keyframeMode } : {}), expression: operation.expression }),
  animate_property: (operation) => ({ operation: "animate_property", ...layerRef(operation.target), propertyPath: validatedPropertyPath(operation.target), role: operation.role, keyframes: hostKeyframes(operation.keyframes), ...(operation.keyframeMode ? { keyframeMode: operation.keyframeMode } : {}), expression: operation.expression }),
  set_expression: (operation) => ({ operation: "set_expression", ...layerRef(operation.target), propertyPath: validatedPropertyPath(operation.target), source: operation.source, enabled: operation.enabled }),
  set_loop: (operation) => ({ operation: "set_expression", ...layerRef(operation.target), propertyPath: validatedPropertyPath(operation.target), source: loopExpression(operation), enabled: true }),
});

export const LAYER_STATE_COMPILERS = compilerTable({
  create_layer: (operation) => ({ operation: "create_layer", ...layerRef(operation.target), layerType: operation.layerType, name: operation.name, text: operation.text, color: operation.color, box: operation.box, vertical: operation.vertical, justification: operation.justification, size: operation.size, sourceItemId: operation.sourceItemId }),
  set_layer_timing: (operation) => ({ operation: "set_layer_timing", ...layerRef(operation.target), inPoint: operation.inPoint, outPoint: operation.outPoint, startTime: operation.startTime, stretch: operation.stretch }),
  set_audio: (operation) => ({ operation: "set_audio", ...layerRef(operation.target), enabled: operation.enabled, levelDb: operation.levelDb }),
  set_time_remap: (operation) => ({ operation: "set_time_remap", ...layerRef(operation.target), enabled: operation.enabled }),
  set_footage_interpretation: (operation) => ({ operation: "set_footage_interpretation", itemId: operation.target.itemId, interpretation: operation.interpretation }),
  detect_scene_edits: (operation) => ({ operation: "detect_scene_edits", ...layerRef(operation.target), mode: operation.mode }),
  precompose_layers: (operation) => ({ operation: "precompose_layers", compositionId: operation.target.compositionId, layerIds: operation.layerIds, name: operation.name, newCompositionId: operation.newCompositionId, newLayerId: operation.newLayerId, moveAllAttributes: operation.moveAllAttributes ?? true }),
});

export const LAYER_STRUCTURE_COMPILERS = compilerTable({
  duplicate_layer: (operation) => ({ operation: "duplicate_layer", ...layerRef(operation.target), newLayerId: operation.newLayerId }),
  remove_layer: (operation) => ({ operation: "remove_layer", ...layerRef(operation.target), destructive: true }),
  reorder_layer: (operation) => ({ operation: "reorder_layer", ...layerRef(operation.target), placement: operation.placement, referenceLayerId: operation.referenceLayerId }),
  set_track_matte: (operation) => ({ operation: "set_track_matte", ...layerRef(operation.target), matteLayerId: operation.matteLayerId, mode: operation.mode, ...(operation.showMatteLayer === true ? { showMatteLayer: true } : {}) }),
});

export const MARKER_COMPILERS = compilerTable({
  add_marker: (operation) => ({ operation: "add_marker", compositionId: operation.target.compositionId, layerId: markerLayerId(operation.target), time: operation.time, comment: operation.comment, duration: operation.duration, chapter: operation.chapter, url: operation.url, cuePointName: operation.cuePointName, label: operation.label }),
  update_marker: (operation) => ({ operation: "update_marker", compositionId: operation.target.compositionId, layerId: markerLayerId(operation.target), time: operation.time, comment: operation.comment, duration: operation.duration, chapter: operation.chapter, url: operation.url, cuePointName: operation.cuePointName, label: operation.label }),
  remove_marker: (operation) => ({ operation: "remove_marker", compositionId: operation.target.compositionId, layerId: markerLayerId(operation.target), time: operation.time, destructive: true }),
});
