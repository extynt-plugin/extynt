/**
 * create_vector_artwork on the host: AE's native importer first, extynt's converted shape layers when it refuses.
 * The fake importer is told how to behave; the layers below have the form the sidecar's converter emits.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { type ApplyPlanOptions, FakeCompItem, FakeFolderItem, type FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { childrenNamed, itemAt, shapeRoot } from "./host-fake-lookup.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { evaluateJson } from "./host-vm-context.js";
import { fieldOf, fieldsOf, listAt, recordOf, textAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="20" height="10" fill="#f00"/></svg>';
const SOURCE_HASH = "c".repeat(64);
const METADATA = { bytes: Buffer.byteLength(SVG), elements: 2, maxDepth: 1, pathCommands: 0, gradientStops: 0, gradients: 0, masks: 0, clipPaths: 0, sourceHash: SOURCE_HASH };
const LAYERS: ReadonlyArray<JsonValue> = [
  { name: "badge", shapes: [{ name: "rect 1", paths: [{ vertices: [[0, 0], [20, 0], [20, 10], [0, 10]], closed: true }], fill: { color: [1, 0, 0] } }] },
  {
    name: "ring",
    shapes: [{
      name: "path 2",
      paths: [{ vertices: [[0, 0], [10, 0]], inTangents: [[0, 0], [-3, 0]], outTangents: [[3, 0], [0, 0]], closed: false }],
      stroke: { color: [0, 0, 1], width: 2, cap: 2 },
      opacity: 50,
    }],
  },
];
const NOTES = { approximated: ["gradient"], skipped: ["text"] };
const FALLBACK: JsonObject = { fallbackLayers: LAYERS, fallbackSize: [64, 48], fallbackNotes: NOTES };
const NO_NATIVE_CALLS = { options: 0, canImportAs: 0, importFile: 0 };
const VERSION_ROUTE: JsonObject = { importer: "converter", importerAeVersion: "25.6" };
const UNAVAILABLE_REASON = "the SVG has more than 256 shapes; the converter fallback is unavailable";

function vectorOperation(extra: JsonObject): JsonObject {
  return {
    operation: "create_vector_artwork",
    newItemId: "__new__:vector",
    name: "Badge",
    svg: SVG,
    sourceHash: SOURCE_HASH,
    metadata: METADATA,
    importMode: "editable",
    managedSourcePolicy: "retain",
    durationSeconds: 6,
    frameRate: 24,
    ...extra,
  };
}

function applyVector(options: ApplyPlanOptions, extra: JsonObject = {}, before: ReadonlyArray<JsonObject> = []) {
  const harness = loadApplyPlan(options);
  const result = applyPlan(harness.apply, "svg-fallback", [...before, vectorOperation(extra)]);
  const compNamed = (name: string) => harness.projectItems.find((item): item is FakeCompItem => item instanceof FakeCompItem && item.name === name);
  const step = fieldOf(result, "ok") === true ? recordOf(listAt(result, "steps").at(-1)) : {};
  return { ...harness, result, compNamed, step };
}

function layerRoots(comp: FakeCompItem | undefined) {
  return (comp?.layerItems ?? []).map(shapeRoot);
}

function childNamedOrNone(parent: FakeProperty | undefined, matchName: string): FakeProperty | undefined {
  return parent ? childrenNamed(parent, matchName).at(0) : undefined;
}

test("native import stays the first choice and reports itself as native", () => {
  const { result, step, compNamed } = applyVector({ nativeSvg: "ok" }, FALLBACK);
  assertApplied(result);
  assert.equal(fieldOf(step, "importer"), "native");
  assert.equal(fieldOf(step, "verification"), "managed-svg-written-and-native-shape-composition-imported");
  assert.equal(fieldOf(step, "importNote"), undefined);
  assert.equal(fieldOf(step, "nativeFailure"), undefined);
  assert.equal(compNamed("Badge")?.layerItems.length, 1);
});

test("when the native importer refuses, the converter builds the comp with a shape layer per top-level element", () => {
  const { result, step, compNamed } = applyVector({ nativeSvg: "refuse" }, FALLBACK);
  assertApplied(result);
  assert.equal(fieldOf(step, "importer"), "converted");
  assert.equal(fieldOf(step, "verification"), "managed-svg-written-and-converted-shape-layers-built");
  assert.equal(fieldOf(step, "importNote"), "Imported with extynt's converter (AE's SVG importer refused: SVG_IMPORT_UNSUPPORTED)");
  assert.equal(fieldOf(step, "nativeFailure", "code"), "SVG_IMPORT_UNSUPPORTED");
  assert.deepEqual(fieldOf(step, "converterNotes"), NOTES);
  const comp = compNamed("Badge");
  assert.ok(comp, "the converted comp carries the operation's name");
  assert.deepEqual([comp.width, comp.height, comp.duration, comp.frameRate], [64, 48, 6, 24]);
  assert.deepEqual(comp.layerItems.map((layer) => layer.name), ["badge", "ring"]);
  assert.equal(comp.layerItems.every((layer) => layer.inPoint === 0 && layer.outPoint === 6), true);
  assert.deepEqual(fieldsOf(step, ["layerCount", "nativeShapeLayers", "width", "height", "durationSeconds", "frameRate"]), [2, 2, 64, 48, 6, 24]);
  assert.equal(fieldOf(step, "persistsAfterUndo"), true);
  assert.equal(fieldOf(step, "sourceHash"), SOURCE_HASH);
});

test("the converted layers hold the drawn shapes, paint and tangents", () => {
  const roots = layerRoots(applyVector({ nativeSvg: "refuse" }, FALLBACK).compNamed("Badge"));
  assert.deepEqual(roots.map((root) => root.children.map((group) => group.name)), [["rect 1"], ["path 2"]]);
  const contents = childNamedOrNone(itemAt(roots, 1).children[0], "ADBE Vectors Group");
  assert.deepEqual(contents?.children.map((member) => member.matchName), ["ADBE Vector Shape - Group", "ADBE Vector Graphic - Stroke"]);
  const stroke = contents?.children[1];
  assert.equal(childNamedOrNone(stroke, "ADBE Vector Stroke Width")?.value, 2);
  assert.equal(childNamedOrNone(stroke, "ADBE Vector Stroke Line Cap")?.value, 2);
});

test("the importer throwing, or importing a comp with no shape layer, also falls back; the empty native comp is removed", () => {
  const thrown = applyVector({ nativeSvg: "throw" }, FALLBACK);
  assert.equal(fieldOf(thrown.step, "importer"), "converted");
  assert.equal(fieldOf(thrown.step, "nativeFailure", "code"), "SVG_IMPORT_FAILED");
  const empty = applyVector({ nativeSvg: "empty" }, FALLBACK);
  assert.equal(fieldOf(empty.step, "importer"), "converted");
  assert.equal(fieldOf(empty.step, "nativeFailure", "code"), "SVG_NATIVE_SHAPES_NOT_CREATED");
  assert.equal(empty.compNamed("vector.svg")?.removed, true);
});

test("a returned native comp with no shape layer takes the folder the importer added with it", () => {
  const { projectItems, step } = applyVector({ nativeSvg: "emptyWithFolder" }, FALLBACK);
  assert.equal(fieldOf(step, "importer"), "converted");
  const folder = projectItems.find((item): item is FakeFolderItem => item instanceof FakeFolderItem && item.name === "vector.svg folder");
  assert.equal(folder?.removed, true, "the importer's sibling folder is not left behind");
});

test("AE 26.2.1 imports the composition but returns null or nothing: the one new comp is the native result", () => {
  for (const nativeSvg of ["null", "undefined"] as const) {
    const { result, step, compNamed, projectItems } = applyVector({ nativeSvg }, FALLBACK);
    assertApplied(result);
    assert.equal(fieldOf(step, "importer"), "native", nativeSvg);
    assert.equal(fieldOf(step, "verification"), "managed-svg-written-and-native-shape-composition-imported");
    assert.equal(fieldOf(step, "nativeFailure"), undefined);
    assert.equal(fieldOf(step, "importNote"), undefined);
    const comp = compNamed("Badge");
    assert.equal(comp?.layerItems.length, 1, "the comp AE added is renamed and kept, not rebuilt");
    assert.deepEqual([comp?.duration, comp?.frameRate, comp?.removed], [6, 24, false]);
    assert.equal(projectItems.filter((item) => item instanceof FakeCompItem && item.name === "Badge").length, 1);
    assert.equal(compNamed("vector.svg"), undefined);
  }
});

test("the adoption is recorded in the importer's evidence", () => {
  const { context, writtenFiles } = loadApplyPlan({ nativeSvg: "null" });
  writtenFiles.set("/managed/adopt.svg", 10);
  vm.runInContext('var __file = new File("/managed/adopt.svg"), __evidence = aeApplySvgEvidence(__file); var __adopted = aeApplyImportVectorComp(__file, __evidence);', context);
  assert.equal(fieldOf(evaluateJson(context, "__evidence"), "importFile"), "returned null; adopted the one new composition AE added");
  assert.equal(evaluateJson(context, "__adopted.name"), "vector.svg");
});

test("an import that adds more than the one composition is removed whole and falls back", () => {
  const { result, step, projectItems, compNamed } = applyVector({ nativeSvg: "two" }, FALLBACK);
  assertApplied(result);
  assert.equal(fieldOf(step, "importer"), "converted");
  assert.equal(fieldOf(step, "nativeFailure", "code"), "SVG_IMPORT_FAILED");
  assert.equal(fieldOf(step, "nativeFailure", "evidence", "importFile"), "returned null; AE added 2 items, removed 2");
  const added = projectItems.filter((item) => String(item.id).startsWith("imported-"));
  assert.equal(added.length, 2);
  assert.equal(added.every((item) => item.removed), true, "nothing the import added is left in the project");
  assert.equal(compNamed("Badge")?.removed, false);
  assert.equal(fieldOf(applyVector({ nativeSvg: "two" }).result, "ok"), false, "without converted layers it is the failure it always was");
});

test("a single new item that is not a composition is removed, and the import is a failure", () => {
  const { step, projectItems } = applyVector({ nativeSvg: "footage" }, FALLBACK);
  assert.equal(fieldOf(step, "importer"), "converted");
  assert.equal(fieldOf(step, "nativeFailure", "evidence", "importFile"), "returned null; AE added 1 item, removed 1");
  assert.equal(projectItems.find((item) => String(item.id).startsWith("imported-"))?.removed, true);
});

test("the failure evidence names what the importer reported", () => {
  const { step } = applyVector({ nativeSvg: "refuse" }, FALLBACK);
  assert.deepEqual(fieldOf(step, "nativeFailure", "evidence", "canImportAs"), { COMP_CROPPED_LAYERS: "false", COMP: "false" });
  assert.equal(fieldOf(step, "nativeFailure", "evidence", "importOptions"), "function");
  assert.equal(fieldOf(step, "nativeFailure", "evidence", "extension"), ".svg");
});

test("without converted layers a native refusal is still the failure it always was", () => {
  const { result } = applyVector({ nativeSvg: "refuse" });
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "SVG_IMPORT_UNSUPPORTED");
  const unavailable = applyVector({ nativeSvg: "refuse" }, { fallbackUnavailable: UNAVAILABLE_REASON });
  assert.equal(fieldOf(unavailable.result, "error", "code"), "SVG_IMPORT_UNSUPPORTED");
});

test("a converted comp is named and filed exactly like a native one", () => {
  const folder: JsonObject = { operation: "create_folder", newFolderId: "__new__:folder0", name: "Artwork" };
  const { result, compNamed } = applyVector({ nativeSvg: "refuse" }, { ...FALLBACK, destinationFolderId: "__new__:folder0" }, [folder]);
  assertApplied(result);
  assert.equal(compNamed("Badge")?.parentFolder?.name, "Artwork");
});

test("a converted comp that cannot finish is removed, not left half built", () => {
  const { result, compNamed } = applyVector({ nativeSvg: "refuse", shapeLayerFailure: true }, FALLBACK);
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(compNamed("Badge")?.removed, true);
});

test("the native attempt runs inside the run's one dialog suppression, never a nested one", () => {
  const { dialogs } = applyVector({ nativeSvg: "refuse" }, FALLBACK);
  assert.equal(dialogs.begin, dialogs.end);
  assert.equal(dialogs.begin, 1, "only the apply run suppresses dialogs; a nested end could switch suppression off mid-run");
  const native = applyVector({ nativeSvg: "ok" }, FALLBACK).dialogs;
  assert.equal(native.begin, native.end);
});

function vectorShapes(count: number): JsonValue[] {
  return Array.from({ length: count }, (_, index) => ({ name: `s${index}`, paths: [{ vertices: [[0, 0], [1, 1]], closed: false }], stroke: { color: [0, 0, 0], width: 1 } }));
}

function singleLayer(shapeCount: number): JsonObject {
  return { fallbackLayers: [{ name: "a", shapes: vectorShapes(shapeCount) }], fallbackSize: [10, 10] };
}

function invalidFallbacks(): JsonObject[] {
  const unnamedShape = { name: "x", shapes: [{ name: "s", paths: [{ vertices: [[0, 0], [1, 1]], closed: false }] }] };
  return [
    { fallbackLayers: [unnamedShape], fallbackSize: [10, 10] },
    { ...FALLBACK, fallbackSize: [64.5, 48] },
    { ...FALLBACK, fallbackSize: [0, 48] },
    { fallbackLayers: LAYERS },
    { fallbackSize: [64, 48] },
    { ...FALLBACK, fallbackNotes: { approximated: "gradient", skipped: [] } },
    { ...FALLBACK, fallbackNotes: { approximated: [], skipped: [3] } },
    { ...FALLBACK, fallbackUnavailable: "also unavailable" },
    { fallbackUnavailable: 5 },
    { fallbackLayers: [], fallbackSize: [10, 10] },
    { fallbackLayers: [{ name: "", shapes: vectorShapes(1) }], fallbackSize: [10, 10] },
    { fallbackLayers: [{ name: "a", shapes: vectorShapes(200) }, { name: "b", shapes: vectorShapes(100) }], fallbackSize: [10, 10] },
    singleLayer(257),
  ];
}

test("the fallback fields are validated before anything runs", () => {
  for (const extra of invalidFallbacks()) {
    const { result } = applyVector({ nativeSvg: "ok" }, extra);
    assert.equal(fieldOf(result, "ok"), false, JSON.stringify(extra).slice(0, 120));
    assert.equal(fieldOf(result, "error", "code"), "INVALID_VALUE", textAt(result, "error", "message"));
  }
  assert.equal(fieldOf(applyVector({ nativeSvg: "ok" }, { fallbackUnavailable: "too big" }).result, "ok"), true);
  assert.equal(fieldOf(applyVector({ nativeSvg: "ok" }, singleLayer(256)).result, "ok"), true);
});

test("routed by version, the converter builds the comp and the native importer is never touched", () => {
  const { result, step, compNamed, nativeCalls } = applyVector({ nativeSvg: "ok" }, { ...FALLBACK, ...VERSION_ROUTE });
  assertApplied(result);
  assert.deepEqual(nativeCalls, NO_NATIVE_CALLS, "no ImportOptions, canImportAs or importFile call");
  assert.equal(fieldOf(step, "importer"), "converted");
  assert.equal(fieldOf(step, "verification"), "managed-svg-written-and-converted-shape-layers-built");
  assert.equal(fieldOf(step, "importNote"), "Built with extynt's converter (After Effects 25.6 has no SVG importer)");
  assert.equal(fieldOf(step, "nativeFailure"), undefined);
  assert.deepEqual(fieldOf(step, "converterNotes"), NOTES);
  assert.deepEqual(compNamed("Badge")?.layerItems.map((layer) => layer.name), ["badge", "ring"]);
  assert.deepEqual(fieldsOf(step, ["layerCount", "nativeShapeLayers", "width", "height"]), [2, 2, 64, 48]);
});

test("forced by the development switch the note says so and the native importer is still never touched", () => {
  const { step, nativeCalls } = applyVector({ nativeSvg: "ok" }, { ...FALLBACK, importer: "converter" });
  assert.deepEqual(nativeCalls, NO_NATIVE_CALLS);
  assert.equal(fieldOf(step, "importer"), "converted");
  assert.equal(fieldOf(step, "importNote"), "Built with extynt's converter (forced by the development switch)");
});

test("without an importer route the native importer is still tried first", () => {
  const { nativeCalls } = applyVector({ nativeSvg: "ok" }, FALLBACK);
  assert.equal(nativeCalls.importFile, 1);
});

test("routed by version with no converter fallback, the apply fails clearly and never asks the native importer", () => {
  const { result, nativeCalls } = applyVector({ nativeSvg: "ok" }, { ...VERSION_ROUTE, fallbackUnavailable: UNAVAILABLE_REASON });
  assert.equal(fieldOf(result, "ok"), false);
  assert.equal(fieldOf(result, "error", "code"), "SVG_IMPORT_UNSUPPORTED");
  assert.equal(textAt(result, "error", "message"), `SVG_IMPORT_UNSUPPORTED: After Effects 25.6 has no SVG importer and this SVG exceeds extynt's converter limits: ${UNAVAILABLE_REASON}`);
  assert.deepEqual(nativeCalls, NO_NATIVE_CALLS);
});

test("a malformed route is refused before anything is written", () => {
  const routes: ReadonlyArray<JsonObject> = [{ importer: "native" }, { importerAeVersion: "25.6" }, { importer: "converter", importerAeVersion: "x" }];
  for (const route of routes) {
    assert.equal(fieldOf(applyVector({}, { ...FALLBACK, ...route }).result, "error", "code"), "INVALID_VALUE");
  }
});
