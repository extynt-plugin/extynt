// Tests for the affine matrix helpers the geometry solver builds on.
import test from "node:test";
import assert from "node:assert/strict";
import { applyMatrix, layerMatrix, multiplyMatrix } from "../src/solvers/matrix.js";
import type { LayerTransform2D, Matrix2D } from "../src/solvers/matrix.js";

const IDENTITY_TRANSFORM: LayerTransform2D = { anchor: [0, 0], position: [0, 0], scale: [100, 100], rotation: 0 };
const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be close to ${expected}`);
}

test("layerMatrix identity", () => {
  assert.deepEqual(layerMatrix(IDENTITY_TRANSFORM), IDENTITY_MATRIX);
});

test("layerMatrix with position", () => {
  const matrix = layerMatrix({ ...IDENTITY_TRANSFORM, position: [100, 200] });
  assert.strictEqual(matrix[4], 100);
  assert.strictEqual(matrix[5], 200);
});

test("layerMatrix with anchor offset moves the origin by position minus anchor", () => {
  const matrix = layerMatrix({ ...IDENTITY_TRANSFORM, anchor: [50, 50], position: [100, 100] });
  assert.strictEqual(matrix[4], 50);
  assert.strictEqual(matrix[5], 50);
});

test("layerMatrix with scale", () => {
  const matrix = layerMatrix({ ...IDENTITY_TRANSFORM, scale: [50, 200] });
  assert.strictEqual(matrix[0], 0.5);
  assert.strictEqual(matrix[3], 2);
});

test("layerMatrix rotation 90 degrees turns the x axis onto the y axis", () => {
  const matrix = layerMatrix({ ...IDENTITY_TRANSFORM, rotation: 90 });
  assertClose(matrix[0], 0);
  assertClose(matrix[1], 1);
  assertClose(matrix[2], -1);
  assertClose(matrix[3], 0);
});

test("applyMatrix identity", () => {
  assert.deepEqual(applyMatrix(IDENTITY_MATRIX, [5, 10]), [5, 10]);
});

test("applyMatrix translation", () => {
  assert.deepEqual(applyMatrix([1, 0, 0, 1, 100, 200], [0, 0]), [100, 200]);
});

test("applyMatrix rotation 90 degrees moves a point clockwise on screen", () => {
  const result = applyMatrix(layerMatrix({ ...IDENTITY_TRANSFORM, rotation: 90 }), [1, 0]);
  assertClose(result[0], 0);
  assertClose(result[1], 1);
});

test("multiplyMatrix identity", () => {
  assert.deepEqual(multiplyMatrix(IDENTITY_MATRIX, IDENTITY_MATRIX), IDENTITY_MATRIX);
});

test("multiplyMatrix translation chain applies the child first and the parent second", () => {
  const result = multiplyMatrix([1, 0, 0, 1, 100, 0], [1, 0, 0, 1, 50, 0]);
  assert.strictEqual(result[4], 150);
  assert.strictEqual(result[5], 0);
});
