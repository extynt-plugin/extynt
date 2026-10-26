// Warning-grade timing cross-checks: a trim is a legitimate edit, so these never change an accepted or refused outcome. Keyframe
// times are layer time, so a startTime and stretch pair moves them in composition time; an outPoint the plan does not set is never guessed.
import type { ProjectSnapshot } from "@extynt/project-graph";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { isJsonObject } from "./json-shape.js";
import type { LayerAddress } from "./layer-targets.js";
import type { PlanWarning } from "./plan-types.js";
import { objectsIn, stringAt, targetOf } from "./validation-primitives.js";

const TIMING_EPSILON_SECONDS = 1e-6;
const TIMING_FIELDS = ["outPoint", "startTime", "stretch"] as const;
const RAMP_MESSAGE = "RAMP_ON_SHAPE_LAYER: Gradient Ramp fills the whole layer rectangle, not the shape itself. Put the ramp on a solid above the shape layer, set that solid's track matte to the shape layer (alpha), and parent it to the shape layer for the ramp to follow transformations.";

type LayerTiming = { compositionId: string; layerId: string; outPoint?: number; startTime?: number; stretch?: number };
type LastKeyframe = { readonly compositionId: string; readonly layerId: string; readonly propertyPath: string; readonly lastTime: number };

type WarningState = { readonly createdDurations: Map<string, number>; readonly timing: Map<string, LayerTiming>; readonly keys: Map<string, LastKeyframe>; readonly observedLayers: Map<string, string> };

function layerKeyOf(address: LayerAddress): string { return `${address.compositionId}\u0000${address.layerId}`; }

function layerAddressOf(operation: JsonObject): LayerAddress | undefined {
  const target = targetOf(operation);
  const compositionId = stringAt(target, "compositionId"), layerId = stringAt(target, "layerId");
  return compositionId === undefined || layerId === undefined ? undefined : { compositionId, layerId };
}

/** The warnings a valid plan earns: a trim that hides its own animation, keyframes past a created composition's end, a ramp on a shape or text layer. */
export function planWarnings(operations: readonly JsonValue[], snapshot?: ProjectSnapshot): PlanWarning[] {
  const state = warningState(snapshot);
  const objects = objectsIn(operations);
  for (const operation of objects) collectWarningFacts(state, operation);
  const timing = [...state.keys.values()].flatMap((entry) => timingWarning(state, entry) ?? []);
  return [...timing, ...rampWarnings(state, operations)];
}

function warningState(snapshot: ProjectSnapshot | undefined): WarningState {
  const observedLayers = new Map<string, string>();
  for (const composition of snapshot?.compositions ?? []) for (const layer of composition.layers) observedLayers.set(layerKeyOf({ compositionId: composition.id, layerId: layer.id }), layer.type);
  return { createdDurations: new Map(), timing: new Map(), keys: new Map(), observedLayers };
}

function collectWarningFacts(state: WarningState, operation: JsonObject): void {
  const newCompositionId = operation.newCompositionId, durationSeconds = operation.durationSeconds;
  if (operation.type === "create_composition" && typeof newCompositionId === "string" && typeof durationSeconds === "number") {
    state.createdDurations.set(newCompositionId, durationSeconds);
    return;
  }
  const address = layerAddressOf(operation);
  if (!address) return;
  if (operation.type === "set_layer_timing") recordTiming(state, operation, address);
  else if (operation.type === "animate_property" || operation.type === "animate_control") recordKeyframes(state, operation, address);
}

function recordTiming(state: WarningState, operation: JsonObject, address: LayerAddress): void {
  const key = layerKeyOf(address);
  const current = state.timing.get(key) ?? { ...address };
  for (const field of TIMING_FIELDS) {
    const value = operation[field];
    if (typeof value === "number") current[field] = value;
  }
  state.timing.set(key, current);
}

function recordKeyframes(state: WarningState, operation: JsonObject, address: LayerAddress): void {
  const propertyPath = stringAt(targetOf(operation), "propertyPath"), keyframes = operation.keyframes;
  if (propertyPath === undefined || !Array.isArray(keyframes)) return;
  const lastTime = latestKeyframeTime(keyframes);
  if (lastTime === undefined) return;
  const propertyKey = `${layerKeyOf(address)}\u0000${propertyPath}`;
  if ((state.keys.get(propertyKey)?.lastTime ?? Number.NEGATIVE_INFINITY) < lastTime) state.keys.set(propertyKey, { ...address, propertyPath, lastTime });
}

