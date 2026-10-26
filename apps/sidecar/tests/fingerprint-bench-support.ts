/** A synthetic probe the size of the real owner project (15 comps, 126 layers, about 20k properties) and the scoped read that replaces one comp of it. */
import { isJsonArray, isJsonObject, type JsonValue } from "@extynt/decode";
import type { ProbeSnapshot, StoredSnapshot } from "../src/server-types.js";
import { mergeRead, observedOfWhole } from "../src/snapshot-merge.js";
import { validSnapshot } from "./sidecar-fixture.js";

interface Row { [key: string]: JsonValue }
const COMPOSITIONS = 15, LAYERS = 126, GROUPS_PER_LAYER = 8, LEAVES_PER_GROUP = 19;

function leaf(path: string, index: number, salt: number): Row {
  const animated = index % 7 === 0;
  return { path, matchName: path.slice(path.lastIndexOf("/") + 1), displayName: `Control ${index}`, kind: "property", valueType: index % 3 === 0 ? "vector" : "number", value: index % 3 === 0 ? [index, salt, 0.5] : index + salt / 10, canSetValue: true, expression: index % 11 === 0 ? `value * ${index}` : null, expressionEnabled: index % 11 === 0, ...(animated ? { keyframeCount: 3, keyDigest: `digest-${salt}-${index}` } : {}) };
}

function propertyRows(layerNumber: number, salt: number): Row[] {
  const rows: Row[] = [];
  for (let group = 0; group < GROUPS_PER_LAYER; group += 1) {
    const root = `ADBE Group ${group}`;
    rows.push({ path: root, matchName: root, displayName: `Group ${group}`, kind: "group", valueType: "unknown", value: null, canSetValue: false });
    for (let index = 0; index < LEAVES_PER_GROUP; index += 1) rows.push(leaf(`${root}/ADBE Leaf ${group}-${index}`, index + layerNumber, salt));
  }
  return rows;
}

function layerRow(layerNumber: number, index: number, salt: number): Row {
  return { id: String(1000 + layerNumber), index, name: `Layer ${layerNumber}`, type: layerNumber % 5 === 0 ? "shape" : "av", enabled: true, shy: false, solo: false, locked: false, startTime: 0, inPoint: 0, outPoint: 10, stretch: 100, parentId: null, matteLayerId: null, matteType: "none", selected: layerNumber === 3, sourceId: null, label: layerNumber % 16, propertyPaths: propertyRows(layerNumber, salt) };
}

function compositionRow(number: number, firstLayer: number, count: number, salt: number): Row {
  const layers = Array.from({ length: count }, (_, index) => layerRow(firstLayer + index, index + 1, salt));
  return { itemIndex: number + 1, id: `comp-${number}`, name: `Composition ${number}`, width: 1920, height: 1080, pixelAspect: 1, duration: 10, frameRate: 24, workAreaStart: 0, workAreaDuration: 10, backgroundColor: [0, 0, 0], layers };
}

function compositionRows(salt: number, only?: readonly number[]): Row[] {
  const rows: Row[] = [];
  let first = 0;
  for (let number = 0; number < COMPOSITIONS; number += 1) {
    const count = Math.floor(LAYERS / COMPOSITIONS) + (number < LAYERS % COMPOSITIONS ? 1 : 0);
    if (!only || only.includes(number)) rows.push(compositionRow(number, first, count, salt));
    first += count;
  }
  return rows;
}

const ITEMS = Array.from({ length: COMPOSITIONS }, (_, number) => ({ id: `comp-${number}`, name: `Composition ${number}`, type: "composition", parentFolderId: null, compositionId: `comp-${number}`, sourceId: null }));

export function benchProbe(requestId: string, revision: number, salt: number, scope?: { only: readonly number[] }): ProbeSnapshot {
  const scoping = { itemCount: ITEMS.length, compositionPages: { unread: [], oversized: [], capped: false }, readScope: scope ? { compositions: "listed", items: "skipped" } : { compositions: "all", items: "read" } };
  const result: ProbeSnapshot["result"] = { ...validSnapshot.result, ...scoping, project: { name: "Bench", filePath: "/p/bench.aep" }, hostStamp: { epoch: 1, revision }, revision: `${ITEMS.length}:comp-0`, activeCompositionId: "comp-0", currentTime: 0, selectedLayerIds: ["1003"], items: ITEMS, sources: [], compositions: compositionRows(salt, scope?.only), installedEffects: [], capabilityEnumeration: { effects: "unknown" }, truncation: { truncated: false, limits: {} } };
  return { ...validSnapshot, requestId, result, warnings: [] };
}

export function storedProbe(snapshot: ProbeSnapshot): StoredSnapshot {
  return { snapshot, receivedAt: "2026-10-05T12:00:00.000Z", bytes: 1, observed: observedOfWhole(snapshot) };
}

/** What the sidecar holds after a scoped read of composition `number`: the base's other compositions are the same objects as before. */
export function scopedProbeOnto(base: StoredSnapshot, number: number, revision: number): ProbeSnapshot {
  const merged = mergeRead(base, benchProbe(`scoped-${revision}`, revision, revision, { only: [number] }), [`comp-${number}`]);
  if (!merged.ok) throw new Error(`the scoped read was refused: ${merged.reason}`);
  return merged.snapshot;
}

export const BENCH_SIZE = { compositions: COMPOSITIONS, layers: LAYERS, properties: LAYERS * GROUPS_PER_LAYER * (LEAVES_PER_GROUP + 1) };

/** The fastest of `runs` timed runs after one warm-up: the least disturbed by whatever else the machine is doing. */
export function minMs(runs: number, work: () => void): number {
  work();
  const times: number[] = [];
  for (let run = 0; run < runs; run += 1) { const start = performance.now(); work(); times.push(performance.now() - start); }
  return Math.min(...times);
}

const isRow = (value: JsonValue | undefined): value is Row => isJsonObject(value);
const rowsOf = (value: JsonValue | undefined): Row[] => isJsonArray(value) ? value.filter(isRow) : [];
export const rawCompositions = (probe: ProbeSnapshot): Row[] => rowsOf(probe.result.compositions);
export const rawLayers = (composition: Row | undefined): Row[] => rowsOf(composition?.layers);
export const rawProperties = (layer: Row | undefined): Row[] => rowsOf(layer?.propertyPaths);
