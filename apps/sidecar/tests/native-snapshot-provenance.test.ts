/** Provenance of values the plugin reports as `{unsupported}`: the details call supplies them where it carried one, and they stay null otherwise. */
import type { Opaque } from "../src/snapshot-view.js";
import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENTED_DIFFERENCES, residualScopes, toProbeEnvelope, type DetailKind, type NativeReadSet, type PropertyDetail } from "../src/native-snapshot/index.js";
import { entry, isRow, makeLayer, readSetOf, type Row } from "./native-fixtures.js";

const MARKERS = { count: 1, markers: [{ time: 2, comment: "Beat", duration: 0, chapter: null, url: null, label: 0, cuePointName: null }] };
const PATH = { vertices: [[0, 0], [10, 0], [10, 10]], inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[1, 1], [1, 1], [1, 1]], closed: true };
const MASK = "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape";
const SHAPE = "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vector Shape";

const unsupported = (name: string): Row => ({ unsupported: name });
const layerWith = (): Row => makeLayer("11", 1, {
  propertyPaths: [
    entry("ADBE Marker", { value: unsupported("marker"), valueType: "unknown" }),
    entry(MASK, { value: unsupported("shape-path"), valueType: "unknown" }),
    entry(SHAPE, { value: unsupported("shape-path"), valueType: "unknown" }),
    entry("ADBE Time Remap Ref", { value: unsupported("layer-id"), valueType: "layer" }),
    entry("ADBE Mask Parade/ADBE Mask Atom/ADBE Mask ID", { value: unsupported("mask-id"), valueType: "unknown" }),
    entry("Odd/Thing", { value: unsupported("arbitrary"), valueType: "unknown" }),
  ],
});

const DETAILS: PropertyDetail[] = [{ path: "ADBE Marker", value: MARKERS }, { path: MASK, value: PATH }, { path: SHAPE, value: PATH }, { path: "ADBE Time Remap Ref", value: 3 },
  { path: "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask ID", value: "mask:1" }, { path: "Odd/Thing", value: "no" }];

function readWith(details: PropertyDetail[] | null): NativeReadSet {
  const read = readSetOf({ layers: [layerWith()] });
  delete read.details;
  if (details) read.details = { ok: true, layers: [{ compId: "5", layerId: "11", properties: details }] };
  return read;
}

function values(read: NativeReadSet): Record<string, Opaque> {
  const rowsAt = (value: Opaque): Row[] => (Array.isArray(value) ? value.filter(isRow) : []);
  const composition = rowsAt(toProbeEnvelope(read, null).result.compositions)[0];
  const layer = rowsAt(composition?.layers)[0];
  return Object.fromEntries(rowsAt(layer?.propertyPaths).map((row) => [String(row.path), row.value]));
}

test("details values replace marker, shape-path and layer-id, and mask ids and arbitrary data stay null", () => {
  const found = values(readWith(DETAILS));
  assert.deepEqual(found["ADBE Marker"], MARKERS);
  assert.deepEqual(found[MASK], PATH);
  assert.deepEqual(found[SHAPE], PATH);
  assert.equal(found["ADBE Time Remap Ref"], 3);
  assert.equal(found["ADBE Mask Parade/ADBE Mask Atom/ADBE Mask ID"], null);
  assert.equal(found["Odd/Thing"], null);
});

test("without details every unsupported value is null, and a detail row without a value changes nothing", () => {
  assert.ok(Object.values(values(readWith(null))).every((value) => value === null));
  const keysOnly = readWith([{ path: "ADBE Marker", keyDigest: "1:1:ab" }, { path: MASK }]);
  const found = values(keysOnly);
  assert.equal(found["ADBE Marker"], null);
  assert.equal(found[MASK], null);
});

test("a value the plugin did read is never replaced by a detail", () => {
  const layer = makeLayer("11", 1, { propertyPaths: [entry("ADBE Marker", { value: MARKERS })] });
  const read = readSetOf({ layers: [layer] });
  read.details = { ok: true, layers: [{ compId: "5", layerId: "11", properties: [{ path: "ADBE Marker", value: { count: 0, markers: [] } }] }] };
  assert.deepEqual(values(read)["ADBE Marker"], MARKERS);
});

const reach = { scopes: [{ compId: "5", layerIds: ["11"] }] };

test("residualScopes asks for the new kinds that are missing and no others", () => {
  const latest = toProbeEnvelope(readWith(null), null);
  const request = residualScopes(reach, latest);
  assert.deepEqual(request?.scopes, [{ compId: "5", layerIds: ["11"] }]);
  assert.deepEqual(request?.include, ["marker", "maskPath", "shapePath", "layerRef"]);
  assert.deepEqual(residualScopes(reach, latest, ["marker"])?.include, ["marker"]);
  assert.deepEqual(residualScopes(reach, latest, ["layerRef", "textDocument"])?.include, ["layerRef"]);
  assert.equal(residualScopes(reach, latest, ["textDocument", "keyDigest"]), null, "kinds the plan does not need are not requested");
});

test("residualScopes is satisfied once the details call has supplied the values", () => {
  assert.equal(residualScopes(reach, toProbeEnvelope(readWith(DETAILS), null)), null);
});

test("with nothing known the request lists the given kinds, or text documents and key digests", () => {
  const wanted: DetailKind[] = ["layerRef", "marker"];
  assert.deepEqual(residualScopes(reach, undefined, wanted)?.include, ["marker", "layerRef"]);
  assert.deepEqual(residualScopes(reach, undefined)?.include, ["textDocument", "keyDigest"]);
});

test("the documented differences say the details call supplies the value where a plan reaches", () => {
  const row = DOCUMENTED_DIFFERENCES.find((difference) => difference.field.startsWith("property value of marker"));
  assert.match(row?.native ?? "", /null, else details value/);
  assert.match(row?.reason ?? "", /aeReadPropertyDetails/);
});
