// Covers Shape-valued keyframes on mask and shape-layer paths, mask mode/inverted/rotoBezier values, and the refusal that names the exact path a layer holds.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { GENEROUS_BOUNDS, validate } from "./plan-builders.js";
import { target, withLayerProperties } from "./fixtures.js";

const MASK_PATH = "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape";
const VECTOR_PATH = "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group/ADBE Vector Shape - Group/ADBE Vector Shape";

interface Outcome { readonly code: string; readonly message: string }

function shapeProperty(path: string): PropertySnapshot {
  return { path, matchName: path.split("/").pop() ?? path, displayName: "Path", kind: "property", valueType: "unknown", value: null, canSetValue: true };
}

function check(operations: readonly JsonValue[], paths: readonly string[] = [MASK_PATH, VECTOR_PATH], bounds: JsonObject = GENEROUS_BOUNDS): Outcome {
  const snapshot = withLayerProperties(representativeSnapshot, target.layerId, paths.map(shapeProperty));
  const result = validate(operations, { snapshot, bounds });
  return result.ok ? { code: "ok", message: "" } : { code: result.code, message: result.message };
}

function square(size: number, extra: JsonObject = {}): JsonObject {
  return { vertices: [[0, 0], [size, 0], [size, size], [0, size]], closed: true, ...extra };
}

function animate(propertyPath: string, values: readonly JsonValue[], more: JsonObject = {}): JsonObject {
  return { type: "animate_property", target: { ...target, propertyPath }, keyframes: values.map((value, index) => ({ time: index, value })), ...more };
}

function ring(count: number): JsonObject {
  return { vertices: Array.from({ length: count }, (_, index) => [index, 0]), closed: false };
}

test("animate_property accepts Shape-valued keys on a mask path and a shape-layer path", () => {
  assert.equal(check([animate(MASK_PATH, [square(10), square(20, { outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]] })])]).code, "ok");
  assert.equal(check([animate(VECTOR_PATH, [square(10), square(30)], { keyframeMode: "replace" })]).code, "ok");
});

test("animate_property accepts a curve and interpolation on Shape keys", () => {
  const keyed = { type: "animate_property", target: { ...target, propertyPath: MASK_PATH }, keyframes: [{ time: 0, value: square(10), curve: "ease" }, { time: 1, value: square(20), interpolation: { inType: "LINEAR", outType: "HOLD" } }] } satisfies JsonObject;
  assert.equal(check([keyed]).code, "ok");
});

test("a path keyframe must be a Shape DTO", () => {
  const malformed: readonly JsonValue[] = [[1, 2], "M 0 0", { vertices: [], closed: true }, { vertices: [[0, 0]], closed: "yes" }, square(10, { inTangents: [[0, 0]] }), { ...square(10), extra: 1 }];
  for (const bad of malformed) assert.equal(check([animate(MASK_PATH, [square(10), bad])]).code, "INVALID_VALUE", JSON.stringify(bad));
});

test("a path keyframe is limited to 1000 vertices", () => {
  assert.equal(check([animate(MASK_PATH, [ring(1000), ring(1000)])]).code, "ok");
  assert.equal(check([animate(MASK_PATH, [ring(1001)])]).code, "INVALID_VALUE");
});

test("a path animation is limited to 50000 vertices per operation", () => {
  const long = Array.from({ length: 51 }, () => ring(1000));
  const refused = check([animate(MASK_PATH, long)], [MASK_PATH], { ...GENEROUS_BOUNDS, maxKeyframes: 64 });
  assert.equal(refused.code, "INVALID_VALUE");
  assert.match(refused.message, /at most 50000/);
});

test("a numeric key on a path is refused and a Shape key on a numeric property still is", () => {
  const opacity = { type: "animate_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: square(1) }] } satisfies JsonObject;
  assert.equal(check([animate(MASK_PATH, [5, 6])]).code, "INVALID_VALUE");
  assert.equal(check([opacity]).code, "INVALID_VALUE");
});

function updateMask(values: JsonObject): JsonObject {
  return { type: "update_mask", target, maskId: "mask:1", values };
}

test("update_mask takes each mask mode", () => {
  for (const mode of ["NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE"]) assert.equal(check([updateMask({ mode })], ["ADBE Mask Parade/ADBE Mask Atom"]).code, "ok", mode);
});

test("update_mask and add_mask take inverted and rotoBezier", () => {
  const added = { type: "add_mask", target, newMaskId: "__new__:m", name: "Cut", values: { mode: "SUBTRACT", inverted: true } } satisfies JsonObject;
  assert.equal(check([updateMask({ inverted: true, rotoBezier: false, opacity: 50 })], []).code, "ok");
  assert.equal(check([added], []).code, "ok");
});

test("update_mask refuses values of the wrong spelling or type", () => {
  const badValues: readonly JsonObject[] = [{ mode: "Add" }, { mode: "MULTIPLY" }, { mode: 1 }, { inverted: "yes" }, { rotoBezier: 1 }];
  for (const bad of badValues) assert.notEqual(check([updateMask(bad)], []).code, "ok", JSON.stringify(bad));
});

test("a mask path spelled with a bracket, or as the bare leaf, is refused with the exact path the layer holds", () => {
  const keys = [square(10), square(20)];
  assert.equal(check([animate(MASK_PATH, keys)], [MASK_PATH]).code, "ok");
  for (const wrong of ["ADBE Mask Parade/ADBE Mask Atom[#1]/ADBE Mask Shape", "ADBE Mask Shape"]) {
    const refused = check([animate(wrong, keys)], [MASK_PATH]);
    assert.equal(refused.code, "TARGET_NOT_FOUND", wrong);
    assert.ok(refused.message.includes(`"${MASK_PATH}"`), wrong);
    const derived = check([{ type: "derive_layer", target: { ...target, propertyPath: wrong }, kind: "path-null", newLayerId: "__new__:pn", pointIndex: 0 }], [MASK_PATH]);
    assert.equal(derived.code, "TARGET_NOT_FOUND", wrong);
    assert.ok(derived.message.includes(`"${MASK_PATH}"`), wrong);
  }
});

test("a mask path on a layer without masks says to add_mask first", () => {
  assert.match(check([animate("ADBE Mask Shape", [square(10), square(20)])], []).message, /add_mask first/);
});
