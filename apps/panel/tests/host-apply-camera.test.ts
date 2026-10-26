/** Apply-plan host contract for dolly_camera: Position keys derived from a distance on the camera's own axis, read back per key. */

import assert from "node:assert/strict";
import test from "node:test";
import { numbersOf } from "./host-apply-context.js";
import { FakeProperty, loadApplyPlan } from "./host-apply-harness.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { fieldOf, listAt, numberAt } from "./json-narrow.js";
import type { FakeValue } from "./host-fake-property.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

type Loaded = ReturnType<typeof loadApplyPlan>;

const PUSH = [{ time: 0, distance: 2667 }, { time: 5, distance: 2200 }];
const MALFORMED_KEYFRAMES: ReadonlyArray<JsonValue> = [
  [{ time: 0, distance: 2000 }],
  [{ time: 0, distance: 2000 }, { time: 1, distance: 0 }],
  [{ time: 3, distance: 2000 }, { time: 1, distance: 1500 }],
  [{ time: 0, distance: 2000, value: [0, 0, -2000] }, { time: 1, distance: 1500 }],
];

function send(loaded: Loaded, operations: ReadonlyArray<JsonValue>) {
  return applyPlan(loaded.apply, "dolly-1", operations);
}

function dolly(keyframes: JsonValue, layerId = "layer-camera") {
  return { operation: "dolly_camera", compositionId: "comp-main", layerId, keyframes };
}

function twoNodeCamera(loaded: Loaded, position: number[], poi: number[] | null): FakeProperty {
  const positionProperty = new FakeProperty("ADBE Position", "Position", [], position, true);
  positionProperty.isSpatial = true;
  const children = poi ? [positionProperty, new FakeProperty("ADBE Anchor Point", "Point of Interest", [], poi, true)] : [positionProperty];
  loaded.cameraLayer.properties.push(new FakeProperty("ADBE Transform Group", "Transform", children, null, false));
  Object.assign(loaded.cameraLayer, { matchName: "ADBE Camera Layer" });
  return positionProperty;
}

function round(candidate: FakeValue | undefined): number[] {
  return numbersOf(candidate).map((coordinate) => Math.round(coordinate * 100) / 100);
}

function roundedKeys(position: FakeProperty): number[][] {
  return position.keyframes.map((key) => round(key.value));
}

function wholeKeys(position: FakeProperty): number[][] {
  return roundedKeys(position).map((key) => key.map(Math.round));
}

function dollyKeys(result: JsonObject, stepIndex: number): ReadonlyArray<JsonValue> {
  return listAt(fieldOf(result, "steps", stepIndex), "dollyKeys");
}

function createdPosition(loaded: Loaded): FakeProperty {
  const created = loaded.comp.layer(loaded.comp.numLayers);
  assert.ok(created);
  const position = created.property("ADBE Transform Group")?.children.find((child) => child.matchName === "ADBE Position");
  assert.ok(position);
  return position;
}

test("dolly_camera keys Position along the camera's own axis and reads every key back", () => {
  const loaded = loadApplyPlan();
  const position = twoNodeCamera(loaded, [960, 540, -2667], [960, 540, 0]);
  const result = send(loaded, [dolly(PUSH)]);
  assertApplied(result);
  assert.deepEqual(roundedKeys(position), [[960, 540, -2667], [960, 540, -2200]]);
  assert.equal(fieldOf(result, "steps", 0, "verification"), "camera-dolly-axis");
  assert.equal(fieldOf(result, "steps", 0, "hasPointOfInterest"), true);
  const keys = dollyKeys(result, 0);
  assert.deepEqual(keys.map((key) => Math.round(numberAt(key, "distance"))), [2667, 2200]);
  assert.ok(keys.every((key) => numberAt(key, "offAxis") < 1e-6));
});

test("dolly_camera follows an oblique axis instead of moving straight down Z", () => {
  const loaded = loadApplyPlan();
  const position = twoNodeCamera(loaded, [1000, 500, -2000], [960, 540, 0]);
  const half = Math.hypot(40, 40, 2000) / 2;
  const result = send(loaded, [dolly([{ time: 0, distance: half * 2 }, { time: 2, distance: half }])]);
  assertApplied(result);
  assert.deepEqual(wholeKeys(position), [[1000, 500, -2000], [980, 520, -1000]]);
  assert.ok(dollyKeys(result, 0).every((key) => numberAt(key, "offAxis") < 1e-6));
});

test("dolly_camera pulls out on a rising distance and moves a one-node camera along its forward vector", () => {
  const loaded = loadApplyPlan();
  const position = twoNodeCamera(loaded, [300, 200, -1500], null);
  const result = send(loaded, [dolly([{ time: 0, distance: 1500 }, { time: 3, distance: 2500 }])]);
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "hasPointOfInterest"), false);
  assert.deepEqual(roundedKeys(position), [[300, 200, -1500], [300, 200, -2500]]);
});

test("a created camera ends on axis, and create + dolly keeps x/y at the comp centre for every key", () => {
  const loaded = loadApplyPlan();
  const create = { operation: "create_layer", compositionId: "comp-main", layerId: "__new__:cam", layerType: "camera", name: "Push" };
  const result = send(loaded, [create, dolly(PUSH, "__new__:cam")]);
  assertApplied(result);
  const centre = [loaded.comp.width / 2, loaded.comp.height / 2];
  assert.deepEqual(wholeKeys(createdPosition(loaded)), [[centre[0], centre[1], -2667], [centre[0], centre[1], -2200]]);
  assert.deepEqual(dollyKeys(result, 1).map((key) => Math.round(numberAt(key, "distance"))), [2667, 2200]);
});

test("create_layer camera leaves Position on the Point of Interest axis with AE's z", () => {
  const loaded = loadApplyPlan();
  const result = send(loaded, [{ operation: "create_layer", compositionId: "comp-main", layerId: "__new__:cam", layerType: "camera", name: "Cam" }]);
  assertApplied(result);
  assert.deepEqual(round(createdPosition(loaded).value), [loaded.comp.width / 2, loaded.comp.height / 2, -2666.67]);
});

test("dolly_camera refuses a layer that is not a camera, a camera on its own point of interest, and malformed keyframes", () => {
  const notCamera = send(loadApplyPlan(), [dolly(PUSH, "layer-title")]);
  assert.equal(fieldOf(notCamera, "error", "code"), "INVALID_TARGET");
  const loaded = loadApplyPlan();
  twoNodeCamera(loaded, [960, 540, 0], [960, 540, 0]);
  assert.equal(fieldOf(send(loaded, [dolly(PUSH)]), "error", "code"), "INVALID_VALUE");
  for (const keyframes of MALFORMED_KEYFRAMES) {
    const fresh = loadApplyPlan();
    twoNodeCamera(fresh, [960, 540, -2667], [960, 540, 0]);
    assert.equal(fieldOf(send(fresh, [dolly(keyframes)]), "error", "code"), "INVALID_VALUE", JSON.stringify(keyframes));
  }
});

test("create_layer light leaves Position on the Point of Interest axis with AE's z", () => {
  const loaded = loadApplyPlan();
  const result = send(loaded, [{ operation: "create_layer", compositionId: "comp-main", layerId: "__new__:lamp", layerType: "light", name: "Lamp" }]);
  assertApplied(result);
  assert.deepEqual(round(createdPosition(loaded).value), [loaded.comp.width / 2, loaded.comp.height / 2, -1333.33]);
});
