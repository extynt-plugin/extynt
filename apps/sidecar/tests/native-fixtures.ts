/**
 * The small project of tools/native-spike/tests/fixtures.ts in TypeScript, plus the helpers that turn probe-shaped rows into what the plugin and
 * the details call would have returned for them. native-snapshot-golden.test.ts proves the two fixture sets stay the same project.
 */
import type { NativeReadResult, PingDirectResult, WatchState } from "@extynt/host-native";
import type { NativeReadSet, PropertyDetail } from "../src/native-snapshot/index.js";
import { isJsonArray, isJsonObject } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { Opaque } from "../src/snapshot-view.js";

export type Row = Record<string, JsonValue>;

/** The row without the named keys: a fixture that leaves a field out instead of setting it to undefined. */
export function omit(row: Row, ...keys: string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

export const PROPERTY_PATH = "ADBE Transform Group/ADBE Position";

export function entry(path: string, overrides: Row = {}): Row {
  return {
    path, matchName: path.split("/").at(-1) ?? path, displayName: path, kind: "property", valueType: "number",
    value: 0, canSetValue: true, expression: null, expressionEnabled: false, ...overrides,
  };
}

export function makeLayer(id: string, index: number, overrides: Row = {}): Row {
  return {
    id, index, name: `Layer ${id}`, selected: false, label: 1, type: "solid", enabled: true, shy: false, solo: false,
    locked: false, threeD: false, audioEnabled: null, startTime: 0, inPoint: 0, outPoint: 10, stretch: 100,
    parentId: null, matteLayerId: null, matteType: "none", sourceId: "7", compositionSourceId: null,
    switches: { "blend-mode": "NORMAL", "motion-blur": false, "per-character-3d": null, quality: "BEST" },
    propertyPaths: [
      entry("ADBE Transform Group", { kind: "group", valueType: "unknown", value: null, canSetValue: false }),
      entry(PROPERTY_PATH, { valueType: "vector", value: [960, 540] }),
      entry("ADBE Transform Group/ADBE Opacity", { value: 100 }),
    ],
    propertyPathsTruncated: false,
    ...overrides,
  };
}

export interface ResultOptions { compId?: string; layers?: Row[]; comp?: Row; noBackground?: boolean }

/** The `read_project` result of the spike fixture; `compId`, `layers` and `comp` override the one composition. */
export function makeResult(options: ResultOptions = {}): NativeReadResult {
  const compId = options.compId ?? "5";
  return {
    source: "native" as const,
    project: { name: "Test.aep", filePath: "/tmp/Test.aep", dirty: false },
    itemCount: 3,
    activeCompositionId: compId,
    currentTime: 0,
    selectedLayerIds: [],
    items: [
      { id: compId, name: "Main", type: "composition", parentFolderId: "0", compositionId: compId, sourceId: null },
      { id: "6", name: "Folder", type: "folder", parentFolderId: "0", compositionId: null, sourceId: null },
      { id: "7", name: "Solid", type: "footage", parentFolderId: "6", compositionId: null, sourceId: "7" },
    ],
    sources: [{ id: "7", name: "Solid", type: "solid", missing: false, width: 1920, height: 1080, duration: 0 }],
    compositions: [{
      id: compId, name: "Main", ...(options.noBackground ? {} : { backgroundColor: [0, 0, 0] }), width: 1920, height: 1080, pixelAspect: 1, duration: 10,
      frameRate: 25, workAreaStart: 0, workAreaDuration: 10, currentTime: 0, truncated: false,
      layers: options.layers ?? [makeLayer("11", 1), makeLayer("12", 2)],
      ...options.comp,
    }],
    warnings: [],
  };
}

export const STAMP: WatchState = {
  epoch: 3, revision: 42, items: 3, projectName: "Test.aep", projectPath: "/tmp/Test.aep", activeCompId: "5", activeCompName: "Main",
  time: 0, selection: [], selectedLayers: [],
};

export const PING: PingDirectResult = {
  pong: true, mainThread: false, pluginVersion: "0.1.0", aeVersion: "26.2.1 (build 2)", pid: 4242, host: null, arch: "arm64", idleAgeMs: 12, idleTicks: 900,
  queueDepth: 0, oldestQueuedMs: null, watchers: 1, library: { version: "0.1.0+abc", entryFile: "probe.jsx" },
};

export const isRow = (value: Opaque): value is Row => !!value && typeof value === "object" && !Array.isArray(value);

function nativeProperty(property: Row): { row: Row; detail: PropertyDetail | null } {
  const { keyDigest, keyDigestTruncated, ...row } = property;
  const textDocument = isRow(row.value) && typeof row.value.text === "string";
  const detail: PropertyDetail = { path: String(property.path) };
  if (textDocument) { detail.value = row.value; row.value = { unsupported: "text-document" }; }
  if (typeof keyDigest === "string") detail.keyDigest = keyDigest;
  if (keyDigestTruncated === true) detail.keyDigestTruncated = true;
  return { row, detail: Object.keys(detail).length > 1 ? detail : null };
}

/** The plugin's rows for probe-shaped layers, and the details the jsx call would add for them. */
export function nativeLayers(compId: string, layers: Row[]): { layers: Row[]; details: Array<{ compId: string; layerId: string; properties: PropertyDetail[] }> } {
  const details: Array<{ compId: string; layerId: string; properties: PropertyDetail[] }> = [];
  const converted = layers.map((layer) => {
    if (!Array.isArray(layer.propertyPaths)) return layer;
    const rows = layer.propertyPaths.filter(isRow).map(nativeProperty);
    const properties = rows.flatMap((item) => (item.detail ? [item.detail] : []));
    if (properties.length) details.push({ compId, layerId: String(layer.id), properties });
    return { ...layer, propertyPaths: rows.map((item) => item.row) };
  });
  return { layers: converted, details };
}

export interface ReadSetOptions { compId?: string; layers?: Row[]; comp?: Row; noBackground?: boolean; stamp?: Partial<WatchState>; scope?: NativeReadSet["scope"]; requestId?: string }

function resultAndDetails(options: ReadSetOptions): { project: NativeReadResult; details: ReturnType<typeof nativeLayers>["details"] } {
  const compId = options.compId ?? "5";
  const { layers, details } = nativeLayers(compId, options.layers ?? [makeLayer("11", 1), makeLayer("12", 2)]);
  return { project: makeResult({ compId, layers, ...(options.comp ? { comp: options.comp } : {}), ...(options.noBackground ? { noBackground: true } : {}) }), details };
}

function projectOf(project: NativeReadResult, scope: NativeReadSet["scope"]): { project?: NativeReadResult } {
  return scope.kind === "full" || scope.includeItems ? { project } : {};
}

/** A read set whose rows were produced from probe-shaped layers: what a native read of that composition plus a details call returns. */
export function readSetOf(options: ReadSetOptions = {}): NativeReadSet {
  const compId = options.compId ?? "5", { project, details } = resultAndDetails(options);
  const scope = options.scope ?? { kind: "full" };
  return {
    stamp: { ...STAMP, activeCompId: compId, ...options.stamp }, ping: PING, requestId: options.requestId ?? "read-1", scope,
    ...projectOf(project, scope),
    comps: scope.kind === "compositions" ? [{ ...project, itemCount: 0 }] : [],
    ...(details.length ? { details: { ok: true, layers: details } } : {}),
  };
}

function stampedLayer(layer: JsonObject, hashes: Record<string, string>): JsonObject {
  const id = layer.id, hash = typeof id === "string" ? hashes[id] : undefined;
  return hash ? { ...layer, hash } : layer;
}

function stampedComposition(composition: JsonObject, hashes: { comp: string; layers: Record<string, string> }): JsonObject {
  const layers = composition.layers;
  const stamped = isJsonArray(layers) ? { layers: layers.map((layer) => (isJsonObject(layer) ? stampedLayer(layer, hashes.layers) : layer)) } : {};
  return { ...composition, hash: hashes.comp, ...stamped };
}

/** The read set with the plugin's hashes (`hashes: true`) on the composition and its layers. */
export function withHashes(read: NativeReadSet, hashes: { comp: string; layers: Record<string, string> }): NativeReadSet {
  for (const result of [...(read.project ? [read.project] : []), ...read.comps]) result.compositions = result.compositions.map((composition) => stampedComposition(composition, hashes));
  return read;
}
