// The verdicts for the operations that decide how layers stack: reorder_layer and set_track_matte.
import { layerReorderedLater } from "./later-steps.js";
import { replayedLayerPosition } from "./layer-stack-replay.js";
import type { SnapshotLayer } from "./snapshot-reply.js";
import { layerIn, layerWhere, realLayerId } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";
import { exactStep, failedStep, judged, unverifiedStep } from "./verdicts.js";
import type { Details, VerifiedStep } from "./verdicts.js";

interface Placement {
  readonly state: LayerState;
  readonly reference: SnapshotLayer | null;
}

const NET_REASON = "later stack operations in this batch (new layers go on top) moved the layer from where the reorder put it; the final order equals the batch replayed in order";

const PLACEMENTS: Readonly<Record<string, (placement: Placement) => boolean>> = {
  beginning: ({ state }) => state.layer.index === 1,
  end: ({ state }) => state.comp.truncated !== true && state.comp.layers !== undefined && state.layer.index === state.comp.layers.length,
  before: ({ state, reference }) => reference?.index !== undefined && state.layer.index === reference.index - 1,
  after: ({ state, reference }) => reference?.index !== undefined && state.layer.index === reference.index + 1,
};

function netLayerOrder(state: LayerState): VerifiedStep | null {
  const net = replayedLayerPosition(state);
  const kind = state.request.operation;
  const where = layerWhere(state);
  if (net?.verdict === "match") return exactStep(kind, "layer-order-net-of-batch", { ...where, expectedIndex: net.expected, reason: NET_REASON });
  return net?.verdict === "unknown" ? unverifiedStep(kind, "layer-order-depends-on-copied-layer-placement", where) : null;
}

function placedAsAsked(state: LayerState, reference: SnapshotLayer | null): boolean {
  return PLACEMENTS[state.request.placement ?? ""]?.({ state, reference }) === true;
}

function referenceUnreadable(state: LayerState, reference: SnapshotLayer | null): boolean {
  const placement = state.request.placement;
  return state.comp.truncated === true || ((placement === "before" || placement === "after") && !reference);
}

/** The verdict for reorder_layer: where the layer sits, then the batch's own stack operations replayed in order. */
export function verifyLayerOrder(state: LayerState): VerifiedStep {
  const { ctx, request, comp } = state;
  const kind = request.operation;
  const where = layerWhere(state);
  const reference = layerIn(comp, realLayerId(ctx, state.compId, request.referenceLayerId));
  if (placedAsAsked(state, reference)) return exactStep(kind, "layer-order", where);
  if (referenceUnreadable(state, reference)) return unverifiedStep(kind, "layer-order-reference-not-in-snapshot", where);
  const net = netLayerOrder(state);
  if (net) return net;
  return layerReorderedLater(state) ? unverifiedStep(kind, "layer-order-superseded-by-later-reorder", where) : failedStep(kind, "layer-order-mismatch", where);
}

function matteSourceDetails(source: SnapshotLayer | null, expected: string | null | undefined): Details {
  const enabled = source && typeof source.enabled === "boolean" ? source.enabled : null;
  return enabled === null ? {} : { matteSourceEnabled: enabled, ...(enabled ? {} : { matteSourceNote: `matte source ${source?.name || expected} is hidden (After Effects hides a layer used as a matte); showMatteLayer: true keeps it rendering` }) };
}

function hiddenMatteStep(kind: string, where: Details, source: SnapshotLayer | null, expected: string | undefined): VerifiedStep {
  const enabled = source && typeof source.enabled === "boolean" ? source.enabled : null;
  const note = `showMatteLayer was requested but matte source ${source?.name || expected} is not enabled`;
  return failedStep(kind, "track-matte-source-hidden", { ...where, matteSourceEnabled: enabled, matteSourceNote: note });
}

/** The verdict for set_track_matte: the matte layer and mode, and a matte source that stays visible when it was asked to. */
export function verifyTrackMatte(state: LayerState): VerifiedStep {
  const { ctx, request, layer, comp } = state;
  const kind = request.operation;
  const where = layerWhere(state);
  if (request.matteLayerId === null) return judged(layer.matteType === "none", kind, { pass: "track-matte-cleared", fail: "track-matte-not-cleared" }, where);
  const expected = realLayerId(ctx, state.compId, request.matteLayerId);
  if (layer.matteLayerId !== expected || layer.matteType !== request.mode) return failedStep(kind, "track-matte-mismatch", where);
  const source = layerIn(comp, expected);
  const details = matteSourceDetails(source, expected);
  if (request.showMatteLayer === true && details.matteSourceEnabled !== true) return hiddenMatteStep(kind, where, source, expected);
  return exactStep(kind, "track-matte-layer-and-mode", { ...where, ...details });
}
