// Marker operation kinds: adding, updating and removing markers on a layer or on a composition's own marker stream.
import { openCompositionNotRead, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { compositionKnown } from "./composition-rules.js";
import { isJsonObject } from "./json-shape.js";
import { currentLayerTarget, plannedOrObservedLayer, type CompositionAddress, type OperationContext } from "./layer-targets.js";
import { earlierWith } from "./operation-checks.js";
import { compositionTarget } from "./plan-shape.js";
import type { V2TargetReference } from "./plan-types.js";
import { observedProperty } from "./property-rules.js";
import { ACCEPTED, arrayAt, invalid, isBoundedString, isFiniteInRange, isOptionalIntegerInRange, isRefusal, rejectUnknown, targetOf, type OperationResult, type Refusal } from "./validation-primitives.js";

type MarkerAddress = V2TargetReference | CompositionAddress;
type MarkerSite = { readonly target: MarkerAddress; readonly time: number };

const MARKER_TEXT_LIMITS: ReadonlyArray<readonly [field: string, maximum: number]> = [["comment", 1024], ["chapter", 256], ["url", 2048], ["cuePointName", 256]];
const MARKER_WRITE_FIELDS = ["type", "target", "time", "comment", "duration", "chapter", "url", "cuePointName", "label"];
const REMOVE_MARKER_FIELDS = ["type", "target", "time", "destructive"];
const SAME_TIME_TOLERANCE_SECONDS = 0.0005;
const MAX_MARKER_SECONDS = 86_400;

function isCompositionScoped(operation: JsonObject): boolean {
  const target = operation.target;
  return Array.isArray(target) || (isJsonObject(target) && target.layerId === undefined);
}

function markerCompositionTarget(context: OperationContext): CompositionAddress | Refusal {
  const { operation, plan, snapshot, earlier } = context;
  const composition = compositionTarget(operation, plan);
  if (isRefusal(composition)) return composition;
  if (snapshot && !compositionKnown(snapshot, earlier, composition.compositionId)) return invalid("TARGET_NOT_FOUND", openCompositionNotRead(snapshot, composition.compositionId) ?? "Marker composition is not present in the current snapshot.");
  return composition;
}

function markerLayerTarget(context: OperationContext): V2TargetReference | Refusal {
  const target = currentLayerTarget(context.operation, context.plan, true, "Marker operations require an exact layer target without property paths, or a composition target without a layerId.");
  if (isRefusal(target)) return target;
  return plannedOrObservedLayer(context, target, "Marker layer must exist or be created earlier in this plan.") ?? target;
}

function markerSite(context: OperationContext, allowed: readonly string[]): MarkerSite | Refusal {
  const { operation } = context;
  const unknownField = rejectUnknown(operation, allowed);
  if (unknownField) return unknownField;
  const target = isCompositionScoped(operation) ? markerCompositionTarget(context) : markerLayerTarget(context);
  if (isRefusal(target)) return target;
  const time = operation.time;
  return isFiniteInRange(time, 0, MAX_MARKER_SECONDS) ? { target, time } : invalid("INVALID_VALUE", "Marker time must be a finite value from 0 to 86400.");
}

function isSameTime(left: number, right: number): boolean { return Math.abs(left - right) < SAME_TIME_TOLERANCE_SECONDS; }

function markerTimeOf(marker: JsonValue): number[] {
  const time = isJsonObject(marker) ? marker.time : undefined;
  return typeof time === "number" ? [time] : [];
}

function compositionMarkerTimes(snapshot: ProjectSnapshot | undefined, compositionId: string): number[] {
  const markers = snapshot?.compositions.find((candidate) => candidate.id === compositionId)?.markers?.markers;
  return markers ? markers.map((marker) => marker.time) : [];
}

function layerMarkerTimes(snapshot: ProjectSnapshot | undefined, target: V2TargetReference): number[] {
  const value = observedProperty(snapshot, { ...target, propertyPath: "ADBE Marker" })?.value;
  const markers = isJsonObject(value) ? arrayAt(value, "markers") : undefined;
  return (markers ?? []).flatMap(markerTimeOf);
}

function observedMarkerTimes(snapshot: ProjectSnapshot | undefined, target: MarkerAddress): number[] {
  return "layerId" in target ? layerMarkerTimes(snapshot, target) : compositionMarkerTimes(snapshot, target.compositionId);
}

function isEarlierMarkerAt(operation: JsonObject, target: MarkerAddress, time: number): boolean {
  const operationTarget = targetOf(operation);
  const operationTime = operation.time;
  const layerId = "layerId" in target ? target.layerId : undefined;
  return operation.type === "add_marker" && operationTarget?.compositionId === target.compositionId && operationTarget.layerId === layerId && typeof operationTime === "number" && isSameTime(operationTime, time);
}

function markerExistsError(context: OperationContext, site: MarkerSite): Refusal | undefined {
  const { target, time } = site;
  const observedAtTime = observedMarkerTimes(context.snapshot, target).some((observed) => isSameTime(observed, time));
  if (!observedAtTime && !earlierWith(context.earlier, (operation) => isEarlierMarkerAt(operation, target, time))) return undefined;
  return invalid("MARKER_EXISTS", `A marker already exists at ${time}s on this ${"layerId" in target ? "layer" : "composition"}; use update_marker to change it.`);
}

function hasTypedMarkerField(operation: JsonObject): boolean {
  return MARKER_TEXT_LIMITS.some(([field]) => operation[field] !== undefined) || operation.duration !== undefined || operation.label !== undefined;
}

function markerTextBoundsError(operation: JsonObject): Refusal | undefined {
  for (const [field, maximum] of MARKER_TEXT_LIMITS) if (operation[field] !== undefined && !isBoundedString(operation[field], maximum)) return invalid("INVALID_VALUE", `${field} exceeds its bounded marker limit.`);
  return undefined;
}

function markerPayloadError(operation: JsonObject): Refusal | undefined {
  if (!hasTypedMarkerField(operation)) return invalid("INVALID_OPERATION", "Marker writes require at least one typed field.");
  const bounded = markerTextBoundsError(operation);
  if (bounded) return bounded;
  const duration = operation.duration;
  if (duration !== undefined && !isFiniteInRange(duration, 0, MAX_MARKER_SECONDS)) return invalid("INVALID_VALUE", "Marker duration must be from 0 to 86400.");
  return isOptionalIntegerInRange(operation.label, 0, 16) ? undefined : invalid("INVALID_VALUE", "Marker label must be an integer from 0 to 16.");
}

/** add_marker: an exact layer or composition target, a marker time with no marker already there, and at least one bounded typed field. */
export function validateAddMarker(context: OperationContext): OperationResult {
  const site = markerSite(context, MARKER_WRITE_FIELDS);
  if (isRefusal(site)) return site;
  return markerExistsError(context, site) ?? markerPayloadError(context.operation) ?? ACCEPTED;
}

/** update_marker: an exact layer or composition target, a marker time, and at least one bounded typed field. */
export function validateUpdateMarker(context: OperationContext): OperationResult {
  const site = markerSite(context, MARKER_WRITE_FIELDS);
  if (isRefusal(site)) return site;
  return markerPayloadError(context.operation) ?? ACCEPTED;
}

/** remove_marker: an exact layer or composition target, a marker time, and explicit confirmation. */
export function validateRemoveMarker(context: OperationContext): OperationResult {
  const site = markerSite(context, REMOVE_MARKER_FIELDS);
  if (isRefusal(site)) return site;
  return context.operation.destructive === true ? ACCEPTED : invalid("DESTRUCTIVE_CONFIRMATION_REQUIRED", "remove_marker requires destructive:true.");
}
