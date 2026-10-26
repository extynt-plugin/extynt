/** Builders of the small project both the probe and the native plugin produce, for the native-spike tests. */
import type { JsonObject } from "@extynt/decode";

/** A property entry at `path`; `overrides` replace any field. */
export function entry(path: string, overrides: JsonObject = {}): JsonObject {
  return {
    path, matchName: path.split("/").at(-1) ?? path, displayName: path, kind: "property", valueType: "number",
    value: 0, canSetValue: true, expression: null, expressionEnabled: false, ...overrides,
  };
}

/** A layer row with three property entries; `overrides` replace any field. */
export function makeLayer(id: string, index: number, overrides: JsonObject = {}): JsonObject {
  return {
    id, index, name: `Layer ${id}`, selected: false, label: 1, type: "solid", enabled: true, shy: false, solo: false,
    locked: false, threeD: false, audioEnabled: null, startTime: 0, inPoint: 0, outPoint: 10, stretch: 100,
    parentId: null, matteLayerId: null, matteType: "none", sourceId: "7", compositionSourceId: null,
    switches: { "blend-mode": "NORMAL", "motion-blur": false, "per-character-3d": null, quality: "BEST" },
    propertyPaths: [
      entry("ADBE Transform Group", { kind: "group", valueType: "unknown", value: null, canSetValue: false }),
      entry("ADBE Transform Group/ADBE Position", { valueType: "vector", value: [960, 540] }),
      entry("ADBE Transform Group/ADBE Opacity", { value: 100 }),
    ],
    propertyPathsTruncated: false,
    ...overrides,
  };
}

/** The `read_project` result of the one-composition project. */
export function makeResult(): JsonObject {
  return {
    source: "native",
    project: { name: "Test.aep", filePath: "/tmp/Test.aep", dirty: false },
    itemCount: 3,
    activeCompositionId: "5",
    currentTime: 0,
    selectedLayerIds: [],
    items: [
      { id: "5", name: "Main", type: "composition", parentFolderId: "0", compositionId: "5", sourceId: null },
      { id: "6", name: "Folder", type: "folder", parentFolderId: "0", compositionId: null, sourceId: null },
      { id: "7", name: "Solid", type: "footage", parentFolderId: "6", compositionId: null, sourceId: "7" },
    ],
    sources: [{ id: "7", name: "Solid", type: "solid", missing: false, width: 1920, height: 1080, duration: 0 }],
    compositions: [{
      id: "5", name: "Main", backgroundColor: [0, 0, 0], width: 1920, height: 1080, pixelAspect: 1, duration: 10,
      frameRate: 25, workAreaStart: 0, workAreaDuration: 10, currentTime: 0, truncated: false,
      layers: [makeLayer("11", 1), makeLayer("12", 2)],
    }],
    warnings: [],
  };
}

/** The probe envelope around a result, as the ExtendScript probe publishes it. */
export function probeEnvelope(result: JsonObject): JsonObject {
  return { schemaVersion: "0.1", ok: true, requestId: "probe-1", result, warnings: [] };
}
