// Covers dolly_camera validation (camera targets, keyframe rules, closed fields) and the axis-preserving dolly position maths.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { dollyAxis, dollyKeyGeometry, dollyPosition } from "../src/index.js";
import { footageTarget as footage, mapLayers } from "./fixtures.js";
import { validate } from "./plan-builders.js";

const NEW_CAMERA = "__new__:camera";
const cameraSnapshot = mapLayers(representativeSnapshot, (layer) => (layer.id === "layer-footage" ? { ...layer, id: "layer-camera", name: "Camera 1", type: "camera" } : layer));
const camera = { ...footage, layerId: "layer-camera" };
const PUSH_OK: JsonValue[] = [{ time: 0, distance: 2667, curve: "ease-in-out" }, { time: 5, distance: 2200 }];
const refusal = (operations: JsonObject[], snapshot: ProjectSnapshot = cameraSnapshot) => {
  const result = validate(operations, { snapshot });
  return result.ok ? undefined : result;
};

test("dolly_camera accepts a falling distance on a camera and on a camera created earlier in the plan", () => {
  assert.equal(refusal([{ type: "dolly_camera", target: camera, keyframes: PUSH_OK }]), undefined);
  const create = { type: "create_layer", target: { ...footage, layerId: NEW_CAMERA }, layerType: "camera", name: "Camera" };
  assert.equal(refusal([create, { type: "dolly_camera", target: { ...footage, layerId: NEW_CAMERA }, keyframes: PUSH_OK }]), undefined);
});

test("dolly_camera refuses a layer that is not a camera, known from the snapshot or from the plan", () => {
  const notCamera = refusal([{ type: "dolly_camera", target: footage, keyframes: PUSH_OK }], representativeSnapshot);
  assert.equal(notCamera?.code, "INVALID_TARGET");
  assert.match(notCamera?.message ?? "", /camera layer.*is a av layer.*create_layer layerType "camera"/);
  const solid = { type: "create_layer", target: { ...footage, layerId: "__new__:solid" }, layerType: "solid", name: "S", color: [1, 1, 1, 1] };
  const planned = refusal([solid, { type: "dolly_camera", target: { ...footage, layerId: "__new__:solid" }, keyframes: PUSH_OK }]);
  assert.equal(planned?.code, "INVALID_TARGET");
  assert.match(planned?.message ?? "", /created earlier in this plan as a solid layer/);
});

test("dolly_camera names the fix for too few keys, non-positive distance, unsorted times, a flat dolly and coordinates", () => {
  const code = (keyframes: JsonValue | undefined) => refusal(keyframes === undefined ? [{ type: "dolly_camera", target: camera }] : [{ type: "dolly_camera", target: camera, keyframes }]);
  const said = (keyframes: JsonValue | undefined) => code(keyframes)?.message ?? "";
  assert.match(said([{ time: 0, distance: 2000 }]), /at least 2 keyframes, got 1.*falling distance/);
  assert.match(said(undefined), /at least 2 keyframes, got none/);
  assert.match(said([{ time: 0, distance: 2000 }, { time: 1, distance: -5 }]), /keyframes\[1\]\.distance must be a positive number of pixels.*got -5/);
  assert.match(said([{ time: 0, distance: 2000 }, { time: 1, distance: 0 }]), /positive number of pixels/);
  assert.match(said([{ time: 4, distance: 2000 }, { time: 1, distance: 1500 }]), /strictly increasing.*keyframes\[1\]\.time 1 does not follow 4/);
  assert.match(said([{ time: 0, distance: 2000 }, { time: 1, distance: 2000 }]), /would not move/);
  assert.match(said([{ time: 0, distance: 2000, value: [0, 0, -2000] }, { time: 1, distance: 1500 }]), /derived from distance; do not send value/);
  assert.equal(code([{ time: 0, distance: 2000 }, { time: 1, distance: 1500, curve: "ease-in" }])?.code, "INVALID_VALUE");
  assert.equal(code([{ time: 0, distance: 2000, curve: "no-such-curve" }, { time: 1, distance: 1500 }])?.code, "INVALID_VALUE");
});

test("dolly_camera is a closed operation: unknown top-level fields are refused", () => {
  assert.equal(refusal([{ type: "dolly_camera", target: camera, keyframes: PUSH_OK, direction: "in" }])?.code, "UNKNOWN_FIELD");
});

test("dollyPosition keeps the camera's own axis: a camera at z=-2666.67 pushing in to 2200 stays on x,y of the point of interest", () => {
  const origin = [960, 540, -2666.67];
  const poi = [960, 540, 0];
  assert.deepEqual(dollyAxis(origin, poi)?.map((n) => Math.round(n * 1e6) / 1e6), [0, 0, -1]);
  const pushed = dollyPosition(origin, poi, 2200);
  assert.ok(pushed);
  assert.deepEqual([pushed[0], pushed[1], Math.round(pushed[2] * 100) / 100], [960, 540, -2200]);
  const pulled = dollyPosition(origin, poi, 3000);
  assert.ok(pulled);
  assert.equal(Math.round(pulled[2]), -3000);
});

test("dollyPosition follows an oblique axis and dollyKeyGeometry reports distance and off-axis error", () => {
  const origin = [1000, 500, -2000];
  const poi = [960, 540, 0];
  const half = dollyPosition(origin, poi, Math.hypot(40, 40, 2000) / 2);
  assert.ok(half);
  assert.deepEqual(half.map((n) => Math.round(n)), [980, 520, -1000]);
  const geometry = dollyKeyGeometry(half, origin, poi);
  assert.ok(geometry);
  assert.ok(Math.abs(geometry.distance - Math.hypot(40, 40, 2000) / 2) < 1e-6);
  assert.ok(geometry.offAxis < 1e-6);
  const skewed = dollyKeyGeometry([0, 0, -2200], [960, 540, -2666.67], [960, 540, 0]);
  assert.ok(skewed);
  assert.ok(skewed.offAxis > 1000);
});

test("a one-node camera moves along +Z toward the z=0 plane and keeps x,y; a camera on its own point of interest has no axis", () => {
  assert.deepEqual(dollyPosition([100, 200, -1500], null, 900), [100, 200, -900]);
  assert.equal(dollyPosition([960, 540, 0], [960, 540, 0], 500), undefined);
  assert.equal(dollyKeyGeometry([0, 0, 0], [960, 540, 0], [960, 540, 0]), undefined);
});
