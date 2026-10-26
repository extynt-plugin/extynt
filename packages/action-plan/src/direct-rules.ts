// The rule table for the operation kinds that do their own target checking: the project, a composition, or a layer family with a
// fixed field set. operation-rules.ts merges it with the layer-grounded and extended tables.
import { validateCreateComposition, validateDuplicateComposition, validateRenderComposition } from "./composition-rules.js";
import { validateCompositionSettings } from "./composition-settings-rules.js";
import { validateClearFootageProxy, validateFootageWithPath, validateSetFootageInterpretation } from "./footage-rules.js";
import { validateDuplicateLayer, validateRemoveLayer, validateReorderLayer, validateSetTrackMatte } from "./layer-structure-rules.js";
import type { KindValidator, OperationRule } from "./layer-targets.js";
import { validateAddMarker, validateRemoveMarker, validateUpdateMarker } from "./marker-rules.js";
import { validateAddMask, validateRemoveMask, validateUpdateMask } from "./mask-rules.js";
import type { ActionPlanV2Operation } from "./plan-types.js";
import { validateCreateFolder, validateDeleteProjectItem, validateImportFile, validateMoveItemToFolder, validateSetItemName } from "./project-item-rules.js";
import { validateDetectSceneEdits } from "./scene-edit-rules.js";
import { validateCreateShapeGroup, validateEnsureShapeFill, validateEnsureShapeStroke, validateSetShapePath } from "./shape-group-rules.js";
import { validateCameraOptions, validateLightOptions, validateMaterialOptions } from "./three-d-option-rules.js";
import { validateCreateVectorArtwork } from "./vector-artwork-rules.js";
import { validateVectorShapes } from "./vector-shape-rules.js";

const direct = (validate: KindValidator) => ({ grounded: false, validate }) as const;

/** The rule for each operation kind that validates its own target. */
export const DIRECT_RULES = {
  create_composition: direct(validateCreateComposition),
  duplicate_composition: direct(validateDuplicateComposition),
  render_composition: direct(validateRenderComposition),
  create_folder: direct(validateCreateFolder),
  import_file: direct(validateImportFile),
  create_vector_artwork: direct(validateCreateVectorArtwork),
  set_item_name: direct(validateSetItemName),
  move_item_to_folder: direct(validateMoveItemToFolder),
  delete_project_item: direct(validateDeleteProjectItem),
  replace_footage: direct(validateFootageWithPath),
  set_footage_proxy: direct(validateFootageWithPath),
  clear_footage_proxy: direct(validateClearFootageProxy),
  set_footage_interpretation: direct(validateSetFootageInterpretation),
  duplicate_layer: direct(validateDuplicateLayer),
  remove_layer: direct(validateRemoveLayer),
  reorder_layer: direct(validateReorderLayer),
  set_track_matte: direct(validateSetTrackMatte),
  add_mask: direct(validateAddMask),
  update_mask: direct(validateUpdateMask),
  remove_mask: direct(validateRemoveMask),
  create_shape_group: direct(validateCreateShapeGroup),
  set_shape_path: direct(validateSetShapePath),
  ensure_shape_fill: direct(validateEnsureShapeFill),
  ensure_shape_stroke: direct(validateEnsureShapeStroke),
  draw_vector_shapes: direct(validateVectorShapes),
  set_camera_options: direct(validateCameraOptions),
  set_light_options: direct(validateLightOptions),
  set_material_options: direct(validateMaterialOptions),
  set_composition_settings: direct(validateCompositionSettings),
  add_marker: direct(validateAddMarker),
  update_marker: direct(validateUpdateMarker),
  remove_marker: direct(validateRemoveMarker),
  detect_scene_edits: direct(validateDetectSceneEdits),
} as const satisfies Readonly<Partial<Record<ActionPlanV2Operation["type"], OperationRule>>>;
