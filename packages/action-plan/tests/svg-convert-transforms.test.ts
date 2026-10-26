// Covers transform parsing and how matrices are applied to converted vertices.
import test from "node:test";
import assert from "node:assert/strict";
import { allClose, closeTo, converted, firstShape, verticesOf } from "./svg-convert-helpers.js";

const unitPath = (transform: string): string => `<path transform="${transform}" d="M0 0 L10 0 L10 10"/>`;

test("translate and scale move and grow the points", () => {
  allClose(verticesOf(unitPath("translate(5 7)")), [[5, 7], [15, 7], [15, 17]]);
  allClose(verticesOf(unitPath("translate(3)")), [[3, 0], [13, 0], [13, 10]]);
  allClose(verticesOf(unitPath("scale(2 3)")), [[0, 0], [20, 0], [20, 30]]);
  allClose(verticesOf(unitPath("scale(2)")), [[0, 0], [20, 0], [20, 20]]);
});

test("rotate turns clockwise on screen about the origin or a centre", () => {
  allClose(verticesOf(unitPath("rotate(90)")), [[0, 0], [0, 10], [-10, 10]]);
  allClose(verticesOf(unitPath("rotate(180 5 5)")), [[10, 10], [0, 10], [0, 0]]);
});

test("skewX, skewY and matrix", () => {
  allClose(verticesOf(unitPath("skewX(45)")), [[0, 0], [10, 0], [20, 10]]);
  allClose(verticesOf(unitPath("skewY(45)")), [[0, 0], [10, 10], [10, 20]]);
  allClose(verticesOf(unitPath("matrix(1 0 0 2 4 5)")), [[4, 5], [14, 5], [14, 25]]);
});

test("a list of transforms applies right to left on the point, like SVG", () => {
  allClose(verticesOf(unitPath("translate(10 0) scale(2)")), [[10, 0], [30, 0], [30, 20]]);
  allClose(verticesOf(unitPath("scale(2) translate(10 0)")), [[20, 0], [40, 0], [40, 20]]);
  allClose(verticesOf(unitPath("translate(1,2),scale(2)")), [[1, 2], [21, 2], [21, 22]]);
});

test("group transforms compose down the tree, outer first", () => {
  const vertices = verticesOf('<g transform="translate(10 0)"><g transform="scale(2)"><path d="M1 0 L2 0"/></g></g>');
  allClose(vertices, [[12, 0], [14, 0]]);
});

test("tangents follow the transform without its translation", () => {
  const route = firstShape('<path transform="translate(50 50) scale(2)" d="M0 0 C0 10 10 10 10 0" fill="none" stroke="#000"/>').paths[0];
  allClose(route?.vertices, [[50, 50], [70, 50]]);
  allClose(route?.outTangents, [[0, 20], [0, 0]]);
});

test("a malformed transform is left out and reported", () => {
  const result = converted('<path transform="spin(3)" d="M0 0 L10 0"/>');
  allClose(result.layers[0]?.shapes[0]?.paths[0]?.vertices, [[0, 0], [10, 0]]);
  assert.deepEqual(result.notes.skipped, ["invalid-transform"]);
});

test("a stroke width grows with the scale of the transform", () => {
  const shape = firstShape('<path transform="scale(3)" d="M0 0 L10 0" fill="none" stroke="#000" stroke-width="2"/>');
  assert.equal(shape.stroke?.width, 6);
});

test("a non-uniform scale is approximated for the stroke and says so", () => {
  const result = converted('<path transform="scale(1 4)" d="M0 0 L10 0" fill="none" stroke="#000" stroke-width="2"/>');
  assert.equal(result.layers[0]?.shapes[0]?.stroke?.width, 4);
  assert.deepEqual(result.notes.approximated, ["non-uniform-stroke-scale"]);
  closeTo([result.layers[0]?.shapes[0]?.stroke?.width ?? 0], [4]);
});
