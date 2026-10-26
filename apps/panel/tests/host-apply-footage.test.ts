/**
 * Apply-plan host contract: footage interpretation, image-sequence import and scene edit detection
 *
 * The fake host's enum values differ from their names, so a step that wrote the name instead of the member fails here.
 */
import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { loadHostFiles } from "./host-sources.js";
import { FAKE_ALPHA_MODE, FAKE_FIELD_SEPARATION, FakeFootageItem, FakeLayer, FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { type PlanApply, applyPlan, assertApplied } from "./host-plan-io.js";
import { fieldOf, listAt } from "./json-narrow.js";
import { type JsonValue } from "@extynt/decode";

const MALFORMED_INTERPRETATIONS: ReadonlyArray<JsonValue> = [{}, { loop: 0 }, { loop: 1.5 }, { alphaMode: "premult" }, { premulColor: [0, 0, 0] }, { frames: 3 }, { conformFrameRate: 1000 }];

function send(apply: PlanApply, operations: ReadonlyArray<JsonValue>, planId = "footage-plan") {
  return applyPlan(apply, planId, operations);
}

function interpret(apply: PlanApply, interpretation: JsonValue) {
  return send(apply, [{ operation: "set_footage_interpretation", itemId: "footage-plate", interpretation }]);
}

function markerOf(layer: FakeLayer): FakeProperty | undefined {
  return layer.properties.find((property) => property.matchName === "ADBE Marker");
}

function markerKeys(layer: FakeLayer): number[] {
  const marker = markerOf(layer);
  return marker ? Array.from({ length: marker.numKeys }, (_, index) => marker.keyTime(index + 1)) : [];
}

function detect(apply: PlanApply, mode: string) {
  return send(apply, [{ operation: "detect_scene_edits", compositionId: "comp-main", layerId: "layer-title", mode }], `scene-${mode}`);
}

test("set_footage_interpretation writes the members, reads every field back and reports before and after", () => {
  const { apply, footage, projectItems } = loadApplyPlan();
  projectItems.push(footage);
  const result = interpret(apply, { conformFrameRate: 30, alphaMode: "premultiplied", premulColor: [0, 0, 1], loop: 3, pixelAspect: 1.5, fieldSeparationType: "upper-field-first" });
  assert.equal(fieldOf(result, "ok"), true);
  assert.equal(footage.mainSource.conformFrameRate, 30);
  assert.equal(footage.mainSource.alphaMode, FAKE_ALPHA_MODE.PREMULTIPLIED);
  assert.equal(JSON.stringify(footage.mainSource.premulColor), "[0,0,1]");
  assert.equal(footage.mainSource.loop, 3);
  assert.equal(footage.mainSource.fieldSeparationType, FAKE_FIELD_SEPARATION.UPPER_FIELD_FIRST);
  const step = listAt(result, "steps")[0];
  assert.equal(fieldOf(step, "verification"), "footage-interpretation-read-back");
  assert.equal(fieldOf(step, "beforeValue", "alphaMode"), "straight");
  assert.equal(fieldOf(step, "afterValue", "alphaMode"), "premultiplied");
  assert.equal(fieldOf(step, "afterValue", "loop"), 3);
});

test("set_footage_interpretation refuses what the source cannot take, and fails when AE reads back a different value", () => {
  const { apply, footage, projectItems } = loadApplyPlan();
  projectItems.push(footage);
  footage.mainSource.hasAlpha = false;
  assert.equal(fieldOf(interpret(apply, { alphaMode: "straight" }), "error", "code"), "ALPHA_MODE_UNAVAILABLE");
  footage.mainSource.hasAlpha = true;
  footage.mainSource.isStill = true;
  assert.equal(fieldOf(interpret(apply, { loop: 2 }), "error", "code"), "FOOTAGE_STILL_INTERPRETATION");
  assert.equal(fieldOf(interpret(apply, { pixelAspect: 2 }), "ok"), true);
  footage.mainSource.isStill = false;
  Object.defineProperty(footage.mainSource, "loop", { get: () => 1, set: () => undefined });
  assert.equal(fieldOf(interpret(apply, { loop: 4 }), "error", "code"), "INTERPRETATION_READBACK_MISMATCH");
});

test("set_footage_interpretation rejects malformed interpretation objects before touching the source", () => {
  const { apply, footage, projectItems } = loadApplyPlan();
  projectItems.push(footage);
  for (const malformed of MALFORMED_INTERPRETATIONS) {
    assert.equal(fieldOf(interpret(apply, malformed), "error", "code"), "INVALID_VALUE", JSON.stringify(malformed));
  }
  assert.equal(footage.mainSource.loop, 1);
});

test("import_file with sequence sets the ImportOptions fields and reports the sequence's duration and rate", () => {
  const { apply, projectItems } = loadApplyPlan();
  const result = send(apply, [{ operation: "import_file", newItemId: "__new__:seq", path: "/fixtures/title.mov", importAs: "footage", sequence: true, forceAlphabetical: true }]);
  assertApplied(result);
  const imported = projectItems.at(-1);
  assert.ok(imported instanceof FakeFootageItem);
  assert.deepEqual(imported.sequenceImport, { sequence: true, forceAlphabetical: true });
  assert.deepEqual(fieldOf(listAt(result, "steps")[0], "sequence"), { duration: 4, frameRate: 25, isStill: false });
  const single = send(apply, [{ operation: "import_file", newItemId: "__new__:one", path: "/fixtures/title.mov" }], "plain-import");
  assert.equal(fieldOf(listAt(single, "steps")[0], "sequence"), undefined);
});

test("detect_scene_edits reports the new marker times and passes the SceneEditDetectionMode member", () => {
  const { apply, title, footage } = loadApplyPlan();
  title.source = footage;
  title.sceneEditEffect = (layer) => {
    markerOf(layer)?.setValueAtTime(1.5, {});
    markerOf(layer)?.setValueAtTime(4, {});
  };
  const result = detect(apply, "markers");
  assert.equal(fieldOf(result, "ok"), true);
  assert.deepEqual(title.sceneEditModes, ["scene-markers"]);
  const step = listAt(result, "steps")[0];
  assert.equal(fieldOf(step, "cutCount"), 2);
  assert.deepEqual(fieldOf(step, "cuts"), [1.5, 4]);
  assert.deepEqual(markerKeys(title), [1.5, 4]);
});

test("detect_scene_edits in split mode reports the layers it added", () => {
  const { apply, title, footage, comp } = loadApplyPlan();
  title.source = footage;
  title.sceneEditEffect = () => {
    comp.layers.add(footage);
    comp.layers.add(footage);
  };
  const step = listAt(detect(apply, "split"), "steps")[0];
  assert.equal(fieldOf(step, "cutCount"), 2);
  assert.equal(listAt(step, "cuts").length, 2);
  assert.deepEqual(title.sceneEditModes, ["scene-split"]);
});

test("detect_scene_edits refuses time-remapped, non-video and unsupported layers and a failing call", () => {
  const { apply, title, footage } = loadApplyPlan();
  title.source = footage;
  title.sceneEditEffect = () => undefined;
  title.timeRemapEnabled = true;
  assert.equal(fieldOf(detect(apply, "markers"), "error", "code"), "SCENE_EDIT_TIME_REMAPPED");
  title.timeRemapEnabled = false;
  title.hasVideo = false;
  assert.equal(fieldOf(detect(apply, "markers"), "error", "code"), "SCENE_EDIT_NOT_VIDEO");
  title.hasVideo = true;
  footage.mainSource.isStill = true;
  assert.equal(fieldOf(detect(apply, "markers"), "error", "code"), "SCENE_EDIT_NOT_VIDEO");
  footage.mainSource.isStill = false;
  title.sceneEditEffect = null;
  assert.equal(fieldOf(detect(apply, "markers"), "error", "code"), "SCENE_EDIT_FAILED");
  Object.defineProperty(title, "doSceneEditDetection", { value: undefined });
  assert.equal(fieldOf(detect(apply, "markers"), "error", "code"), "SCENE_EDIT_UNSUPPORTED");
  assert.equal(fieldOf(detect(apply, "cuts"), "error", "code"), "INVALID_VALUE");
});

test("a failure before any write reports no mutation when the project revision is unchanged, and keeps mutation-unknown when it moved", () => {
  const { apply, title, footage, context } = loadApplyPlan();
  loadHostFiles(context, "collection.jsx");
  vm.runInContext("app.project.revision = 7", context);
  title.source = footage;
  title.sceneEditEffect = () => undefined;
  title.timeRemapEnabled = true;
  const untouched = detect(apply, "split");
  assert.equal(fieldOf(untouched, "error", "code"), "SCENE_EDIT_TIME_REMAPPED");
  assert.equal(fieldOf(untouched, "mayHaveMutated"), false);
  assert.equal(fieldOf(untouched, "mutationState"), "not-applied");
  assert.equal(fieldOf(untouched, "receipt", "rollback"), "none");
  assert.equal(fieldOf(untouched, "receipt", "postcondition"), "not_run");
  title.timeRemapEnabled = false;
  title.sceneEditEffect = () => {
    vm.runInContext("app.project.revision = 8", context);
    throw new Error("boom");
  };
  const moved = detect(apply, "split");
  assert.equal(fieldOf(moved, "mayHaveMutated"), true);
  assert.equal(fieldOf(moved, "mutationState"), "mutation-unknown");
  assert.equal(fieldOf(moved, "receipt", "rollback"), "After Effects Undo required");
});

test("set_footage_interpretation takes invertAlpha, guessAlpha, field quality, pulldown, guessPulldown and resetFrameRate", () => {
  const { apply, footage, projectItems } = loadApplyPlan();
  projectItems.push(footage);
  const source = footage.mainSource;
  const written = interpret(apply, { invertAlpha: true, highQualityFieldSeparation: true, removePulldown: "WSSWW" });
  assertApplied(written);
  assert.deepEqual([source.invertAlpha, source.highQualityFieldSeparation, source.removePulldown], [true, true, "pulldown-WSSWW"]);
  assert.equal(fieldOf(listAt(written, "steps")[0], "afterValue", "removePulldown"), "WSSWW");
  source.conformFrameRate = 30;
  assertApplied(interpret(apply, { resetFrameRate: true }));
  assert.equal(source.conformFrameRate, 24);
  source.alphaMode = FAKE_ALPHA_MODE.STRAIGHT;
  assert.equal(fieldOf(interpret(apply, { guessAlpha: true }), "ok"), true);
  assert.equal(source.alphaMode, FAKE_ALPHA_MODE.PREMULTIPLIED);
  source.removePulldown = "pulldown-off";
  assert.equal(fieldOf(interpret(apply, { guessPulldown: "pulldown-3-2" }), "ok"), true);
  assert.deepEqual(source.guesses, ["alpha", "pulldown:method-3-2"]);
  assert.equal(fieldOf(interpret(apply, { guessAlpha: true, alphaMode: "straight" }), "error", "code"), "INVALID_VALUE");
  assert.equal(fieldOf(interpret(apply, { removePulldown: "XXXXX" }), "error", "code"), "INVALID_VALUE");
  source.isStill = true;
  assert.equal(fieldOf(interpret(apply, { removePulldown: "WSSWW" }), "error", "code"), "FOOTAGE_STILL_INTERPRETATION");
  source.hasAlpha = false;
  assert.equal(fieldOf(interpret(apply, { invertAlpha: true }), "error", "code"), "ALPHA_MODE_UNAVAILABLE");
});
