// Turns a probe snapshot, as the host reports it, into the project snapshot the rest of the sidecar reasons over.
import { createFingerprintMemo, createSnapshot, freezeDeep, nestPropertyPaths, type CompositionSnapshot, type LayerSnapshot, type LayerType, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { decodeOrThrow } from "@extynt/decode";
import { probeComposition, type RawComposition, type RawLayer, type RawProperty } from "./server-probe-composition.js";
import { probeItems, probeSources } from "./server-probe-wire.js";
import type { ProbeSnapshot } from "./server-types.js";

const FINGERPRINTS = createFingerprintMemo();
const NORMALISED_LAYERS = new WeakMap<RawLayer, LayerSnapshot>();
const MAX_RENDERERS = 16;
const VALUE_TYPES = ["number", "string", "boolean", "color", "vector", "layer", "enum"] as const;
const LAYER_TYPES: readonly LayerType[] = ["av", "text", "shape", "camera", "light", "null", "adjustment"];
const MATTE_KINDS = ["alpha", "alpha-inverted", "luma", "luma-inverted"] as const;
const TIMELINE_KEYS = ["motionBlur", "shutterAngle", "shutterPhase", "motionBlurSamplesPerFrame", "motionBlurAdaptiveSampleLimit", "frameBlending", "draft3d", "renderer"] as const;

function propertyMetadata(property: RawProperty): Pick<PropertySnapshot, "expression" | "expressionEnabled" | "keyframeCount" | "keyDigest" | "hidden" | "animatable" | "enabled"> {
  return {
    expression: property.expression ?? null,
    expressionEnabled: property.expressionEnabled === true,
    ...(property.keyframeCount !== undefined && property.keyframeCount > 0 ? { keyframeCount: property.keyframeCount } : {}),
    ...(property.keyDigest === undefined ? {} : { keyDigest: property.keyDigest.slice(0, 64) }),
    ...(property.hidden === true ? { hidden: true } : {}),
    ...(property.animatable === false ? { animatable: false as const } : {}),
    ...(property.enabled === undefined ? {} : { enabled: property.enabled }),
  };
}

function normalizeProperty(property: RawProperty): PropertySnapshot {
  const kind = property.kind === "group" || property.kind === "effect" ? property.kind : "property";
  return {
    path: property.path ?? "",
    matchName: property.matchName ?? "",
    displayName: property.displayName ?? "",
    kind,
    valueType: VALUE_TYPES.find((type) => type === property.valueType) ?? "unknown",
    value: property.value ?? null,
    canSetValue: property.canSetValue === true,
    ...propertyMetadata(property),
  };
}

function layerFlags(raw: RawLayer): Pick<LayerSnapshot, "enabled" | "shy" | "solo" | "locked"> {
  return { enabled: raw.enabled ?? true, shy: raw.shy ?? false, solo: raw.solo ?? false, locked: raw.locked ?? false };
}

function layerTiming(raw: RawLayer): Pick<LayerSnapshot, "startTime" | "inPoint" | "outPoint" | "stretch"> {
  return { startTime: raw.startTime ?? 0, inPoint: raw.inPoint ?? 0, outPoint: raw.outPoint ?? 0, stretch: raw.stretch ?? 100 };
}

function layerLinks(raw: RawLayer): Pick<LayerSnapshot, "parentId" | "matteLayerId" | "matteType" | "isSelected" | "sourceId" | "compositionSourceId"> {
  return {
    parentId: raw.parentId ?? null,
    matteLayerId: raw.matteLayerId ?? null,
    matteType: MATTE_KINDS.find((kind) => kind === raw.matteType) ?? "none",
    isSelected: raw.isSelected ?? raw.selected ?? false,
    sourceId: raw.sourceId ?? null,
    compositionSourceId: raw.compositionSourceId ?? null,
  };
}

function normalizeLayer(raw: RawLayer): LayerSnapshot {
  const known = NORMALISED_LAYERS.get(raw);
  if (known) return known;
  const identity = { id: raw.id, index: raw.index, name: raw.name, type: LAYER_TYPES.find((type) => type === raw.type) ?? "unknown", ...(raw.label === undefined ? {} : { label: raw.label }) };
  const properties = nestPropertyPaths((raw.propertyPaths ?? []).map(normalizeProperty));
  const layer = freezeDeep({ ...identity, ...layerFlags(raw), ...layerTiming(raw), ...layerLinks(raw), properties });
  NORMALISED_LAYERS.set(raw, layer);
  return layer;
}

type Defined<T> = { [P in keyof T]?: Exclude<T[P], undefined> };

function copyPresent<K extends keyof RawComposition>(source: RawComposition, keys: readonly K[]): Defined<Pick<RawComposition, K>> {
  const copy: Defined<Pick<RawComposition, K>> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) Object.assign(copy, { [key]: value });
  }
  return copy;
}

