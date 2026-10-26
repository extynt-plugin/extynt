// Footage interpretation, image-sequence import and scene-edit detection: field bounds, target kinds and refusal codes.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectItemSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { fingerprints, footageTarget, target as textTarget, withLayerProperties } from "./fixtures.js";
import { assertOperations, refusal, verdict, type OperationRow } from "./plan-builders.js";

const plate = { id: "footage-plate", name: "plate.mov", type: "footage", parentFolderId: null, compositionId: null, sourceId: null } satisfies ProjectItemSnapshot;
const snapshot: ProjectSnapshot = { ...representativeSnapshot, items: [plate] };
const options = { snapshot, bounds: { maxOperations: 4 } } satisfies { snapshot: ProjectSnapshot; bounds: JsonObject };
const item = { itemId: plate.id, ...fingerprints } satisfies JsonObject;

function setInterpretation(interpretation: JsonValue): JsonObject {
  return { type: "set_footage_interpretation", target: item, interpretation };
}

function interpret(interpretation: JsonValue): OperationRow {
  return ["ok", setInterpretation(interpretation)];
}

function codeOf(operations: readonly JsonValue[], within: ProjectSnapshot = snapshot): string {
  return verdict(operations, { ...options, snapshot: within });
}

test("set_footage_interpretation accepts each field and its documented bounds", () => {
  const all = { conformFrameRate: 29.97, alphaMode: "premultiplied", premulColor: [0, 0, 0], loop: 3, pixelAspect: 0.9091, fieldSeparationType: "lower-field-first" };
  assertOperations([interpret(all), interpret({ conformFrameRate: 0 }), interpret({ loop: 9999 })], options);
});

test("set_footage_interpretation refuses empty, unknown, out-of-range and misplaced values", () => {
  const bad: readonly JsonValue[] = [{}, "loop", { frames: 1 }, { loop: 0 }, { loop: 2.5 }, { conformFrameRate: -1 }, { conformFrameRate: 1000 }, { pixelAspect: 0 }, { alphaMode: "premult" }, { fieldSeparationType: "upper" }, { premulColor: [0, 0, 0] }, { alphaMode: "straight", premulColor: [0, 0, 0] }, { alphaMode: "premultiplied", premulColor: [0, 0, 2] }, { alphaMode: "premultiplied", premulColor: [0, 0] }];
  for (const interpretation of bad) assert.notEqual(codeOf([setInterpretation(interpretation)]), "ok", JSON.stringify(interpretation));
});

test("set_footage_interpretation needs a footage item that exists or is imported earlier", () => {
  const set = { type: "set_footage_interpretation", target: item, interpretation: { loop: 2 } } satisfies JsonObject;
  const folder: ProjectSnapshot = { ...snapshot, items: [{ ...plate, type: "folder" }] };
  const imported = { type: "import_file", newItemId: "__new__:plate", path: "/fixtures/plate.mov", ...fingerprints } satisfies JsonObject;
  const afterImport = { ...set, target: { itemId: "__new__:plate", ...fingerprints } } satisfies JsonObject;
  assert.equal(codeOf([{ ...set, target: { ...item, itemId: "nope" } }]), "TARGET_NOT_FOUND");
  assert.equal(codeOf([set], folder), "INVALID_TARGET");
  assert.equal(codeOf([imported, afterImport]), "ok");
});

test("import_file takes sequence and forceAlphabetical only as booleans, as footage", () => {
  const base = { type: "import_file", newItemId: "__new__:seq", path: "/fixtures/frames/shot_0001.png", ...fingerprints } satisfies JsonObject;
  const accepted: readonly JsonObject[] = [{ ...base, sequence: true }, { ...base, sequence: true, forceAlphabetical: true, importAs: "footage" }];
  const refusedRows: readonly JsonObject[] = [{ ...base, forceAlphabetical: true }, { ...base, sequence: "yes" }, { ...base, sequence: true, importAs: "composition" }];
  for (const operation of accepted) assert.equal(codeOf([operation]), "ok", JSON.stringify(operation));
  for (const operation of refusedRows) assert.notEqual(codeOf([operation]), "ok", JSON.stringify(operation));
});

test("detect_scene_edits accepts a footage layer in each mode", () => {
  for (const mode of ["markers", "split", "split-precomp"]) assert.equal(codeOf([{ type: "detect_scene_edits", target: footageTarget, mode }]), "ok", mode);
});

test("detect_scene_edits refuses an unknown or missing mode and a non-video layer", () => {
  assert.notEqual(codeOf([{ type: "detect_scene_edits", target: footageTarget, mode: "cuts" }]), "ok");
  assert.notEqual(codeOf([{ type: "detect_scene_edits", target: footageTarget }]), "ok");
  assert.equal(codeOf([{ type: "detect_scene_edits", target: textTarget, mode: "markers" }]), "SCENE_EDIT_NOT_VIDEO");
});

test("detect_scene_edits refuses a layer whose time remapping is on in the snapshot", () => {
  const timeRemap = { path: "ADBE Time Remapping", matchName: "ADBE Time Remapping", displayName: "Time Remap", kind: "property", valueType: "number", value: 0, canSetValue: true, enabled: true, expressionEnabled: false, keyframes: [] } satisfies PropertySnapshot;
  const remapped = withLayerProperties(snapshot, "layer-footage", [timeRemap]);
  assert.equal(codeOf([{ type: "detect_scene_edits", target: footageTarget, mode: "markers" }], remapped), "SCENE_EDIT_TIME_REMAPPED");
});

test("import_file takes Windows drive paths as well as POSIX ones", () => {
  for (const path of ["C:\\Users\\Public\\clip.avi", "d:/footage/clip.mov", "/Volumes/media/clip.mov"]) assert.equal(codeOf([{ type: "import_file", newItemId: "__new__:clip", path, ...fingerprints }]), "ok", path);
});

test("import_file still refuses relative paths", () => {
  for (const path of ["clip.avi", "footage\\clip.avi", "C:clip.avi", "\\\\server\\share\\clip.avi"]) assert.equal(refusal([{ type: "import_file", newItemId: "__new__:clip", path, ...fingerprints }], options).code, "INVALID_VALUE", path);
});
