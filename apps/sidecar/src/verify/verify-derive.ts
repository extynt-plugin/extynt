// The verdicts for derive_layer and retime_layer: the layer the command made is read from the fresh snapshot, never trusted from the host's step.
import { KEY_TIME_TOLERANCE } from "./compare-values.js";
import { findByPath } from "./snapshot-index.js";
import type { SnapshotLayer } from "./snapshot-reply.js";
import { exactStep, failedStep, unverifiedStep } from "./verdicts.js";
import type { VerifiedStep } from "./verdicts.js";
import { layerIn, layerKey, realLayerId } from "./verify-context.js";
import type { LayerState } from "./verify-context.js";

const POSITION_PATH = "ADBE Transform Group/ADBE Position";
const TIME_REMAP_PATH = "ADBE Time Remapping";

const RESULT_TYPES: Readonly<Record<string, string>> = { "audio-keyframes": "null", "shapes-from-vector": "shape", "shapes-from-text": "shape", "path-null": "null" };

function close(left: number | undefined, right: number | undefined): boolean {
  return left !== undefined && right !== undefined && Math.abs(left - right) <= KEY_TIME_TOLERANCE;
}

function failedAt(state: LayerState, basis: string, layer: SnapshotLayer | null): VerifiedStep {
  return failedStep(state.request.operation, basis, { compositionId: state.comp.id, layerId: layer?.id ?? null });
}

function createdLayer(state: LayerState): SnapshotLayer | null {
  const requested = state.request.newLayerId ?? "";
  const id = state.ctx.ids.layers.get(layerKey(state.comp.id, requested)) || state.step.layerId || requested;
  return layerIn(state.comp, id);
}

function splitPointsMatch(state: LayerState, source: SnapshotLayer, created: SnapshotLayer): boolean {
  if (!close(created.inPoint, state.request.time) || !close(source.outPoint, state.request.time)) return false;
  return source.startTime === undefined || created.startTime === undefined || close(created.startTime, source.startTime);
}

function splitVerdict(state: LayerState, created: SnapshotLayer, source: SnapshotLayer): VerifiedStep {
  const kind = state.request.operation;
  if (!splitPointsMatch(state, source, created)) return failedAt(state, "split-points-mismatch", created);
  if (created.type !== source.type) return failedAt(state, "split-type-mismatch", created);
  return exactStep(kind, "layer-split", { compositionId: state.comp.id, layerId: created.id, sourceLayerId: source.id });
}

function pathNullVerdict(state: LayerState, created: SnapshotLayer): VerifiedStep {
  const kind = state.request.operation;
  const where = { compositionId: state.comp.id, layerId: created.id };
  if (typeof state.request.name === "string" && created.name !== state.request.name) return failedAt(state, "path-null-name-mismatch", created);
  const position = findByPath(created.propertyPaths, POSITION_PATH);
  if (!position) return unverifiedStep(kind, "path-null-position-not-in-snapshot", where);
  return position.expressionEnabled === true ? exactStep(kind, "path-null-expression", where) : failedAt(state, "path-null-expression-missing", created);
}

/** The verdict for derive_layer. */
export function verifyDeriveLayer(state: LayerState): VerifiedStep {
  const { ctx, request, comp } = state;
  const created = createdLayer(state);
  const source = layerIn(comp, realLayerId(ctx, comp.id, request.layerId));
  if (!created || !source) return failedAt(state, "derived-layer-missing", created);
  if (request.kind === "split") return splitVerdict(state, created, source);
  if (created.type !== RESULT_TYPES[request.kind ?? ""]) return failedAt(state, "derived-layer-type-mismatch", created);
  if (request.kind === "path-null") return pathNullVerdict(state, created);
  return exactStep(request.operation, "derived-layer-exists", { compositionId: comp.id, layerId: created.id });
}

/** The verdict for retime_layer. */
export function verifyRetimeLayer(state: LayerState): VerifiedStep {
  const kind = state.request.operation;
  const remap = findByPath(state.layer.propertyPaths, TIME_REMAP_PATH);
  const where = { compositionId: state.comp.id, layerId: state.layer.id };
  if (!remap) return unverifiedStep(kind, "time-remap-not-in-snapshot", where);
  return (remap.keyframeCount ?? 0) >= 2 ? exactStep(kind, "time-remap-keys", where) : failedAt(state, "time-remap-keys-missing", state.layer);
}
