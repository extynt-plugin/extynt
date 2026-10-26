// Snapshot builders for the geometry solver tests: layers carrying transform properties inside one composition.
import assert from "node:assert/strict";
import { createSnapshot } from "@extynt/project-graph";
import { measureLayer } from "../src/solvers/geometry.js";
import type { LayerMeasurement } from "../src/solvers/geometry.js";
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot, SourceSnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";

/** The values of the four 2D transform properties, each defaulting to the identity. */
export interface TransformValues {
  readonly anchor?: JsonValue;
  readonly position?: JsonValue;
  readonly scale?: JsonValue;
  readonly rotation?: JsonValue;
}

/** What a scene snapshot holds besides the layers of its main composition. */
export interface SceneOptions {
  readonly layers: ReadonlyArray<LayerSnapshot>;
  readonly sources?: ReadonlyArray<SourceSnapshot>;
  readonly otherCompositions?: ReadonlyArray<CompositionSnapshot>;
  readonly currentTime?: number;
}

const TRANSFORM_GROUP = "ADBE Transform Group";

function valueTypeOf(value: JsonValue): PropertySnapshot["valueType"] {
  if (Array.isArray(value)) return "vector";
  return typeof value === "number" ? "number" : "unknown";
}

/** A transform property by match name, optionally animated by a keyframe count. */
export function transformProperty(matchName: string, value: JsonValue, keyframeCount?: number): PropertySnapshot {
  return {
    path: `${TRANSFORM_GROUP}/${matchName}`,
    matchName,
    displayName: matchName,
    kind: "property",
    valueType: valueTypeOf(value),
    value,
    canSetValue: true,
    ...(keyframeCount === undefined ? {} : { keyframeCount }),
  };
}

/** The four standard transform properties. */
export function standardProperties(values: TransformValues = {}): PropertySnapshot[] {
  return [
    transformProperty("ADBE Anchor Point", values.anchor ?? [0, 0]),
    transformProperty("ADBE Position", values.position ?? [0, 0]),
    transformProperty("ADBE Scale", values.scale ?? [100, 100]),
    transformProperty("ADBE Rotate Z", values.rotation ?? 0),
  ];
}

/** A layer whose transform group holds the given properties. */
export function makeLayer(id: string, name: string, properties: ReadonlyArray<PropertySnapshot> = [], overrides: Partial<LayerSnapshot> = {}): LayerSnapshot {
  const group: PropertySnapshot = {
    path: TRANSFORM_GROUP,
    matchName: TRANSFORM_GROUP,
    displayName: "Transform",
    kind: "group",
    valueType: "unknown",
    value: null,
    canSetValue: false,
    children: [...properties],
  };
  return {
    id,
    index: 1,
    name,
    type: "av",
    enabled: true,
    shy: false,
    solo: false,
    locked: false,
    startTime: 0,
    inPoint: 0,
    outPoint: 100,
    stretch: 100,
    parentId: null,
    matteLayerId: null,
    matteType: "none",
    isSelected: false,
    sourceId: null,
    properties: [group],
    ...overrides,
  };
}

/** A composition with the fixed 1920 by 1080 frame the tests assume. */
export function makeComposition(id: string, layers: ReadonlyArray<LayerSnapshot>, size: readonly [number, number] = [1920, 1080]): CompositionSnapshot {
  return {
    id,
    name: id === "comp1" ? "Main" : id,
    width: size[0],
    height: size[1],
    pixelAspect: 1,
    duration: 10,
    frameRate: 30,
    workAreaStart: 0,
    workAreaDuration: 10,
    layers: [...layers],
  };
}

/** A solid source of the given size. */
export function solidSource(id: string, width: number, height: number): SourceSnapshot {
  return { id, name: "Solid", type: "solid", filePath: null, missing: false, width, height };
}

/** A project whose composition "comp1" holds the layers. */
export function sceneSnapshot(options: SceneOptions): ProjectSnapshot {
  const main = { ...makeComposition("comp1", options.layers), ...(options.currentTime === undefined ? {} : { currentTime: options.currentTime }) };
  return createSnapshot({
    capturedAt: "2026-09-11T15:00:00.000Z",
    host: { application: "After Effects", version: "26.0", buildNumber: "1", platform: "macOS", architecture: "arm64" },
    project: { name: "test", filePath: null },
    revision: "rev1",
    activeCompositionId: "comp1",
    currentTime: null,
    selection: { compositionId: "comp1", layerIds: [] },
    ...(options.sources ? { sources: [...options.sources] } : {}),
    compositions: [main, ...(options.otherCompositions ?? [])],
  });
}

/** Measures a layer of "comp1" and asserts the measurement succeeded. */
export function measured(options: SceneOptions, layerId = "layer1"): LayerMeasurement {
  const result = measureLayer(sceneSnapshot(options), "comp1", layerId);
  assert.ok(result.ok);
  return result;
}
