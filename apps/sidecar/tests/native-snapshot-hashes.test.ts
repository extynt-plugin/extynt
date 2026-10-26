/** Per-layer hashes decide what a native read changed; the details request covers only what the latest snapshot lacks. */
import type { JsonValue } from "@extynt/decode";
import type { Opaque } from "../src/snapshot-view.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DETAILS_MAX_LAYERS, changedLayers, layerHashIndex, mergeLayersByHash, parsePropertyDetails, readApplyBreadcrumb, residualScopes, toProbeEnvelope } from "../src/native-snapshot/index.js";
import { entry, isRow, makeLayer, omit, readSetOf, withHashes, type Row } from "./native-fixtures.js";
const rowsAt = (value: Opaque): Row[] => (Array.isArray(value) ? value.filter(isRow) : []);
const layersOfFirst = (rows: readonly Row[]): Row[] => rowsAt(rows[0]?.layers);

const LAYERS = { "11": "h11", "12": "h12" };
const REVISION = "4242|3|42|/tmp/Test.aep";
const hashed = (layers: Record<string, string> = LAYERS, comp = "c1", rows?: Row[]) => withHashes(readSetOf(rows ? { layers: rows } : {}), { comp, layers });

test("the index holds a hash per composition and layer, and nothing for a read made without hashes", () => {
  assert.deepEqual(layerHashIndex(hashed()), { compositions: { "5": { hash: "c1", layers: { "11": { hash: "h11", full: true, text: false, revision: REVISION }, "12": { hash: "h12", full: true, text: false, revision: REVISION } } } } });
  assert.deepEqual(layerHashIndex(readSetOf()), { compositions: { "5": { hash: null, layers: {} } } });
  const structure = readSetOf({ layers: [omit(makeLayer("11", 1), "propertyPaths")] });
  assert.equal(layerHashIndex(withHashes(structure, { comp: "c", layers: { "11": "h" } })).compositions["5"]?.layers["11"]?.full, false);
});

test("an unchanged read changes nothing, and one moved layer changes its composition and that layer only", () => {
  const previous = layerHashIndex(hashed());
  assert.deepEqual(changedLayers(previous, hashed()), { compositions: [], layers: [] });
  const moved = changedLayers(previous, hashed({ "11": "h11", "12": "h12b" }, "c2"));
  assert.deepEqual(moved, { compositions: ["5"], layers: [{ compId: "5", layerId: "12" }] });
});

test("a layer the previous read never had, a read without hashes and a detail change all count as changed", () => {
  const previous = layerHashIndex(hashed({ "11": "h11" }, "c1", [makeLayer("11", 1)]));
  const added = changedLayers(previous, hashed({ "11": "h11", "12": "h12" }, "c2"));
  assert.deepEqual(added.layers, [{ compId: "5", layerId: "12" }]);
  assert.equal(changedLayers(layerHashIndex(hashed()), readSetOf()).layers.length, 2);
  const structure = withHashes(readSetOf({ layers: [omit(makeLayer("11", 1), "propertyPaths")] }), { comp: "c1", layers: { "11": "h11" } });
  assert.deepEqual(changedLayers(layerHashIndex(hashed()), structure).layers, [{ compId: "5", layerId: "11" }], "a structure hash is not comparable with a full one");
  assert.deepEqual(changedLayers({ compositions: {} }, hashed()).compositions, ["5"]);
});

