/** Marker operations of the fixture: add_marker, update_marker and remove_marker on a layer or a composition. */

import type { CompositionSnapshot, LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { isWireObject } from "@extynt/fake-plugin";
import { resolveComposition, resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { leaf, markersOf, propertyOf, requireProperty, writeMarkers } from "./fake-host-model.js";
import { MARKER_PATH } from "./fake-host-tables.js";
import { boundedNumber, isFiniteNumber, jsonOf, refuse, targetOf, type Field, type JsonObject } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

type MarkerWrite = "add_marker" | "update_marker";

type CompositionMarker = NonNullable<CompositionSnapshot["markers"]>["markers"][number];

interface MarkerStore { owner: string; read: () => JsonObject[]; write: (markers: JsonObject[]) => void }

interface MarkerSlot { type: MarkerWrite; index: number; markers: JsonObject[]; time: number }

const MARKER_FIELDS = ["comment", "duration", "chapter", "url", "cuePointName", "label"] as const;

const MARKER_TIME_TOLERANCE = 0.000001;

const DEFAULT_MARKER: JsonObject = { time: 0, comment: "", duration: 0, chapter: null, url: null, label: 0, cuePointName: null };

function validateMarkerString(value: Field, max: number, message: string): void {
  if (typeof value !== "string" || value.length > max) refuse("INVALID_VALUE", message);
}

function validateMarkerNumber(value: Field, max: number, message: string): void {
  if (!isFiniteNumber(value) || value < 0 || value > max) refuse("INVALID_VALUE", message);
}

function validateMarkerLabel(value: Field): void {
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 0 || value > 16) refuse("INVALID_VALUE", "marker label must be a whole number from 0 to 16.");
}

const MARKER_FIELD_RULES: Readonly<Record<string, (value: Field) => void>> = {
  comment: (value) => validateMarkerString(value, 1024, "marker comment must be a string of at most 1024 characters."),
  duration: (value) => validateMarkerNumber(value, 86400, "marker duration must be a number from 0 to 86400."),
  chapter: (value) => validateMarkerString(value, 256, "marker chapter must be a string of at most 256 characters."),
  url: (value) => validateMarkerString(value, 2048, "marker url must be a string of at most 2048 characters."),
  cuePointName: (value) => validateMarkerString(value, 256, "marker cuePointName must be a string of at most 256 characters."),
  label: validateMarkerLabel,
};

function validateMarkerField(field: string, value: Field): void {
  if (value === null) return;
  MARKER_FIELD_RULES[field]?.(value);
}

function ensureMarkerProperty(layer: LayerSnapshot): PropertySnapshot {
  const existing = propertyOf(layer, MARKER_PATH);
  if (existing) return existing;
  const marker = leaf({ path: MARKER_PATH, matchName: MARKER_PATH, displayName: "Marker", valueType: "unknown", value: { count: 0, markers: [] } });
  layer.properties.push(marker);
  return marker;
}

function markerFieldsOf(operation: WireObject, type: string, time: number, existing: JsonObject | undefined): JsonObject {
  const present = MARKER_FIELDS.filter((field) => operation[field] !== undefined);
  if (present.length === 0) refuse("INVALID_OPERATION", `${type} needs at least one typed marker field (${MARKER_FIELDS.join(", ")}).`);
  for (const field of present) validateMarkerField(field, operation[field]);
  const next: JsonObject = { ...(existing ?? DEFAULT_MARKER), time };
  for (const field of present) next[field] = jsonOf(operation[field]);
  return next;
}

function markerIndexAt(markers: JsonObject[], time: number): number {
  return markers.findIndex((marker) => Math.abs(Number(marker.time) - time) < MARKER_TIME_TOLERANCE);
}

function markerTimes(markers: JsonObject[]): string { return markers.map((marker) => marker.time).join(", ") || "none"; }

function requireMarkerMissing(slot: MarkerSlot, owner: string): void {
  if (slot.type === "add_marker" && slot.index >= 0) refuse("MARKER_EXISTS", `A marker already exists at ${slot.time} on ${owner}; use update_marker to change it.`);
  if (slot.type === "update_marker" && slot.index < 0) refuse("MARKER_NOT_FOUND", `No marker at ${slot.time} on ${owner}. Markers: ${markerTimes(slot.markers)}.`);
}

function plainMarkerFields(marker: JsonObject): Pick<CompositionMarker, "comment" | "duration" | "label"> {
  const { comment, duration, label } = marker;
  return {
    ...(typeof comment === "string" ? { comment } : {}),
    ...(typeof duration === "number" ? { duration } : {}),
    ...(typeof label === "number" ? { label } : {}),
  };
}

function linkMarkerFields(marker: JsonObject): Pick<CompositionMarker, "chapter" | "url" | "cuePointName"> {
  const { chapter, url, cuePointName } = marker;
  return {
    ...(typeof chapter === "string" || chapter === null ? { chapter } : {}),
    ...(typeof url === "string" || url === null ? { url } : {}),
    ...(typeof cuePointName === "string" || cuePointName === null ? { cuePointName } : {}),
  };
}

function compositionMarkerOf(marker: JsonObject): CompositionMarker {
  return { time: Number(marker.time), ...plainMarkerFields(marker), ...linkMarkerFields(marker) };
}

function compositionStore(composition: CompositionSnapshot): MarkerStore {
  return {
    owner: `composition ${composition.id}`,
    read: () => (composition.markers?.markers ?? []).map((marker) => ({ ...marker })),
    write: (markers) => {
      const sorted = [...markers].sort((left, right) => Number(left.time) - Number(right.time));
      composition.markers = { count: sorted.length, markers: sorted.map(compositionMarkerOf) };
    },
  };
}

function layerStore(layer: LayerSnapshot, type: string): MarkerStore {
  const existing = (): PropertySnapshot | undefined => (type === "remove_marker" ? requireProperty(layer, MARKER_PATH, type) : propertyOf(layer, MARKER_PATH));
  return {
    owner: `layer ${layer.id}`,
    read: () => markersOf(existing()),
    write: (markers) => writeMarkers(ensureMarkerProperty(layer), markers),
  };
}

function isCompositionMarker(operation: WireObject): boolean {
  const target = operation.target;
  return isWireObject(target) && (typeof target.layerId !== "string" || target.layerId.length === 0);
}

function markerStoreOf(context: FixtureApplyContext, operation: WireObject, type: string): MarkerStore {
  return isCompositionMarker(operation)
    ? compositionStore(resolveComposition(context, targetOf(operation).compositionId, type))
    : layerStore(resolveLayer(context, operation, type).layer, type);
}

/** Adds a marker at a time that has none (add_marker) or edits the one there (update_marker), on a layer or a composition. */
export function applyMarkerWrite(context: FixtureApplyContext, operation: WireObject, type: MarkerWrite): ApplyOutcome {
  const store = markerStoreOf(context, operation, type);
  const time = boundedNumber(operation.time, `${type} time`, { min: 0, max: 86400 });
  const markers = store.read();
  const index = markerIndexAt(markers, time);
  requireMarkerMissing({ type, index, markers, time }, store.owner);
  const written = markerFieldsOf(operation, type, time, markers[index]);
  if (index >= 0) markers[index] = written;
  else markers.push(written);
  store.write(markers);
  return `${type === "add_marker" ? "added" : "updated"} marker at ${time} on ${store.owner}`;
}

/** Removes the marker at a time, which needs the destructive confirmation. */
export function applyRemoveMarker(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  if (operation.destructive !== true) refuse("DESTRUCTIVE_CONFIRMATION_REQUIRED", "remove_marker deletes a marker and requires destructive: true.");
  const store = markerStoreOf(context, operation, "remove_marker");
  const time = boundedNumber(operation.time, "remove_marker time", { min: 0, max: 86400 });
  const markers = store.read();
  const index = markerIndexAt(markers, time);
  if (index < 0) refuse("MARKER_NOT_FOUND", `No marker at ${time} on ${store.owner}. Markers: ${markerTimes(markers)}.`);
  markers.splice(index, 1);
  store.write(markers);
  return;
}
