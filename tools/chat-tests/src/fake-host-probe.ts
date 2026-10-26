/** The fixture snapshot a host probe describes: compositions, layers, properties, items and sources, with every field read defensively. */

import { createSnapshot, nestPropertyPaths, type CompositionSnapshot, type HostMetadata, type KeyframeSnapshot, type LayerSnapshot, type ProjectItemSnapshot, type ProjectMetadata, type ProjectSnapshot, type PropertySnapshot, type SelectionContext, type SourceSnapshot } from "@extynt/project-graph";
import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import { isFiniteNumber, jsonOf, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

type MarkerList = NonNullable<CompositionSnapshot["markers"]>["markers"];

const LAYER_TYPES: readonly LayerSnapshot["type"][] = ["av", "text", "shape", "camera", "light", "null", "adjustment", "unknown"];

const MATTE_TYPES: readonly LayerSnapshot["matteType"][] = ["none", "alpha", "alpha-inverted", "luma", "luma-inverted"];

const VALUE_TYPES: readonly PropertySnapshot["valueType"][] = ["number", "string", "boolean", "color", "vector", "layer", "enum"];

const PROPERTY_KINDS: readonly PropertySnapshot["kind"][] = ["group", "effect", "property"];

const ITEM_TYPES: readonly ProjectItemSnapshot["type"][] = ["composition", "footage", "folder", "unknown"];

const SOURCE_TYPES: readonly SourceSnapshot["type"][] = ["footage", "solid", "placeholder", "unknown"];

const PLATFORMS: readonly HostMetadata["platform"][] = ["macOS", "Windows", "unknown"];

const ARCHITECTURES: readonly HostMetadata["architecture"][] = ["arm64", "x86_64", "unknown"];

function oneOf<T extends string>(value: Field, allowed: readonly T[], fallback: T): T { return allowed.find((candidate) => candidate === value) ?? fallback; }

function rowsOf(value: Field): WireObject[] { return isWireArray(value) ? value.filter(isWireObject) : []; }

function objectOf(value: Field): WireObject { return isWireObject(value) ? value : {}; }

function stringsOf(value: Field): string[] { return isWireArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }

function stringOrNull(value: Field): string | null { return typeof value === "string" ? value : null; }

function numberOr(value: Field, fallback: number): number { return isFiniteNumber(value) ? value : fallback; }

function numberOrNull(value: Field): number | null { return isFiniteNumber(value) ? value : null; }

function textOf(value: Field): string { return String(value ?? ""); }

function markerOf(row: WireObject): MarkerList[number] | undefined {
  const time = row.time;
  if (!isFiniteNumber(time)) return undefined;
  const { comment, duration, chapter, url, cuePointName, label } = row;
  return {
    time,
    ...(typeof comment === "string" ? { comment } : {}),
    ...(isFiniteNumber(duration) ? { duration } : {}),
    ...(chapter !== undefined ? { chapter: stringOrNull(chapter) } : {}),
    ...(url !== undefined ? { url: stringOrNull(url) } : {}),
    ...(cuePointName !== undefined ? { cuePointName: stringOrNull(cuePointName) } : {}),
    ...(isFiniteNumber(label) ? { label } : {}),
  };
}

function markersFrom(value: Field): Pick<CompositionSnapshot, "markers"> {
  const list = objectOf(value).markers;
  if (!isWireArray(list)) return {};
  return { markers: { count: list.length, markers: rowsOf(list).flatMap((row) => markerOf(row) ?? []) } };
}

function shutterFrom(raw: WireObject): Partial<CompositionSnapshot> {
  const { shutterAngle, shutterPhase, motionBlurSamplesPerFrame, motionBlurAdaptiveSampleLimit } = raw;
  return {
    ...(isFiniteNumber(shutterAngle) ? { shutterAngle } : {}),
    ...(isFiniteNumber(shutterPhase) ? { shutterPhase } : {}),
    ...(isFiniteNumber(motionBlurSamplesPerFrame) ? { motionBlurSamplesPerFrame } : {}),
    ...(isFiniteNumber(motionBlurAdaptiveSampleLimit) ? { motionBlurAdaptiveSampleLimit } : {}),
  };
}

function compositionTimelineFromProbe(raw: WireObject): Partial<CompositionSnapshot> {
  const { motionBlur, renderer, renderers } = raw;
  return {
    ...(typeof motionBlur === "boolean" ? { motionBlur } : {}),
    ...shutterFrom(raw),
    ...(typeof renderer === "string" ? { renderer } : {}),
    ...(isWireArray(renderers) ? { renderers: stringsOf(renderers) } : {}),
    ...markersFrom(raw.markers),
  };
}

function backgroundFrom(value: Field): Pick<CompositionSnapshot, "backgroundColor"> {
  const [red, green, blue] = isWireArray(value) ? value : [];
  return isFiniteNumber(red) && isFiniteNumber(green) && isFiniteNumber(blue) ? { backgroundColor: [red, green, blue] } : {};
}

function compositionsFromProbe(result: WireObject): CompositionSnapshot[] {
  return rowsOf(result.compositions).map((raw) => ({
    id: textOf(raw.id), name: textOf(raw.name),
    ...backgroundFrom(raw.backgroundColor),
    width: numberOr(raw.width, 0), height: numberOr(raw.height, 0), pixelAspect: numberOr(raw.pixelAspect, 1),
    duration: numberOr(raw.duration, 0), frameRate: numberOr(raw.frameRate, 0),
    workAreaStart: numberOr(raw.workAreaStart, 0), workAreaDuration: numberOr(raw.workAreaDuration, numberOr(raw.duration, 0)),
    currentTime: numberOr(raw.currentTime, numberOr(result.currentTime, 0)), layers: rowsOf(raw.layers).map(layerFromProbe),
    ...compositionTimelineFromProbe(raw),
  }));
}

function hostMetadataFromProbe(runtime: WireObject): HostMetadata {
  const { buildName } = runtime;
  return {
    application: "After Effects",
    version: typeof runtime.appVersion === "string" ? runtime.appVersion : "unknown",
    buildNumber: stringOrNull(runtime.buildNumber),
    ...(typeof buildName === "string" ? { buildName } : {}),
    platform: oneOf(runtime.platform, PLATFORMS, "unknown"),
    architecture: oneOf(runtime.architecture, ARCHITECTURES, "unknown"),
  };
}

function projectMetadataFromProbe(value: Field): ProjectMetadata {
  const project = objectOf(value);
  return { name: textOf(project.name), filePath: stringOrNull(project.filePath) };
}

function selectionFromProbe(result: WireObject, activeCompositionId: string | null): SelectionContext {
  return { compositionId: activeCompositionId, layerIds: stringsOf(result.selectedLayerIds) };
}

function projectItemsFromProbe(value: Field): ProjectItemSnapshot[] {
  return rowsOf(value).map((item) => ({
    id: textOf(item.id),
    name: textOf(item.name),
    type: oneOf(item.type, ITEM_TYPES, "unknown"),
    parentFolderId: stringOrNull(item.parentFolderId),
    compositionId: stringOrNull(item.compositionId),
    sourceId: stringOrNull(item.sourceId),
  }));
}

function sourcesFromProbe(value: Field): SourceSnapshot[] {
  return rowsOf(value).map((source) => {
    const { width, height, duration } = source;
    return {
      id: textOf(source.id),
      name: textOf(source.name),
      type: oneOf(source.type, SOURCE_TYPES, "unknown"),
      filePath: stringOrNull(source.filePath),
      missing: source.missing === true,
      ...(isFiniteNumber(width) ? { width } : {}),
      ...(isFiniteNumber(height) ? { height } : {}),
      ...(isFiniteNumber(duration) ? { duration } : {}),
    };
  });
}

function keyframeFromProbe(value: WireObject): KeyframeSnapshot[] {
  const { time } = value;
  if (!isFiniteNumber(time)) return [];
  const interpolation = objectOf(value.interpolation);
  const { inType, outType } = interpolation;
  const labels = { ...(typeof inType === "string" ? { inType } : {}), ...(typeof outType === "string" ? { outType } : {}) };
  return [{ time, value: jsonOf(value.value ?? null, "keyframe value"), ...(isWireObject(value.interpolation) ? { interpolation: labels } : {}) }];
}

function propertyFlagsFromProbe(property: WireObject): Partial<PropertySnapshot> {
  const { expression, keyframeCount, enabled } = property;
  return {
    expression: typeof expression === "string" ? expression : null,
    expressionEnabled: property.expressionEnabled === true,
    ...(isFiniteNumber(keyframeCount) && keyframeCount > 0 ? { keyframeCount } : {}),
    ...(isWireArray(property.keyframes) ? { keyframes: rowsOf(property.keyframes).flatMap(keyframeFromProbe) } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(property.hidden === true ? { hidden: true } : {}),
    ...(property.animatable === false ? { animatable: false as const } : {}),
  };
}

function propertyFromProbe(property: WireObject): PropertySnapshot {
  const path = textOf(property.path);
  return {
    path,
    matchName: textOf(property.matchName),
    displayName: textOf(property.displayName),
    kind: oneOf(property.kind, PROPERTY_KINDS, "property"),
    valueType: oneOf(property.valueType, VALUE_TYPES, "unknown"),
    value: jsonOf(property.value ?? null, `${path || "property"} value`),
    canSetValue: property.canSetValue === true,
    ...propertyFlagsFromProbe(property),
  };
}

function layerTimingFromProbe(raw: WireObject): Pick<LayerSnapshot, "startTime" | "inPoint" | "outPoint" | "stretch"> {
  return { startTime: numberOr(raw.startTime, 0), inPoint: numberOr(raw.inPoint, 0), outPoint: numberOr(raw.outPoint, 0), stretch: numberOr(raw.stretch, 100) };
}

function layerReferencesFromProbe(raw: WireObject): Pick<LayerSnapshot, "parentId" | "matteLayerId" | "matteType"> {
  return { parentId: stringOrNull(raw.parentId), matteLayerId: stringOrNull(raw.matteLayerId), matteType: oneOf(raw.matteType, MATTE_TYPES, "none") };
}

function layerOptionsFromProbe(raw: WireObject): Pick<LayerSnapshot, "label" | "threeD"> {
  const { label, threeD } = raw;
  return { ...(isFiniteNumber(label) ? { label } : {}), ...(typeof threeD === "boolean" ? { threeD } : {}) };
}

function layerFromProbe(raw: WireObject): LayerSnapshot {
  return {
    id: textOf(raw.id), index: numberOr(raw.index, 0), name: textOf(raw.name),
    type: oneOf(raw.type, LAYER_TYPES, "unknown"),
    enabled: raw.enabled !== false, shy: raw.shy === true, solo: raw.solo === true, locked: raw.locked === true,
    ...layerTimingFromProbe(raw),
    ...layerReferencesFromProbe(raw),
    isSelected: raw.isSelected === true || raw.selected === true,
    ...layerOptionsFromProbe(raw),
    sourceId: stringOrNull(raw.sourceId),
    compositionSourceId: stringOrNull(raw.compositionSourceId),
    properties: nestPropertyPaths(rowsOf(raw.propertyPaths).map(propertyFromProbe)),
  };
}

/** The project snapshot a host probe response describes, as the fixture host would hold it. */
export function fixtureSnapshotFromProbe(probe: WireObject, options: { capturedAt?: string; receivedAt?: string | null } = {}): ProjectSnapshot {
  const result = objectOf(probe.result);
  const activeCompositionId = stringOrNull(result.activeCompositionId);
  const capturedAt = options.capturedAt ?? "";
  const revision = typeof result.revision === "string" ? result.revision : (typeof probe.requestId === "string" ? probe.requestId : "");
  return createSnapshot({
    schemaVersion: "0.1",
    capturedAt,
    host: hostMetadataFromProbe(objectOf(result.runtime)),
    project: projectMetadataFromProbe(result.project),
    revision,
    activeCompositionId,
    currentTime: numberOrNull(result.currentTime),
    selection: selectionFromProbe(result, activeCompositionId),
    items: projectItemsFromProbe(result.items),
    sources: sourcesFromProbe(result.sources),
    compositions: compositionsFromProbe(result),
    warnings: stringsOf(probe.warnings),
    freshness: { revision, capturedAt, receivedAt: options.receivedAt ?? null },
  });
}