test("the merge keeps the rows (and details) the base holds for unchanged layers and takes the read's for changed ones", () => {
  const keyed = (digest: string) => makeLayer("11", 1, { propertyPaths: [entry("ADBE Transform Group/ADBE Position", { valueType: "vector", value: [1, 1], keyframeCount: 2, keyDigest: digest })] });
  const before = withHashes(readSetOf({ layers: [keyed("2:2:old"), makeLayer("12", 2)] }), { comp: "c1", layers: LAYERS });
  const base = toProbeEnvelope(before, null);
  const next = withHashes(readSetOf({ layers: [keyed("2:2:old"), makeLayer("12", 2, { name: "Moved" })] }), { comp: "c2", layers: { "11": "h11", "12": "h12b" } });
  delete next.details;
  const fresh = toProbeEnvelope(next, null);
  const baseComps = rowsAt(base.result.compositions);
  const merged = mergeLayersByHash(baseComps, layerHashIndex(before), next, fresh.result.compositions.filter(isRow));
  const layers = layersOfFirst(merged);
  const position = rowsAt(layers[0]?.propertyPaths).find((row) => row.path === "ADBE Transform Group/ADBE Position");
  assert.equal(position?.keyDigest, "2:2:old", "the digest fetched earlier survives for an unchanged layer");
  assert.equal(layers[1]?.name, "Moved");
  assert.equal(mergeLayersByHash(undefined, layerHashIndex(before), next, fresh.result.compositions.filter(isRow))[0]?.name, "Main");
});

const latestOf = (layers: Row[]) => toProbeEnvelope(readSetOf({ layers }), null);
const textLayer = (id: string, value: JsonValue) => makeLayer(id, 1, { propertyPaths: [entry("ADBE Text Properties/ADBE Text Document", { matchName: "ADBE Text Document", valueType: "unknown", value })] });

test("the details request names only the layers the latest snapshot lacks facts for", () => {
  const reach = { scopes: [{ compId: "5", layerIds: ["11", "12"] }] };
  assert.equal(residualScopes({ scopes: [] }, undefined), null);
  assert.deepEqual(residualScopes(reach, undefined), { scopes: reach.scopes, include: ["textDocument", "keyDigest"], maxLayers: DETAILS_MAX_LAYERS }, "with nothing known the whole reach is requested");
  const complete = latestOf([textLayer("11", { text: "x" }), makeLayer("12", 2)]);
  assert.equal(residualScopes(reach, complete), null, "a text document already read and no keyed property: nothing to fetch");
  const missing = toProbeEnvelope((() => { const read = readSetOf({ layers: [textLayer("11", { text: "x" }), makeLayer("12", 2)] }); delete read.details; return read; })(), null);
  assert.deepEqual(residualScopes(reach, missing)?.scopes, [{ compId: "5", layerIds: ["11"] }]);
  const keyless = latestOf([makeLayer("11", 1, { propertyPaths: [entry("A/B", { keyframeCount: 3 })] }), makeLayer("12", 2)]);
  assert.deepEqual(residualScopes({ scopes: [{ compId: "5" }] }, keyless)?.scopes, [{ compId: "5", layerIds: ["11"] }]);
  assert.deepEqual(residualScopes({ scopes: [{ compId: "9", layerIds: ["1"] }] }, complete)?.scopes, [{ compId: "9", layerIds: ["1"] }], "a composition the snapshot never held is requested as named");
});

test("the details request is bounded by maxLayers", () => {
  const many = Array.from({ length: 300 }, (_, index) => makeLayer(String(index + 1), index + 1, { propertyPaths: [entry("A/B", { keyframeCount: 1 })] }));
  const request = residualScopes({ scopes: [{ compId: "5" }, { compId: "5" }] }, latestOf(many));
  assert.equal(request?.scopes.reduce((total, scope) => total + (scope.layerIds?.length ?? 0), 0), DETAILS_MAX_LAYERS);
  assert.equal(request?.scopes.length, 1, "the budget is spent before a second scope starts");
});

test("the details answer is narrowed and anything malformed is refused whole", () => {
  const good = JSON.stringify({ ok: true, layers: [{ compId: "5", layerId: "11", properties: [{ path: "A/B", value: { text: "x" }, keyDigest: "2:2:ab", keyframeCount: 2 }, { path: "C", keyDigestTruncated: true }] }] });
  assert.deepEqual(parsePropertyDetails(good), { ok: true, layers: [{ compId: "5", layerId: "11", properties: [{ path: "A/B", value: { text: "x" }, keyDigest: "2:2:ab", keyframeCount: 2 }, { path: "C", keyDigestTruncated: true }] }] });
  assert.deepEqual(parsePropertyDetails('{"ok":false,"error":{"code":"TOO_MANY","message":"cap"}}'), { ok: false, layers: [], error: { code: "TOO_MANY", message: "cap" } });
  for (const bad of ["not json", "[]", '{"ok":"yes"}', '{"ok":true,"layers":[{"compId":"5"}]}', '{"ok":true,"layers":[{"compId":"5","layerId":"1","properties":[{"value":1}]}]}', '{"ok":true}']) {
    const result = parsePropertyDetails(bad);
    assert.deepEqual([result.ok, result.layers], [false, []], bad);
  }
});

