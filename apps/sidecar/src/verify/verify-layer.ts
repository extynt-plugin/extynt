// The verdict for an operation on a layer: the layer's presence in the fresh read, then the verifier for the operation's kind.
import { hostVerification } from "./host-step.js";
import { verifyEvidenceOnly, verifyPreset, verifyShapeReadback, verifyTextAnimator } from "./layer-evidence.js";
import { verifyCreateLayer, verifyLayerAttribute, verifyLayerName, verifyLayerParent, verifyLayerTiming } from "./layer-fields.js";
import { verifyLayerOrder, verifyTrackMatte } from "./layer-order.js";
import { verifyEssentialProperty, verifyRemoveMask, verifyTimeRemap } from "./layer-readbacks.js";
import { verifyAudio, verifyEffectControl, verifyLayerStyle, verifyMaterialOptions, verifyThreeDOptions } from "./layer-slots.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { verifyLayerMarker } from "./verify-markers.js";
import { foundLayer, layerWhere, lookupLayer } from "./verify-context.js";
import type { LayerLookup, LayerState, VerifyContext } from "./verify-context.js";
import { verifyDollyCamera } from "./verify-camera.js";
import { verifyDeriveLayer, verifyRetimeLayer } from "./verify-derive.js";
import {
  verifyCenterAnchor,
  verifyCopyEffects,
  verifyEditKeyframes,
  verifyRemoveEffect,
  verifyReorderEffect,
  verifyReplaceLayerSource,
  verifyResizeSolid,
  verifySaveLayerPreset,
  verifyTextPath,
} from "./verify-host-evidence.js";
import { verifyReadKeyframes } from "./verify-keyframes.js";
import { verifyMaskReadback } from "./verify-mask.js";
import { verifyPropertyOperation } from "./verify-property.js";
import { verifyPuppetPins, wrappedInPuppetCarrier } from "./verify-puppet.js";
import { verifyStructured } from "./verify-structured.js";
import { verifyTextDocument } from "./verify-text.js";

type LayerVerifier = (state: LayerState) => VerifiedStep | null;

function layerExists(state: LayerState): VerifiedStep {
  return exactStep(state.request.operation, "layer-exists", layerWhere(state));
}

const VERIFIERS: Readonly<Record<string, LayerVerifier>> = {
  duplicate_layer: layerExists,
  derive_layer: verifyDeriveLayer,
  retime_layer: verifyRetimeLayer,
  dolly_camera: verifyDollyCamera,
  set_puppet_pins: verifyPuppetPins,
  read_keyframes: verifyReadKeyframes,
  create_layer: verifyCreateLayer,
  set_layer_name: verifyLayerName,
  set_layer_parent: verifyLayerParent,
  set_layer_timing: verifyLayerTiming,
  set_layer_attribute: verifyLayerAttribute,
  reorder_layer: verifyLayerOrder,
  set_track_matte: verifyTrackMatte,
  set_camera_options: verifyThreeDOptions,
  set_light_options: verifyThreeDOptions,
  set_material_options: verifyMaterialOptions,
  set_audio: verifyAudio,
  set_text_document: verifyTextDocument,
  ensure_layer_style: verifyLayerStyle,
  apply_preset: verifyPreset,
  add_text_animator: verifyStructured,
  update_text_animator: verifyStructured,
  add_shape_item: verifyStructured,
  update_shape_item: verifyStructured,
  set_effect_control: verifyEffectControl,
  ensure_effect: verifyPropertyOperation,
  set_layer_property: verifyPropertyOperation,
  set_expression: verifyPropertyOperation,
  animate_property: verifyPropertyOperation,
  animate_control: verifyPropertyOperation,
  add_marker: verifyLayerMarker,
  update_marker: verifyLayerMarker,
  remove_marker: verifyLayerMarker,
  ensure_text_animator: verifyTextAnimator,
  add_mask: verifyMaskReadback,
  update_mask: verifyMaskReadback,
  remove_mask: verifyRemoveMask,
  add_essential_property: verifyEssentialProperty,
  create_shape_group: verifyShapeReadback,
  set_shape_path: verifyShapeReadback,
  ensure_shape_fill: verifyShapeReadback,
  ensure_shape_stroke: verifyShapeReadback,
  draw_vector_shapes: verifyShapeReadback,
  set_time_remap: verifyTimeRemap,
  detect_scene_edits: verifyEvidenceOnly,
  center_anchor: verifyCenterAnchor,
  reorder_effect: verifyReorderEffect,
  remove_effect: verifyRemoveEffect,
  resize_solid: verifyResizeSolid,
  set_text_path: verifyTextPath,
  replace_layer_source: verifyReplaceLayerSource,
  save_layer_preset: verifySaveLayerPreset,
  copy_effects: verifyCopyEffects,
  edit_keyframes: verifyEditKeyframes,
};

function removalVerdict(lookup: LayerLookup): VerifiedStep {
  const kind = lookup.request.operation;
  const { comp } = lookup;
  const layerId = lookup.layerId ?? null;
  if (lookup.layer && comp) return failedStep(kind, "layer-still-present", { compositionId: comp.id, layerId });
  if (!comp) return unverifiedStep(kind, "composition-not-in-snapshot", { compositionId: null, layerId });
  if (comp.truncated === true) return unverifiedStep(kind, "composition-layers-truncated", { compositionId: comp.id, layerId });
  return exactStep(kind, "layer-absent", { compositionId: comp.id, layerId });
}

function absentVerdict(lookup: LayerLookup): VerifiedStep {
  return wrappedInPuppetCarrier(lookup) ?? failedStep(lookup.request.operation, "layer-missing", { compositionId: lookup.comp?.id ?? null, layerId: lookup.layerId ?? null });
}

/** The verdict for the layer operation at `index`, or null when its verifier has no claim to make. */
export function verifyLayerOperation(ctx: VerifyContext, index: number): VerifiedStep | null {
  const lookup = lookupLayer(ctx, index);
  if (lookup.request.operation === "remove_layer") return removalVerdict(lookup);
  const state = foundLayer(lookup);
  if (!state) return absentVerdict(lookup);
  const verifier = VERIFIERS[state.request.operation];
  if (verifier) return verifier(state);
  return unverifiedStep(state.request.operation, "host-layer-evidence-state-not-in-snapshot", { ...layerWhere(state), ...hostVerification(state.step) });
}