function timelineFields(composition: RawComposition): Partial<CompositionSnapshot> {
  const { resolutionFactor, renderers, markers } = composition;
  return {
    ...copyPresent(composition, TIMELINE_KEYS),
    ...(resolutionFactor?.length === 2 && resolutionFactor[0] !== undefined && resolutionFactor[1] !== undefined ? { resolutionFactor: [resolutionFactor[0], resolutionFactor[1]] satisfies [number, number] } : {}),
    ...(renderers === undefined ? {} : { renderers: renderers.slice(0, MAX_RENDERERS) }),
    ...(markers !== undefined && markers.count > 0 ? { markers } : {}),
  };
}

function backgroundOf(composition: RawComposition): Pick<CompositionSnapshot, "backgroundColor"> | Record<string, never> {
  const [red, green, blue] = composition.backgroundColor ?? [];
  return red === undefined || green === undefined || blue === undefined ? {} : { backgroundColor: [red, green, blue] };
}

function normalizeComposition(composition: RawComposition, sceneTime: number | null | undefined): CompositionSnapshot {
  return {
    ...(composition.itemIndex === undefined ? {} : { itemIndex: composition.itemIndex }),
    id: composition.id,
    name: composition.name,
    ...backgroundOf(composition),
    width: composition.width,
    height: composition.height,
    pixelAspect: composition.pixelAspect ?? 1,
    duration: composition.duration,
    frameRate: composition.frameRate,
    workAreaStart: composition.workAreaStart ?? 0,
    workAreaDuration: composition.workAreaDuration ?? composition.duration,
    ...timelineFields(composition),
    currentTime: composition.currentTime ?? sceneTime ?? null,
    layers: composition.layers.map(normalizeLayer),
  };
}

type ProbeResult = ProbeSnapshot["result"];

function stampFields(result: ProbeResult) {
  return { ...(result.hostStamp === undefined ? {} : { hostStamp: result.hostStamp }), ...(result.coverage === undefined ? {} : { coverage: result.coverage }) };
}

function inventoryFields(result: ProbeResult) {
  return {
    ...(result.items === undefined ? {} : { items: freezeDeep(decodeOrThrow(probeItems, result.items)) }),
    ...(result.sources === undefined ? {} : { sources: freezeDeep(decodeOrThrow(probeSources, result.sources)) }),
    ...(result.truncation === undefined ? {} : { truncation: result.truncation }),
  };
}

/** The project snapshot a probe snapshot describes; `receivedAt` is when the sidecar accepted it. */
export function normalizeProbeSnapshot(probe: ProbeSnapshot, receivedAt = ""): ProjectSnapshot {
  const { result, requestId, warnings } = probe;
  const runtime = result.runtime;
  const compositions = result.compositions.map((row) => normalizeComposition(decodeOrThrow(probeComposition, row), result.currentTime));
  const revision = result.revision ?? requestId;
  return createSnapshot({
    ...stampFields(result),
    schemaVersion: "0.1",
    capturedAt: receivedAt,
    host: { application: "After Effects", version: runtime.appVersion, buildNumber: runtime.buildNumber, ...(runtime.buildName === null || runtime.buildName === undefined ? {} : { buildName: runtime.buildName }), platform: runtime.platform, architecture: runtime.architecture },
    project: result.project,
    revision,
    activeCompositionId: result.activeCompositionId,
    currentTime: result.currentTime ?? null,
    selection: { compositionId: result.activeCompositionId, layerIds: [...result.selectedLayerIds] },
    ...inventoryFields(result),
    compositions,
    warnings: [...warnings],
    freshness: { revision, capturedAt: receivedAt, receivedAt: receivedAt || null },
  }, FINGERPRINTS);
}