test("the apply breadcrumb is read with the bounds the probe applied, and a missing or hostile file is none", () => {
  const directory = mkdtempSync(join(tmpdir(), "breadcrumb-"));
  try {
    assert.equal(readApplyBreadcrumb(directory), null, "no file is the normal case");
    const write = (text: string) => writeFileSync(join(directory, "apply-in-flight.json"), text);
    write(JSON.stringify({ planId: "p-1", index: 2, operationCount: 5, operation: "set_layer_name", layerId: "L1", startedAt: "17000" }));
    assert.deepEqual(readApplyBreadcrumb(directory), { planId: "p-1", index: 2, operationCount: 5, operation: "set_layer_name", layerId: "L1", startedAt: "17000" });
    write(JSON.stringify({ planId: "p-1", index: 0, operation: "Bad Name!", startedAt: 5 }));
    assert.deepEqual(readApplyBreadcrumb(directory), { planId: "p-1", index: 0, operationCount: null, operation: null, layerId: null, startedAt: null });
    for (const bad of ['{"planId":"has space","index":1}', '{"planId":"p","index":-1}', '{"planId":"p","index":1.5}', '{"index":1}', "[]", "garbage", ""]) {
      write(bad);
      assert.equal(readApplyBreadcrumb(directory), null, bad);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const styledText = (id: string) => makeLayer(id, 1, { propertyPaths: [entry("ADBE Text Properties/ADBE Text Document", { matchName: "ADBE Text Document", valueType: "unknown", value: { unsupported: "text-document" } })] });
const readAt = (revision: number | null, layers: Row[]) => withHashes(readSetOf({ layers, stamp: { revision } }), { comp: "c1", layers: { "11": "h11", "12": "h12" } });

test("a text layer is reused across equal hashes only at an unchanged project revision, because the hash covers its text and not its styling", () => {
  const layers = () => [styledText("11"), makeLayer("12", 2)];
  const previous = layerHashIndex(readAt(42, layers()));
  assert.equal(previous.compositions["5"]?.layers["11"]?.text, true);
  assert.equal(previous.compositions["5"]?.layers["12"]?.text, false);
  assert.deepEqual(changedLayers(previous, readAt(42, layers())).layers, [], "same hashes, same revision: nothing to refetch");
  assert.deepEqual(changedLayers(previous, readAt(43, layers())).layers, [{ compId: "5", layerId: "11" }], "the project was edited somewhere: only the text layer is asked again");
  assert.deepEqual(changedLayers(layerHashIndex(readAt(null, layers())), readAt(null, layers())).layers, [{ compId: "5", layerId: "11" }], "a read with no revision proves nothing");
});

test("the merge takes a text layer's fresh row after an edit and keeps it at the same revision", () => {
  const held = (digest: string) => makeLayer("11", 1, { name: digest, propertyPaths: styledText("11").propertyPaths ?? [] });
  const before = readAt(42, [held("held"), makeLayer("12", 2)]);
  const base = rowsAt(toProbeEnvelope(before, null).result.compositions);
  const keep = readAt(42, [held("fresh"), makeLayer("12", 2)]);
  const edited = readAt(43, [held("fresh"), makeLayer("12", 2)]);
  const rowsOf = (read: ReturnType<typeof readAt>) => rowsAt(toProbeEnvelope(read, null).result.compositions);
  const nameAt = (read: ReturnType<typeof readAt>) => layersOfFirst(mergeLayersByHash(base, layerHashIndex(before), read, rowsOf(read)))[0]?.name;
  assert.equal(nameAt(keep), "held");
  assert.equal(nameAt(edited), "fresh");
});
