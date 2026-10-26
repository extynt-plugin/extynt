/** aeReadPropertyDetails: Source Text and keyframe digests at the probe's own paths, bounded, read-only. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { FakeComp, FakeFootage, FakeLayer, FakeProp, type FakeKey, PROPERTY_TYPES, VALUE_TYPES, fakeApp, fakePath, pathLayer, sampleLayer, type FakeItem } from "./host-details-fakes.js";
import { type HostContext, callEntry, callJson, loadHostContext } from "./host-vm-context.js";
import { fieldOf, recordAt, recordsAt, recordsOf, textAt } from "./json-narrow.js";

const BOTH = ["textDocument", "keyDigest"];
const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
const PATH_VALUE = { vertices: SQUARE, inTangents: SQUARE.map(() => [0, 0]), outTangents: SQUARE.map(() => [1, -1]), closed: true };
const MASK_PATH = "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape";
const SHAPE_PATH = "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group/ADBE Vector Shape";
const ALL_INCLUDES = ["marker", "maskPath", "shapePath", "layerRef", "textDocument", "keyDigest", "marker"];

const PROBE_ROWS = `(function () {
  aeProbeReadStartedAt = (new Date()).getTime();
  aeProbeReadProperties = 0;
  aeProbeReadProgress = 0;
  var config = { maxReadMs: 1e9, maxTotalProperties: 1e9, maxProjectItems: 1e9, maxPropertiesPerLayer: 512, maxPropertyDepth: 8 };
  var rows = aeProbePropertyPaths(fixture, config, []), out = [];
  for (var i = 0; i < rows.length; i += 1) {
    if (rows[i].matchName === "ADBE Text Document" || rows[i].keyframeCount > 0) {
      out.push({ path: rows[i].path, matchName: rows[i].matchName, value: rows[i].value, keyframeCount: rows[i].keyframeCount, keyDigest: rows[i].keyDigest });
    }
  }
  return out;
})()`;

function scope(compId: string, layerIds?: string[]): JsonObject {
  return layerIds ? { compId, layerIds } : { compId };
}

function setup(items: FakeItem[], fixture: FakeLayer | null = null, withItemById = true): HostContext {
  return loadHostContext({ app: fakeApp(items, withItemById), CompItem: FakeComp, PropertyType: PROPERTY_TYPES, PropertyValueType: VALUE_TYPES, fixture });
}

function details(host: HostContext, request: JsonValue): JsonObject {
  return callEntry(host, "aeReadPropertyDetails", JSON.stringify(request));
}

function propertiesOf(result: JsonObject): JsonObject[] {
  return recordsAt(result, "layers", 0, "properties");
}

function pathsOf(rows: readonly JsonObject[]): JsonValue[] {
  return rows.map((row) => fieldOf(row, "path") ?? null);
}

function layerIdsOf(result: JsonObject): JsonValue[] {
  return recordsAt(result, "layers").map((layer) => fieldOf(layer, "layerId") ?? null);
}

function byPath(left: JsonObject, right: JsonObject): number {
  return textAt(left, "path").localeCompare(textAt(right, "path"));
}

function markerKey(index: number): FakeKey {
  return [index / 25, { comment: "m" + index, duration: index % 2, chapter: "", url: "", label: 1, cuePointName: "" }];
}

function markerTrack(count: number, key: (index: number) => FakeKey): FakeProp {
  const keys = Array.from({ length: count }, (_unused, index) => key(index + 1));
  return new FakeProp("ADBE Marker", "Marker", [], null, keys);
}

function pathRows(include: string[], layer = pathLayer(3)): { rows: JsonObject[]; result: JsonObject } {
  const result = details(setup([new FakeComp(5, [layer])]), { scopes: [scope("5")], include });
  return { rows: propertiesOf(result), result };
}

const MALFORMED_REQUESTS: JsonValue[] = [
  [],
  { include: BOTH },
  { scopes: [], include: BOTH },
  { scopes: [scope("5")] },
  { scopes: [scope("5")], include: [] },
  { scopes: [scope("5")], include: ["bogus"] },
  { scopes: [scope("5")], include: ["marker", 7] },
  { scopes: [scope("5")], include: ALL_INCLUDES },
  { scopes: [{ layerIds: [] }], include: BOTH },
  { scopes: [scope("x")], include: BOTH },
  { scopes: [{ compId: "5", layerIds: "1" }], include: BOTH },
  { scopes: [{ compId: "5", layerIds: [1] }], include: BOTH },
  { scopes: [scope("5")], include: BOTH, maxLayers: 0 },
  { scopes: [scope("5")], include: BOTH, maxLayers: 1.5 },
  { scopes: [scope("5")], include: BOTH, maxLayers: "3" },
  { scopes: scope("5"), include: BOTH },
];

test("paths, text value, key count and digest match the probe walk, and nothing else is listed", () => {
  const layer = sampleLayer(12);
  const host = setup([new FakeComp(5, [layer])], layer);
  const result = details(host, { scopes: [scope("5")], include: BOTH, maxLayers: 256 });
  assert.equal(fieldOf(result, "ok"), true);
  const rows = propertiesOf(result).sort(byPath);
  const probe = recordsOf(callJson(host, PROBE_ROWS)).sort(byPath);
  assert.equal(rows.length, 7);
  assert.deepEqual(pathsOf(rows), pathsOf(probe));
  for (const [index, row] of rows.entries()) {
    const expected = probe[index] ?? {};
    assert.equal(fieldOf(row, "keyDigest"), fieldOf(expected, "keyDigest"), textAt(row, "path"));
    assert.equal(fieldOf(row, "keyframeCount"), fieldOf(expected, "keyframeCount"), textAt(row, "path"));
    if (fieldOf(expected, "matchName") === "ADBE Text Document") assert.deepEqual(fieldOf(row, "value"), fieldOf(expected, "value"));
    else assert.equal("value" in row, false, "only Source Text carries a value");
  }
});

test("paths use matchName segments, escapes and per-group repeat suffixes", () => {
  const host = setup([new FakeComp(5, [sampleLayer(12)])]);
  const paths = pathsOf(propertiesOf(details(host, { scopes: [scope("5")], include: BOTH })));
  assert.deepEqual(paths, [
    "ADBE Text Properties/ADBE Text Document",
    "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator/ADBE Text Animator Properties/ADBE Text Opacity",
    "ADBE Text Properties/ADBE Text Animators/ADBE Text Animator#2/ADBE Text Animator Properties/ADBE Text Opacity",
    "ADBE Transform Group/ADBE Position",
    "ADBE Effect Parade/ADBE Gaussian Blur 2/ADBE Gaussian Blur 2-0001",
    "ADBE Effect Parade/ADBE Gaussian Blur 2#2/ADBE Gaussian Blur 2-0001",
    "dropShadow%2Fmode2/a%25b%23c",
  ]);
});

test("the text document value carries the probe's compact fields", () => {
  const host = setup([new FakeComp(5, [sampleLayer(12)])]);
  const rows = propertiesOf(details(host, { scopes: [scope("5")], include: ["textDocument"] }));
  assert.equal(rows.length, 1);
  assert.equal(fieldOf(rows[0], "value", "text"), "Hello");
  assert.equal(fieldOf(rows[0], "value", "fontSize"), 40);
  assert.equal("keyDigest" in (rows[0] ?? {}), false);
});

test("key digest alone lists only keyed leaves with a count, a digest and no value", () => {
  const host = setup([new FakeComp(5, [sampleLayer(12)])]);
  const rows = propertiesOf(details(host, { scopes: [scope("5")], include: ["keyDigest"] }));
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(typeof fieldOf(row, "keyDigest"), "string");
    assert.equal(typeof fieldOf(row, "keyframeCount"), "number");
    assert.equal("value" in row, false);
  }
  assert.match(textAt(rows, 2, "keyDigest"), /^2:2:[0-9a-f]+$/);
});

test("a Source Text that is also keyed gets both facts", () => {
  const keyedText = new FakeProp("ADBE Text Document", "Source Text", [], { text: "A", fontStyle: "Regular" }, [[0, 1]]);
  const layer = new FakeLayer(1, "T", [new FakeProp("ADBE Text Properties", "Text", [keyedText])]);
  const rows = propertiesOf(details(setup([new FakeComp(5, [layer])]), { scopes: [scope("5")], include: BOTH }));
  assert.equal(rows.length, 1);
  assert.equal(fieldOf(rows[0], "value", "text"), "A");
  assert.equal(fieldOf(rows[0], "keyframeCount"), 1);
});

test("layerIds filter keeps comp order and reports ids that were not found", () => {
  const comp = new FakeComp(5, [sampleLayer(11), sampleLayer(12), sampleLayer(13)]);
  const result = details(setup([comp]), { scopes: [scope("5", ["13", "11", "99"])], include: BOTH });
  assert.deepEqual(layerIdsOf(result), ["11", "13"]);
  assert.deepEqual(fieldOf(result, "warnings"), ["layer-not-found:5:99"]);
  const none = details(setup([comp]), { scopes: [scope("5", [])], include: BOTH });
  assert.deepEqual(fieldOf(none, "layers"), []);
});

test("maxLayers caps the layers read across scopes, and the cap is hard at 256", () => {
  const first = new FakeComp(5, [sampleLayer(1), sampleLayer(2), sampleLayer(3)]);
  const second = new FakeComp(6, [sampleLayer(4)]);
  const capped = details(setup([first, second]), { scopes: [scope("5"), scope("6")], include: ["textDocument"], maxLayers: 2 });
  assert.deepEqual(layerIdsOf(capped), ["1", "2"]);
  assert.deepEqual(fieldOf(capped, "warnings"), ["max-layers-reached"]);
  const many = new FakeComp(7, Array.from({ length: 300 }, (_unused, index) => new FakeLayer(index + 1, "L", [])));
  const big = details(setup([many]), { scopes: [scope("7")], include: BOTH, maxLayers: 1000 });
  assert.equal(recordsAt(big, "layers").length, 256);
  assert.deepEqual(fieldOf(big, "warnings"), ["max-layers-reached"]);
  assert.equal(recordsAt(details(setup([many]), { scopes: [scope("7")], include: BOTH }), "layers").length, 256, "the default is the cap");
});

test("an unknown comp id and a non-composition item are skipped with a warning", () => {
  const host = setup([new FakeComp(5, [sampleLayer(1)]), new FakeFootage(9)]);
  const result = details(host, { scopes: [scope("404"), scope("9"), scope("5")], include: ["textDocument"] });
  assert.deepEqual(fieldOf(result, "warnings"), ["comp-not-found:404", "comp-not-found:9"]);
  assert.equal(recordsAt(result, "layers").length, 1);
  const walked = details(setup([new FakeComp(5, [sampleLayer(1)])], null, false), { scopes: [scope("5")], include: ["textDocument"] });
  assert.equal(recordsAt(walked, "layers").length, 1, "without itemByID the comp is found by walking the items");
});

test("a call over its property budget stops between layers, always reads the first, and says so", () => {
  const host = setup([new FakeComp(5, [sampleLayer(1), sampleLayer(2), sampleLayer(3)])]);
  host.call("AE_DETAILS_MAX_PROPERTIES = 1");
  const result = details(host, { scopes: [scope("5")], include: BOTH });
  assert.equal(fieldOf(result, "ok"), true);
  assert.deepEqual(layerIdsOf(result), ["1"], "the first layer is never refused, so every call advances");
  assert.deepEqual(fieldOf(result, "warnings"), ["details-budget-reached"]);
  const next = details(host, { scopes: [scope("5", ["2", "3"])], include: BOTH });
  assert.deepEqual(layerIdsOf(next), ["2"], "the layers left are asked for again");
});

test("a marker list past the limit says it was cut", () => {
  const layer = new FakeLayer(3, "Many", [markerTrack(1200, (index) => [index, { comment: "m" + index, duration: 0, chapter: "", url: "", label: 0, cuePointName: "" }])]);
  const result = details(setup([new FakeComp(5, [layer])]), { scopes: [scope("5")], include: ["marker"] });
  const rows = propertiesOf(result);
  assert.equal(fieldOf(rows[0], "value", "count"), 1200);
  assert.equal(fieldOf(rows[0], "value", "truncated"), true);
  assert.equal(recordsAt(rows[0], "value", "markers").length, 1000);
});

test("markerCompositions returns the composition's own marker rows, all of them for hundreds of markers, with no layer scope", () => {
  const host = setup([new FakeComp(5, [], markerTrack(400, markerKey))]);
  const result = details(host, { scopes: [], include: ["marker"], markerCompositions: ["5"] });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(recordsAt(result, "layers").length, 0);
  assert.equal(fieldOf(result, "compositions", 0, "compId"), "5");
  assert.equal(fieldOf(result, "compositions", 0, "markers", "count"), 400);
  assert.equal("truncated" in recordAt(result, "compositions", 0, "markers"), false);
  const rows = recordsAt(result, "compositions", 0, "markers", "markers");
  assert.equal(rows.length, 400);
  assert.deepEqual(rows[2], { time: 3 / 25, comment: "m3", duration: 1, chapter: null, url: null, label: 1, cuePointName: null });
});

test("markerCompositions rides beside layer scopes, skips an unknown composition with a warning, and must hold digit ids", () => {
  const host = setup([new FakeComp(5, [sampleLayer(12)], markerTrack(1, markerKey))]);
  const result = details(host, { scopes: [scope("5")], include: BOTH, markerCompositions: ["5", "99"] });
  assert.equal(recordsAt(result, "layers").length, 1);
  assert.equal(recordsAt(result, "compositions").length, 1);
  assert.deepEqual(fieldOf(result, "warnings"), ["comp-not-found:99"]);
  assert.equal(fieldOf(details(host, { scopes: [], include: BOTH, markerCompositions: ["x"] }), "ok"), false);
  assert.equal(fieldOf(details(host, { scopes: [], include: BOTH }), "ok"), false, "an empty request still names nothing to read");
  assert.equal("compositions" in details(host, { scopes: [scope("5")], include: BOTH }), false, "no composition rows unless asked for");
});

test("a malformed request is INVALID_COMMAND", () => {
  const host = setup([new FakeComp(5, [sampleLayer(1)])]);
  for (const request of MALFORMED_REQUESTS) assert.equal(fieldOf(details(host, request), "error", "code"), "INVALID_COMMAND", JSON.stringify(request));
  assert.equal(fieldOf(callEntry(host, "aeReadPropertyDetails", "not json"), "error", "code"), "INVALID_COMMAND");
});

test("without an open project the read refuses NO_PROJECT", () => {
  const host = loadHostContext({ app: { project: null }, CompItem: FakeComp, PropertyType: PROPERTY_TYPES, PropertyValueType: VALUE_TYPES });
  const result = details(host, { scopes: [scope("5")], include: BOTH });
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "NO_PROJECT");
});

test("the read never writes: every setter, undo and command call on the fake host throws", () => {
  const layer = sampleLayer(12);
  const before = JSON.stringify(layer);
  const result = details(setup([new FakeComp(5, [layer])]), { scopes: [scope("5")], include: BOTH });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(JSON.stringify(layer), before);
});

test("marker returns the probe's marker list at the marker path and nothing else", () => {
  const { rows } = pathRows(["marker"]);
  assert.deepEqual(pathsOf(rows), ["ADBE Marker"]);
  assert.equal(fieldOf(rows[0], "value", "count"), 2);
  assert.deepEqual(fieldOf(rows[0], "value", "markers", 1), { time: 3, comment: "B", duration: 1.5, chapter: "C1", url: "u", label: 0, cuePointName: "cue" });
  assert.equal(fieldOf(rows[0], "value", "markers", 0, "chapter"), null);
});

test("maskPath returns plain vertices, tangents and closed at the mask shape path", () => {
  const { rows } = pathRows(["maskPath"]);
  assert.deepEqual(pathsOf(rows), [MASK_PATH]);
  assert.deepEqual(fieldOf(rows[0], "value"), PATH_VALUE);
});

test("shapePath returns the same value for a vector shape leaf, and never the mask path", () => {
  const { rows } = pathRows(["shapePath"]);
  assert.deepEqual(pathsOf(rows), [SHAPE_PATH]);
  assert.deepEqual(fieldOf(rows[0], "value"), PATH_VALUE);
});

test("layerRef returns the numeric layer index of a layer-valued leaf", () => {
  const { rows } = pathRows(["layerRef"]);
  assert.deepEqual(rows.map((row) => [fieldOf(row, "path"), fieldOf(row, "value")]), [["ADBE Time Remap Ref", 4]]);
});

test("a kind that was not asked for is not returned, and every kind together lists them all", () => {
  assert.deepEqual(pathsOf(pathRows(["keyDigest"]).rows), ["ADBE Marker"]);
  assert.equal(pathRows(["textDocument"]).rows.length, 0);
  const all = pathsOf(pathRows(["marker", "maskPath", "shapePath", "layerRef", "marker"]).rows).sort();
  assert.deepEqual(all, ["ADBE Marker", "ADBE Time Remap Ref", MASK_PATH, SHAPE_PATH].sort());
});

test("an unreadable path value is omitted, and a path over the vertex cap is skipped with a warning", () => {
  const broken = pathRows(["maskPath", "shapePath"], pathLayer(3, fakePath([[0, "x"]])));
  assert.equal(broken.rows.length, 0);
  assert.equal(fieldOf(broken.result, "warnings"), undefined);
  const open = pathRows(["maskPath"], pathLayer(3, fakePath(SQUARE, "yes")));
  assert.equal(open.rows.length, 0);
  const huge = pathRows(["maskPath", "shapePath"], pathLayer(3, fakePath(Array.from({ length: 1001 }, () => [1, 2]))));
  assert.equal(huge.rows.length, 0);
  assert.deepEqual(fieldOf(huge.result, "warnings"), [`value-too-large:${MASK_PATH}`, `value-too-large:${SHAPE_PATH}`]);
  const edge = pathRows(["maskPath"], pathLayer(3, fakePath(Array.from({ length: 1000 }, () => [1, 2]))));
  assert.equal(edge.rows.length, 1);
});

test("reading the new kinds never writes and the host file stays ES5-clean", () => {
  const layer = pathLayer(3);
  const before = JSON.stringify(layer);
  const { result } = pathRows(["marker", "maskPath", "shapePath", "layerRef"], layer);
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(JSON.stringify(layer), before);
  const source = readFileSync("apps/panel/host/read-details.jsx", "utf8");
  assert.doesNotMatch(source, /\b(?:let|const)\s|=>|\.forEach\(|\.map\(|\.filter\(|\.trim\(|\.bind\(|Array\.isArray|Object\.keys/);
});
