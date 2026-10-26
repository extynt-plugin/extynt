// dolly_camera: a camera push-in or pull-out stated as a distance from the camera to its Point of Interest, never as coordinates.
import type { JsonValue } from "@extynt/decode";
import { isJsonArray, isJsonObject } from "./json-shape.js";
import type { V2TargetReference } from "./plan-types.js";
import { keyframeSequenceError } from "./keyframe-rules.js";
import { layerTarget, observedLayer, type OperationContext } from "./layer-targets.js";
import { invalid, isFiniteInRange, isRefusal, rejectUnknown, type OperationResult, type Refusal } from "./validation-primitives.js";

export const DOLLY_CAMERA_OPERATION_TYPES = ["dolly_camera"] as const;
export const DOLLY_POSITION_PATH = "ADBE Transform Group/ADBE Position";
export const DOLLY_POI_PATH = "ADBE Transform Group/ADBE Anchor Point";
export const MAX_DOLLY_DISTANCE = 1_000_000;
export const MAX_DOLLY_KEYFRAMES = 64;
const MAX_TIME_SECONDS = 86_400;
const MIN_KEYFRAMES = 2;
const KEYFRAME_FIX = "Use keyframes like [{ time: 0, distance: 2667 }, { time: 5, distance: 2200 }]: a push-in is a falling distance, a pull-out a rising one.";

export type Vec3 = readonly [number, number, number];
type OptionalPoint = readonly number[] | null | undefined;

interface ParsedEntry { readonly time: number; readonly distance: number; readonly curve: JsonValue | undefined }

/** Pixels a Position key may sit off the camera's original axis or off the requested distance before readback calls it wrong. */
export const DOLLY_TOLERANCE_PX = 0.5;

