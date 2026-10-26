// Steps later in the same batch that change what an earlier step reads back from the final snapshot.
import { firstLaterIndex, realLayerId } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const PARENT_COMPENSATED_PATH = /ADBE (Position(_\d)?|Anchor Point|Scale|Rotat(e [XYZ]|ion)|Orientation)$/;

/** Whether this layer is now another layer's matte through a set_track_matte later in the same batch. */
export function hiddenAsLaterMatte(state: LayerState): boolean {
  const becameMatte = (state.comp.layers ?? []).some((other) => other.matteLayerId === state.layer.id);
  return becameMatte && firstLaterIndex(state.ctx, state.index, (later) => later.step.operation === "set_track_matte") >= 0;
}

/** A later reorder in the same composition moves layers again, so the final snapshot cannot judge this step. */
export function layerReorderedLater(state: LayerState): boolean {
  return firstLaterIndex(state.ctx, state.index, (later) => later.step.operation === "reorder_layer" && later.step.compositionId === state.comp.id) >= 0;
}

/**
 * The index of a set_layer_parent later in the same batch that re-parents this step's layer, when this step wrote a
 * transform property the parent change compensates (After Effects rewrites those to keep the layer where it is); -1 otherwise.
 */
export function compensatingParentIndex(state: LayerState): number {
  const { request, step, ctx, index } = state;
  if (request.operation !== "set_layer_property" || !PARENT_COMPENSATED_PATH.test(request.propertyPath ?? "")) return -1;
  const own = realLayerId(ctx, state.compId, request.layerId || step.layerId);
  return firstLaterIndex(ctx, index, (later) => later.step.operation === "set_layer_parent" && later.step.compositionId === step.compositionId && realLayerId(ctx, later.step.compositionId, later.step.layerId) === own);
}