function latestKeyframeTime(keyframes: readonly JsonValue[]): number | undefined {
  const times = keyframes.flatMap((keyframe) => (isJsonObject(keyframe) && typeof keyframe.time === "number" ? [keyframe.time] : []));
  return times.length ? Math.max(...times) : undefined;
}

function rampWarnings(state: WarningState, operations: readonly JsonValue[]): PlanWarning[] {
  const createdLayers = new Map<string, string>();
  const warnings: PlanWarning[] = [];
  for (const [index, value] of operations.entries()) {
    if (!isJsonObject(value)) continue;
    const warning = rampLayerWarning(state, createdLayers, value, index);
    if (warning) warnings.push(warning);
    recordCreatedLayer(createdLayers, value);
  }
  return warnings;
}

function recordCreatedLayer(createdLayers: Map<string, string>, operation: JsonObject): void {
  const address = layerAddressOf(operation), layerType = operation.layerType;
  if (operation.type === "create_layer" && address && typeof layerType === "string") createdLayers.set(layerKeyOf(address), layerType);
}

function rampLayerWarning(state: WarningState, createdLayers: ReadonlyMap<string, string>, operation: JsonObject, operationIndex: number): PlanWarning | undefined {
  if (operation.type !== "ensure_effect" || operation.effectMatchName !== "ADBE Ramp") return undefined;
  const address = layerAddressOf(operation);
  if (!address) return undefined;
  const key = layerKeyOf(address), layerType = createdLayers.get(key) ?? state.observedLayers.get(key);
  if (layerType !== "shape" && layerType !== "text") return undefined;
  return { code: "RAMP_ON_SHAPE_LAYER", message: RAMP_MESSAGE, ...address, propertyPath: "", operationIndex };
}

function timingWarning(state: WarningState, entry: LastKeyframe): PlanWarning | undefined {
  const planned = state.timing.get(layerKeyOf(entry));
  const lastKeyframeSeconds = (planned?.startTime ?? 0) + entry.lastTime * ((planned?.stretch ?? 100) / 100);
  const where = `layer ${JSON.stringify(entry.layerId)} in composition ${JSON.stringify(entry.compositionId)}`;
  const outPoint = planned?.outPoint;
  return outPoint === undefined ? keyframesOutsideCompositionWarning(state, entry, where, lastKeyframeSeconds) : trimHidesAnimationWarning(entry, where, lastKeyframeSeconds, outPoint);
}

function trimHidesAnimationWarning(entry: LastKeyframe, where: string, lastKeyframeSeconds: number, outPoint: number): PlanWarning | undefined {
  if (lastKeyframeSeconds - outPoint <= TIMING_EPSILON_SECONDS) return undefined;
  return { code: "TRIM_HIDES_ANIMATION", message: `TRIM_HIDES_ANIMATION: the plan's own set_layer_timing leaves ${where} visible only through ${outPoint}s, before the last keyframe the same plan writes (${entry.lastTime}s on ${entry.propertyPath}). An intentional trim is legitimate and nothing is blocked, but the visible window ends before that animation.`, compositionId: entry.compositionId, layerId: entry.layerId, propertyPath: entry.propertyPath, lastKeyframeSeconds, visibleThroughSeconds: outPoint };
}

function keyframesOutsideCompositionWarning(state: WarningState, entry: LastKeyframe, where: string, lastKeyframeSeconds: number): PlanWarning | undefined {
  const duration = state.createdDurations.get(entry.compositionId);
  if (duration === undefined || lastKeyframeSeconds - duration <= TIMING_EPSILON_SECONDS) return undefined;
  return { code: "KEYFRAMES_OUTSIDE_COMPOSITION", message: `KEYFRAMES_OUTSIDE_COMPOSITION: the plan creates composition ${JSON.stringify(entry.compositionId)} with durationSeconds ${duration}, but writes keyframes up to ${entry.lastTime}s on ${where} (${entry.propertyPath}); the composition ends before that animation. Nothing is blocked, but those keyframes are never visible.`, compositionId: entry.compositionId, layerId: entry.layerId, propertyPath: entry.propertyPath, lastKeyframeSeconds, visibleThroughSeconds: duration };
}
