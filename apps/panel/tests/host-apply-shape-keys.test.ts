/** Apply-plan host contract: Shape-valued keyframes on mask and shape-layer paths, and mask mode, inverted and RotoBezier. */
import assert from "node:assert/strict";
import test from "node:test";
import { type FakeProperty, FakeShape, loadApplyPlan } from "./host-apply-harness.js";
import { childAt, firstMaskPath, itemAt, maskParadeOf, shapeRoot } from "./host-fake-lookup.js";
import { applyPlan, assertApplied, assertRefused } from "./host-plan-io.js";
import { fieldOf, listAt, numberAt, plain, recordAt, recordsAt, textAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

const MASK_PATH = "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape";
const VECTOR_PATH = "ADBE Root Vectors Group/ADBE Vector Shape - Group/ADBE Vector Shape";
const ROUND_TRIP_TANGENTS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function square(size: number, extra: JsonObject = {}): JsonObject {
  return { vertices: [[0, 0], [size, 0], [size, size], [0, size]], closed: true, ...extra };
}

function animate(layerId: string, propertyPath: string, keyframes: ReadonlyArray<JsonValue>, more: JsonObject = {}): JsonObject {
  return { operation: "animate_property", compositionId: "comp-main", layerId, propertyPath, keyframes, ...more };
}

function shapeValues(property: FakeProperty): FakeShape[] {
  return property.keyframes.map((key) => {
    if (!(key.value instanceof FakeShape)) throw new TypeError("a key on the path is not a native Shape");
    return key.value;
  });
}

test("a mask path takes Shape keys, built as native Shape values", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const keyframes = [{ time: 0, value: square(10) }, { time: 1, value: square(20, { outTangents: ROUND_TRIP_TANGENTS }) }, { time: 2, value: square(30) }];
  assertApplied(applyPlan(apply, "extended", [animate("layer-shape", MASK_PATH, keyframes)]));
  const property = firstMaskPath(shapeLayer);
  assert.equal(property.numKeys, 3);
  const keys = shapeValues(property);
  assert.equal(JSON.stringify(itemAt(keys, 1).vertices), JSON.stringify(square(20).vertices));
  assert.equal(JSON.stringify(itemAt(keys, 1).outTangents), "[[1,0],[0,1],[-1,0],[0,-1]]");
  assert.equal(JSON.stringify(itemAt(keys, 0).inTangents), "[[0,0],[0,0],[0,0],[0,0]]");
  assert.equal(itemAt(keys, 0).closed, true);
});

test("the animate step reports key times and vertex counts per key, not the vertex arrays", () => {
  const { apply } = loadApplyPlan();
  const open: JsonObject = { vertices: [[0, 0], [5, 5]], closed: false };
  const result = applyPlan(apply, "extended", [animate("layer-shape", MASK_PATH, [{ time: 0, value: square(10) }, { time: 0.5, value: open }])]);
  const step = itemAt(recordsAt(result, "steps"), 0);
  assert.deepEqual(fieldOf(step, "shapeKeys"), { times: [0, 0.5], vertexCounts: [4, 2] });
  assert.equal(fieldOf(step, "afterKeys"), 2);
  assert.equal(typeof fieldOf(step, "afterDigest"), "string");
});

test("a shape layer's path takes Shape keys with interpolation and a curve", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const first = { time: 0, value: square(10), curve: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 }, interpolation: { outType: "BEZIER" } };
  const second = { time: 1, value: square(40), interpolation: { inType: "LINEAR", outType: "HOLD" } };
  assertApplied(applyPlan(apply, "extended", [animate("layer-shape", VECTOR_PATH, [first, second])]));
  const path = childAt(childAt(shapeRoot(shapeLayer), 0), 0);
  assert.equal(path.numKeys, 2);
  const ease = plain(path.temporalEase);
  assert.equal(numberAt(ease, 0, "outEase", 0, "speed"), 0);
  assert.ok(numberAt(ease, 0, "outEase", 0, "influence") > 0);
  assert.deepEqual(path.interpolation[1], { inType: "linear", outType: "hold" });
});

test("a path key that is not a bounded Shape is refused before any key is written or cleared", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const property = firstMaskPath(shapeLayer);
  property.setValueAtTime(5, new FakeShape());
  const tooMany = { vertices: Array.from({ length: 1001 }, (_, index) => [index, 0]), closed: true };
  const mismatched = { vertices: [[0, 0]], closed: true, inTangents: [[0, 0], [0, 0]] };
  for (const bad of ["M 0 0", [1, 2], tooMany, mismatched]) {
    const keyframes = [{ time: 0, value: square(10) }, { time: 1, value: bad }];
    assertRefused(applyPlan(apply, "extended", [animate("layer-shape", MASK_PATH, keyframes, { keyframeMode: "replace" })]), "INVALID_VALUE");
    assert.equal(property.numKeys, 1, "the existing key is untouched");
  }
});

test("update_mask sets mode, inverted and RotoBezier and reads them back", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const values = { mode: "SUBTRACT", inverted: true, rotoBezier: true };
  const result = applyPlan(apply, "extended", [{ operation: "update_mask", compositionId: "comp-main", layerId: "layer-shape", maskId: "mask:1", values }]);
  assertApplied(result);
  const mask = plain(childAt(maskParadeOf(shapeLayer), 0));
  assert.deepEqual([fieldOf(mask, "maskMode"), fieldOf(mask, "inverted"), fieldOf(mask, "rotoBezier")], [6614, true, true]);
  const readback = recordAt(itemAt(recordsAt(result, "steps"), 0), "readback");
  assert.deepEqual([fieldOf(readback, "mode"), fieldOf(readback, "inverted"), fieldOf(readback, "rotoBezier")], ["SUBTRACT", true, true]);
});

test("add_mask takes a mode, and every other mode name maps to its AE constant", () => {
  const { apply, shapeLayer } = loadApplyPlan();
  const modes = ["NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE"];
  const operations = modes.map((mode, index): JsonObject => ({ operation: "add_mask", compositionId: "comp-main", layerId: "layer-shape", newMaskId: `__new__:m${index}`, name: mode, values: { mode } }));
  const result = applyPlan(apply, "extended", operations);
  assertApplied(result);
  assert.deepEqual(listAt(result, "steps").map((step) => textAt(step, "readback", "mode")), modes);
  assert.equal(maskParadeOf(shapeLayer).children.length, 1 + modes.length);
});

test("an unknown mask mode or a non-boolean setting is refused", () => {
  const { apply } = loadApplyPlan();
  const refused: ReadonlyArray<JsonObject> = [{ mode: "Add" }, { mode: "MULTIPLY" }, { inverted: "yes" }, { rotoBezier: 1 }];
  for (const values of refused) {
    const result = applyPlan(apply, "extended", [{ operation: "update_mask", compositionId: "comp-main", layerId: "layer-shape", maskId: "mask:1", values }]);
    assertRefused(result, "INVALID_VALUE");
  }
});
