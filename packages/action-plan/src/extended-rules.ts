// The rule table for the composition-level, layer-derived and project-level operation kinds, none of which grounds its own target.
// operation-rules.ts merges this table with the direct and layer tables.
import { validateDollyCamera } from "./camera-dolly.js";
import { validateAddEssentialProperty } from "./essential-property-rules.js";
import { validatePrecomposeLayers, validateExportMogrt, validateExportFrame, validateSaveProject, validateSetCompositionGuides, validateSetProjectSettings } from "./extended-composition-ops.js";
import { validateRemoveEffect, validateReorderEffect } from "./effect-edit-ops.js";
import { validateEditKeyframes, validateReadKeyframes } from "./keyframe-edit-ops.js";
import { validateCenterAnchor, validateCopyEffects, validateReplaceLayerSource } from "./layer-more-ops.js";
import { validateDeriveLayer, validateRetimeLayer } from "./layer-derive-ops.js";
import type { OperationRule } from "./layer-targets.js";
import { validateCollectProject, validateOpenComposition, validateResizeSolid, validateSaveLayerPreset, validateSetTextPath, validateStartAnalysis, validateSwitchProject, validateTrackerToNulls } from "./misc-ops.js";
import { validateCleanupProject } from "./output-cleanup-ops.js";
import type { ActionPlanV2Operation } from "./plan-types.js";
import { validateSetPuppetPins } from "./puppet-pin-ops.js";
import { validateAddShapeItem, validateUpdateShapeItem } from "./shape-item-rules.js";
import { validateAddTextAnimator, validateUpdateTextAnimator } from "./text-animator-rules.js";

/** The rules of the operation kinds that ground their own target (or have none), keyed by operation type. */
export const EXTENDED_RULES = {
  precompose_layers: { grounded: false, validate: validatePrecomposeLayers },
  add_text_animator: { grounded: false, validate: validateAddTextAnimator },
  update_text_animator: { grounded: false, validate: validateUpdateTextAnimator },
  add_shape_item: { grounded: false, validate: validateAddShapeItem },
  update_shape_item: { grounded: false, validate: validateUpdateShapeItem },
  add_essential_property: { grounded: false, validate: validateAddEssentialProperty },
  export_mogrt: { grounded: false, validate: validateExportMogrt },
  export_frame: { grounded: false, validate: validateExportFrame },
  save_project: { grounded: false, validate: validateSaveProject },
  set_composition_guides: { grounded: false, validate: validateSetCompositionGuides },
  set_project_settings: { grounded: false, validate: validateSetProjectSettings },
  derive_layer: { grounded: false, validate: validateDeriveLayer },
  retime_layer: { grounded: false, validate: validateRetimeLayer },
  dolly_camera: { grounded: false, validate: validateDollyCamera },
  edit_keyframes: { grounded: false, validate: validateEditKeyframes },
  read_keyframes: { grounded: false, validate: validateReadKeyframes },
  set_puppet_pins: { grounded: false, validate: validateSetPuppetPins },
  resize_solid: { grounded: false, validate: validateResizeSolid },
  tracker_to_nulls: { grounded: false, validate: validateTrackerToNulls },
  collect_project: { grounded: false, validate: validateCollectProject },
  switch_project: { grounded: false, validate: validateSwitchProject },
  save_layer_preset: { grounded: false, validate: validateSaveLayerPreset },
  set_text_path: { grounded: false, validate: validateSetTextPath },
  open_composition: { grounded: false, validate: validateOpenComposition },
  start_analysis: { grounded: false, validate: validateStartAnalysis },
  replace_layer_source: { grounded: false, validate: validateReplaceLayerSource },
  center_anchor: { grounded: false, validate: validateCenterAnchor },
  copy_effects: { grounded: false, validate: validateCopyEffects },
  remove_effect: { grounded: false, validate: validateRemoveEffect },
  reorder_effect: { grounded: false, validate: validateReorderEffect },
  cleanup_project: { grounded: false, validate: validateCleanupProject },
} as const satisfies Readonly<Partial<Record<ActionPlanV2Operation["type"], OperationRule>>>;
