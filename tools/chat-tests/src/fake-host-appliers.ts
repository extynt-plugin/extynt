/** Which applier handles each typed plan operation the fixture models. */

import { applyAnimateProperty, applySetExpression } from "./fake-host-animate.js";
import { applyAddTextAnimator, applyUpdateTextAnimator } from "./fake-host-animators.js";
import { applyCreateComposition, applySetCompositionSettings } from "./fake-host-compositions.js";
import type { ApplyOutcome, FixtureApplyContext } from "./fake-host-context.js";
import { applyCreateLayer } from "./fake-host-create-layer.js";
import { applyAnimateControl, applyEnsureEffect, applyEnsureLayerStyle, applySetEffectControl } from "./fake-host-effect-ops.js";
import { applySetLayerAttribute, applySetLayerName, applySetLayerProperty, applySetLayerTiming } from "./fake-host-layers.js";
import { applyAddMask, applyUpdateMask } from "./fake-host-masks.js";
import { applyMarkerWrite, applyRemoveMarker } from "./fake-host-markers.js";
import { applyAddEssentialProperty, applyThreeDOptions } from "./fake-host-options.js";
import { applyAddShapeItem, applyCreateShapeGroup, applyEnsureShapeFill, applyEnsureShapeStroke, applySetShapePath, applyUpdateShapeItem } from "./fake-host-shapes.js";
import { applyDuplicateLayer, applyRemoveLayer, applyReorderLayer, applySetLayerParent, applySetTextDocument, applySetTrackMatte } from "./fake-host-structure.js";
import { applyDrawVectorShapes } from "./fake-host-vector.js";
import type { WireObject } from "./wire-types.js";

type Applier = (context: FixtureApplyContext, operation: WireObject) => ApplyOutcome;

/** The applier for each operation type, by name. */
export const APPLIERS: Readonly<Record<string, Applier>> = {
  create_composition: applyCreateComposition,
  create_layer: applyCreateLayer,
  create_shape_group: applyCreateShapeGroup,
  add_shape_item: applyAddShapeItem,
  update_shape_item: applyUpdateShapeItem,
  set_shape_path: applySetShapePath,
  ensure_shape_fill: applyEnsureShapeFill,
  ensure_shape_stroke: applyEnsureShapeStroke,
  draw_vector_shapes: applyDrawVectorShapes,
  set_composition_settings: applySetCompositionSettings,
  set_layer_name: applySetLayerName,
  set_layer_parent: applySetLayerParent,
  set_layer_timing: applySetLayerTiming,
  set_layer_property: applySetLayerProperty,
  set_layer_attribute: applySetLayerAttribute,
  animate_property: applyAnimateProperty,
  animate_control: applyAnimateControl,
  set_expression: applySetExpression,
  ensure_effect: applyEnsureEffect,
  ensure_layer_style: applyEnsureLayerStyle,
  set_effect_control: applySetEffectControl,
  add_mask: applyAddMask,
  update_mask: applyUpdateMask,
  add_marker: (context, operation) => applyMarkerWrite(context, operation, "add_marker"),
  update_marker: (context, operation) => applyMarkerWrite(context, operation, "update_marker"),
  remove_marker: applyRemoveMarker,
  reorder_layer: applyReorderLayer,
  duplicate_layer: applyDuplicateLayer,
  remove_layer: applyRemoveLayer,
  set_track_matte: applySetTrackMatte,
  set_text_document: applySetTextDocument,
  set_camera_options: (context, operation) => applyThreeDOptions(context, operation, "set_camera_options"),
  set_light_options: (context, operation) => applyThreeDOptions(context, operation, "set_light_options"),
  set_material_options: (context, operation) => applyThreeDOptions(context, operation, "set_material_options"),
  add_essential_property: applyAddEssentialProperty,
  add_text_animator: applyAddTextAnimator,
  update_text_animator: applyUpdateTextAnimator,
};
