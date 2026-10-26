/** Receipt verdicts for dolly_camera: every Position key the host read back must sit at the requested distance, on the camera's original axis. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { verifyDollyCamera } from "../src/verify/verify-camera.js";
import { layerStateOf } from "./verify-fixtures.js";

const operation: JsonObject = { operation: "dolly_camera", compositionId: "1", layerId: "7", keyframes: [{ time: 0, distance: 2667 }, { time: 5, distance: 2200 }] };
const first = { time: 0, distance: 2667, offAxis: 0 };
const last = { time: 5, distance: 2200, offAxis: 0 };

function verdict(dollyKeys: JsonValue | undefined, keyframeCount = 2) {
  const layer = { id: "7", type: "camera", propertyPaths: [{ path: "ADBE Transform Group/ADBE Position", keyframeCount }] };
  const comp = { id: "1", width: 1920, height: 1080, duration: 8, frameRate: 25, layers: [layer] };
  const step: JsonObject = { operation: "dolly_camera", compositionId: "1", layerId: "7", hasPointOfInterest: true, ...(dollyKeys === undefined ? {} : { dollyKeys }) };
  return verifyDollyCamera(layerStateOf({ operation, step, compositions: [comp] }));
}

test("a dolly verifies when every key is at its requested distance on the original axis", () => {
  const result = verdict([first, last]);
  assert.equal(result.verificationState, "exact");
  assert.equal(result.basis, "camera-dolly-axis");
});

test("a key that left the camera's axis fails with the key and the pixels it is off by", () => {
  const result = verdict([first, { ...last, offAxis: 480 }]);
  assert.equal(result.verificationState, "failed");
  assert.equal(result.basis, "camera-dolly-off-axis");
  assert.equal(result.keyIndex, 1);
  assert.equal(result.offAxisPixels, 480);
});

test("a key at the wrong distance fails with the expected and observed distance", () => {
  const result = verdict([first, { ...last, distance: 2667 }]);
  assert.equal(result.basis, "camera-dolly-distance-mismatch");
  assert.equal(result.expectedDistance, 2200);
  assert.equal(result.observedDistance, 2667);
});

test("a missing key, a snapshot with the wrong key count, and a host that reported no keys are told apart", () => {
  assert.equal(verdict([first]).basis, "camera-dolly-key-count-mismatch");
  assert.equal(verdict([first, last], 1).basis, "camera-dolly-snapshot-key-count-mismatch");
  const silent = verdict(undefined);
  assert.equal(silent?.verificationState, "applied_unverified");
  assert.equal(silent?.basis, "camera-dolly-keys-not-reported");
});
