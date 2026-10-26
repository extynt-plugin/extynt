// The plan decoders accept exactly the shapes the plan rules name and reject everything else, field by field.
import assert from "node:assert/strict";
import { test } from "node:test";
import { accepts } from "@extynt/decode";
import { keyframeSpec } from "../src/keyframe-decoder.js";
import { planBounds, v2Target } from "../src/plan-decoders.js";
import { shapePath } from "../src/shape-decoder.js";

const isBounds = accepts(planBounds);
const isTarget = accepts(v2Target);
const isShape = accepts(shapePath);
const isKeyframe = accepts(keyframeSpec);

const TRIANGLE = [[0, 0], [10, 0], [5, 8]];

test("bounds need a positive integer operation count and refuse unknown fields", () => {
  assert.ok(isBounds({ maxOperations: 3, maxKeyframes: 8 }));
  assert.ok(!isBounds({ maxOperations: 0 }));
  assert.ok(!isBounds({ maxOperations: 3, maxKeyframes: 1.5 }));
  assert.ok(!isBounds({ maxOperations: 3, extra: 1 }));
});

test("a layer target needs both ids and both fingerprints as strings", () => {
  const target = { compositionId: "c", layerId: "l", snapshotFingerprint: "s", selectionFingerprint: "x" };
  assert.ok(isTarget(target));
  assert.ok(isTarget({ ...target, effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" }));
  assert.ok(!isTarget({ ...target, layerId: 4 }));
  assert.ok(!isTarget({ ...target, itemId: "i" }));
});

test("a shape path needs tangents as long as its vertices", () => {
  assert.ok(isShape({ vertices: TRIANGLE, closed: true }));
  assert.ok(isShape({ vertices: TRIANGLE, inTangents: TRIANGLE, outTangents: TRIANGLE, closed: false }));
  assert.ok(!isShape({ vertices: TRIANGLE, inTangents: [[0, 0]], closed: true }));
  assert.ok(!isShape({ vertices: [], closed: true }));
  assert.ok(!isShape({ vertices: [[0, 0, 0]], closed: true }));
  assert.ok(!isShape({ vertices: TRIANGLE }));
});

test("a keyframe needs a non-negative time and a value, and well-formed motion fields", () => {
  assert.ok(isKeyframe({ time: 0, value: 50 }));
  assert.ok(isKeyframe({ time: 1, value: [1, 2], curve: "ease", ease: { in: { speed: 0, influence: 33 } } }));
  assert.ok(!isKeyframe({ time: -1, value: 50 }));
  assert.ok(!isKeyframe({ time: 0 }));
  assert.ok(!isKeyframe({ time: 0, value: 50, curve: "no-such-preset" }));
  assert.ok(!isKeyframe({ time: 0, value: 50, ease: { in: { speed: 0, influence: 0 } } }));
});
