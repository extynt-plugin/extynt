/** Verifier coverage for animated mask and shape paths (per-key vertex counts) and the mask mode, inverted and RotoBezier settings. */
import assert from "node:assert/strict";
import test from "node:test";
import { requestOf } from "../src/verify/plan-request.js";
import { shapeKeyMismatch } from "../src/verify/shape-keys.js";
import type { SnapshotProperty } from "../src/verify/snapshot-reply.js";
import { LAYER, verdict } from "./verify-fixtures.js";
import { entry, makeLayer, type Row } from "./native-fixtures.js";

const MASK_PATH = "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape";
const shape = (count: number) => ({ vertices: Array.from({ length: count }, (_, index) => [index, 0]), closed: true });
const operation = { operation: "animate_property", propertyPath: MASK_PATH, keyframes: [{ time: 0, value: shape(4) }, { time: 1, value: shape(4) }] };
const request = requestOf(operation);
const step = { operation: "animate_property", propertyPath: MASK_PATH, afterKeys: 2, afterDigest: "2:2:abcd" };
const layerWith = (extra: Row): Row => makeLayer(LAYER, 1, { propertyPaths: [entry(MASK_PATH, { valueType: "unknown", keyframeCount: 2, keyDigest: "2:2:abcd", ...extra })] });
const property = (shapeKeys: SnapshotProperty["shapeKeys"]): SnapshotProperty => ({ path: MASK_PATH, keyframeCount: 2, shapeKeys });

test("shapeKeyMismatch reads per-key vertex counts and ignores summaries it cannot trust", () => {
  assert.equal(shapeKeyMismatch(property({ times: [0, 1], vertexCounts: [4, 4] }), request), null);
  assert.deepEqual(shapeKeyMismatch(property({ times: [0, 1], vertexCounts: [4, 5] }), request), { time: 1, expected: 4, observed: 5 });
  assert.deepEqual(shapeKeyMismatch(property({ times: [0], vertexCounts: [4] }), request), { time: 1, expected: 4, observed: null });
  assert.equal(shapeKeyMismatch(property({ times: [0], vertexCounts: [9], truncated: true }), request), null, "a truncated summary proves nothing");
  assert.equal(shapeKeyMismatch(property(undefined), request), null);
});

test("a key row that is not an object is skipped and the other keys are still checked", () => {
  const mixed = requestOf({ ...operation, keyframes: ["broken", { time: 1, value: shape(4) }] });
  assert.deepEqual(shapeKeyMismatch(property({ times: [0, 1], vertexCounts: [4, 5] }), mixed), { time: 1, expected: 4, observed: 5 });
  assert.equal(shapeKeyMismatch(property({ times: [0, 1], vertexCounts: [4, 4] }), mixed), null);
});

test("an animated path whose digest matches but whose key shapes differ in size fails with the key's time", () => {
  const exact = verdict({ operations: [operation], hostSteps: [step], layers: [layerWith({ shapeKeys: { times: [0, 1], vertexCounts: [4, 4] } })] });
  assert.equal(exact.verificationState, "exact", JSON.stringify(exact));
  const failed = verdict({ operations: [operation], hostSteps: [step], layers: [layerWith({ shapeKeys: { times: [0, 1], vertexCounts: [4, 6] } })] });
  assert.equal(failed.verificationState, "failed");
  assert.equal(failed.basis, "shape-key-vertex-count-mismatch");
  assert.deepEqual([failed.time, failed.expectedVertices, failed.observedVertices], [1, 4, 6]);
});

test("mask mode, inverted and RotoBezier are compared strictly against the host readback", () => {
  const layer = makeLayer(LAYER, 1, { propertyPaths: [entry("ADBE Mask Parade/ADBE Mask Atom", { displayName: "Mask 1" })] });
  const update = { operation: "update_mask", maskId: "mask:1", values: { mode: "SUBTRACT", inverted: true, rotoBezier: false } };
  const readback = { name: "Mask 1", mode: "SUBTRACT", inverted: true, rotoBezier: false };
  const run = (observed: Row) => verdict({ operations: [update], hostSteps: [{ operation: "update_mask", readback: observed }], layers: [layer] });
  assert.equal(run(readback).verificationState, "exact");
  for (const field of ["mode", "inverted", "rotoBezier"]) {
    const result = run({ ...readback, [field]: field === "mode" ? "ADD" : field === "inverted" ? false : true });
    assert.equal(result.verificationState, "failed", field);
    assert.equal(result.field, field);
  }
});
