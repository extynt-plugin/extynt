/** Receipt verdicts for set_puppet_pins: the host's read-back of the carrier layer must match the request. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { expectedRest, verifyPuppetPins } from "../src/verify/verify-puppet.js";
import { laterInterference } from "../src/verify/later-operations.js";
import { layerStateOf } from "./verify-fixtures.js";

const anchored = { x: 960, y: 540, keyframes: [{ time: 0, x: 10, y: 20 }, { time: 1, x: 50, y: 60 }] };
const operation: JsonObject = { operation: "set_puppet_pins", compositionId: "1", layerId: "7", pins: [{ x: 200, y: 300 }, anchored] };
const goodRead = { effectPresent: true, carrierLayerId: "9", pins: [{ x: 200, y: 300 }, { x: 10, y: 20 }] };

function verdict(pinReadback: JsonValue | undefined, layerIds: ReadonlyArray<string> = ["9"]) {
  const comp = { id: "1", width: 1920, height: 1080, duration: 8, frameRate: 25, layers: layerIds.map((id) => ({ id, type: "av" })) };
  const step: JsonObject = { operation: "set_puppet_pins", compositionId: "1", layerId: "9", requestedLayerId: "7", ...(pinReadback === undefined ? {} : { pinReadback }) };
  return verifyPuppetPins(layerStateOf({ operation, step, compositions: [comp] }));
}

test("pins verify when the count matches and every time-0 position is within tolerance, following the layer to the carrier id", () => {
  const result = verdict(goodRead);
  assert.equal(result.verificationState, "exact");
  assert.equal(result.basis, "puppet-pins-read-back");
  assert.equal(result.layerId, "9");
  assert.equal(result.requestedLayerId, "7");
  assert.equal(verdict({ ...goodRead, pins: [{ x: 200.3, y: 299.8 }, { x: 10, y: 20.4 }] }).verificationState, "exact");
});

test("a key at time 0 sets the expected rest, and relative keys are offsets from the pin", () => {
  assert.deepEqual(expectedRest(anchored, false), { x: 10, y: 20 });
  assert.deepEqual(expectedRest(anchored, true), { x: 970, y: 560 });
  assert.deepEqual(expectedRest({ x: 5, y: 6, keyframes: [{ time: 1, x: 9, y: 9 }] }, false), { x: 5, y: 6 });
});

test("a pin count that differs fails with both counts", () => {
  const result = verdict({ ...goodRead, pins: [{ x: 200, y: 300 }] });
  assert.equal(result.verificationState, "failed");
  assert.equal(result.basis, "puppet-pin-count-differs");
  assert.equal(result.expectedPins, 2);
  assert.equal(result.observedPins, 1);
});

test("a pin off its position fails with the pin, the expectation and the observation", () => {
  const result = verdict({ ...goodRead, pins: [{ x: 200, y: 300 }, { x: 10, y: 25 }] });
  assert.equal(result.verificationState, "failed");
  assert.equal(result.basis, "puppet-pin-position-off");
  assert.equal(result.pin, 2);
  assert.deepEqual(result.expected, { x: 10, y: 20 });
  assert.deepEqual(result.observedPin, { x: 10, y: 25 });
});

test("a missing effect, a carrier the snapshot lacks and a silent host are told apart", () => {
  assert.equal(verdict({ ...goodRead, effectPresent: false }).basis, "puppet-effect-absent");
  assert.equal(verdict({ ...goodRead, carrierLayerId: "12" }).basis, "puppet-carrier-layer-absent");
  const silent = verdict(undefined);
  assert.equal(silent.verificationState, "applied_unverified");
  assert.equal(silent.basis, "puppet-pins-not-reported");
  assert.equal(verdict({ ...goodRead, pins: [{ x: "a", y: 1 }] }).basis, "puppet-pins-not-reported");
});

test("a puppet failure is read at write time, so no later operation reclassifies it as superseded", () => {
  const failure = verdict({ ...goodRead, pins: [{ x: 200, y: 300 }, { x: 10, y: 25 }] });
  assert.ok(!/(mismatch|missing)$/.test(String(failure.basis)));
  const later = [{ operation: "set_puppet_pins", compositionId: "1", layerId: "7" }, { operation: "set_layer_property", compositionId: "1", layerId: "7", propertyPath: "ADBE Transform Group/ADBE Opacity" }];
  assert.equal(laterInterference(later, 0, "value"), null);
});