function padded(value: readonly number[]): Vec3 { return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]; }
function minus(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function plus(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scaled(a: Vec3, factor: number): Vec3 { return [a[0] * factor, a[1] * factor, a[2] * factor]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }

/** The unit axis from the Point of Interest toward the camera, or undefined when the camera sits on it (no axis to keep). A one-node camera has no Point of Interest; its axis points back along -Z from the plane z=0. */
export function dollyAxis(origin: readonly number[], poi: OptionalPoint): Vec3 | undefined {
  if (!poi) return [0, 0, -1];
  const from = minus(padded(origin), padded(poi));
  const size = length(from);
  return size > 1e-6 ? [from[0] / size, from[1] / size, from[2] / size] : undefined;
}

/** The anchor the distance is measured from: the Point of Interest, or the point where a one-node camera's viewing axis meets z=0. */
export function dollyAnchor(origin: readonly number[], poi: OptionalPoint): Vec3 { return poi ? padded(poi) : [origin[0] ?? 0, origin[1] ?? 0, 0]; }

/** The Position a camera takes at `distance` on its original axis; undefined when it has no axis (camera on its own Point of Interest). */
export function dollyPosition(origin: readonly number[], poi: OptionalPoint, distance: number): Vec3 | undefined {
  const axis = dollyAxis(origin, poi);
  return axis && plus(dollyAnchor(origin, poi), scaled(axis, distance));
}

/** How a Position key sits against the original axis: its distance from the anchor, and how far it is off the axis line. */
export function dollyKeyGeometry(position: readonly number[], origin: readonly number[], poi: OptionalPoint): { distance: number; offAxis: number } | undefined {
  const axis = dollyAxis(origin, poi);
  if (!axis) return undefined;
  const along = minus(padded(position), dollyAnchor(origin, poi));
  const distance = dot(along, axis);
  return { distance, offAxis: length(minus(along, scaled(axis, distance))) };
}

function plannedCameraError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const created = context.earlier.filter(isJsonObject).find((op) => {
    const opTarget = op.target;
    return op.type === "create_layer" && isJsonObject(opTarget) && opTarget.layerId === target.layerId && opTarget.compositionId === target.compositionId;
  });
  if (!created || created.layerType === "camera") return undefined;
  return invalid("INVALID_TARGET", `dolly_camera applies to a camera layer; ${target.layerId} is created earlier in this plan as a ${String(created.layerType)} layer. Create the camera with create_layer layerType "camera" and dolly that.`);
}

function cameraTargetError(context: OperationContext, target: V2TargetReference): Refusal | undefined {
  const layer = observedLayer(context.snapshot, target);
  if (!layer) return plannedCameraError(context, target);
  if (layer.type === "camera") return undefined;
  return invalid("INVALID_TARGET", `dolly_camera applies to a camera layer; "${layer.name}" is a ${layer.type} layer. Dolly a camera instead (create one with create_layer layerType "camera" in the same queue, and target its __new__ placeholder).`);
}

function parseEntry(context: OperationContext, entry: JsonValue, index: number): ParsedEntry | Refusal {
  const where = `dolly_camera keyframes[${index}]`;
  if (!isJsonObject(entry)) return invalid("INVALID_VALUE", `${where} must be { time, distance, curve? }. ${KEYFRAME_FIX}`);
  const extra = rejectUnknown(entry, ["time", "distance", "curve"]);
  if (extra) return invalid("INVALID_VALUE", `${where}: ${extra.message} The camera position is derived from distance; do not send value, position or coordinates. ${KEYFRAME_FIX}`);
  const time = entry.time;
  const distance = entry.distance;
  if (!isFiniteInRange(time, 0, MAX_TIME_SECONDS)) return invalid("INVALID_VALUE", `${where}.time must be seconds in composition time, 0-${MAX_TIME_SECONDS}.`);
  if (!isFiniteInRange(distance, 0, MAX_DOLLY_DISTANCE) || distance === 0) return invalid("INVALID_VALUE", `${where}.distance must be a positive number of pixels (the camera's distance to its point of interest, at most ${MAX_DOLLY_DISTANCE}); got ${JSON.stringify(entry.distance)}.`);
  return { time, distance, curve: entry.curve };
}

function parseEntries(context: OperationContext, list: readonly JsonValue[]): ParsedEntry[] | Refusal {
  const entries: ParsedEntry[] = [];
  for (const [index, raw] of list.entries()) {
    const entry = parseEntry(context, raw, index);
    if (isRefusal(entry)) return entry;
    entries.push(entry);
  }
  return entries;
}

function orderError(entries: readonly ParsedEntry[]): Refusal | undefined {
  const first = entries[0];
  const unsorted = entries.findIndex((entry, index) => index > 0 && entry.time <= (entries[index - 1]?.time ?? -1));
  const late = entries[unsorted];
  const before = entries[unsorted - 1];
  if (late && before) return invalid("INVALID_VALUE", `dolly_camera keyframe times must be strictly increasing; keyframes[${unsorted}].time ${late.time} does not follow ${before.time}. Sort the keyframes by time (each distance stays with its time).`);
  if (first && entries.every((entry) => entry.distance === first.distance)) return invalid("INVALID_VALUE", `dolly_camera keyframes all have distance ${first.distance}, so the camera would not move. A push-in falls (2667 -> 2200); a pull-out rises.`);
  return undefined;
}

function countError(list: readonly JsonValue[] | undefined): Refusal | undefined {
  if (!list || list.length < MIN_KEYFRAMES) return invalid("INVALID_VALUE", `dolly_camera needs at least ${MIN_KEYFRAMES} keyframes, got ${list?.length ?? "none"}. ${KEYFRAME_FIX}`);
  return list.length > MAX_DOLLY_KEYFRAMES ? invalid("BOUNDS_EXCEEDED", `dolly_camera takes at most ${MAX_DOLLY_KEYFRAMES} keyframes.`) : undefined;
}

function checkKeyframes(context: OperationContext): OperationResult {
  const raw = context.operation.keyframes;
  const list = isJsonArray(raw) ? raw : undefined;
  const counted = countError(list);
  if (counted || !list) return counted ?? invalid("INVALID_VALUE", KEYFRAME_FIX);
  const entries = parseEntries(context, list);
  if (isRefusal(entries)) return entries;
  const curves = entries.map((entry) => ({ time: entry.time, value: entry.distance, ...(entry.curve === undefined ? {} : { curve: entry.curve }) }));
  return orderError(entries) ?? keyframeSequenceError({ keyframes: curves }) ?? { ok: true, keyframes: entries.length };
}

/** Validates a dolly_camera operation: a camera layer target and at least two strictly increasing { time, distance, curve? } keys whose distance changes; the host derives every Position key from the camera's own axis. */
export function validateDollyCamera(context: OperationContext): OperationResult {
  const unknownField = rejectUnknown(context.operation, ["type", "target", "keyframes"]);
  if (unknownField) return unknownField;
  const target = layerTarget(context, false);
  if (isRefusal(target)) return target;
  return cameraTargetError(context, target) ?? checkKeyframes(context);
}
