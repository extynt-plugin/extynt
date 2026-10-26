// Covers path data conversion: commands, arcs, relative segments and malformed input.
import test from "node:test";
import assert from "node:assert/strict";
import { allClose, closeTo, converted, firstShape, shapesOf, verticesOf } from "./svg-convert-helpers.js";

const path = (d: string): string => `<path d="${d}" fill="#000"/>`;

test("absolute and relative lines, H and V, and Z build one closed path", () => {
  const shape = firstShape(path("M10 10 H30 V30 h-20 z"));
  assert.equal(shape.paths.length, 1);
  assert.equal(shape.paths[0]?.closed, true);
  allClose(shape.paths[0]?.vertices, [[10, 10], [30, 10], [30, 30], [10, 30]]);
  assert.equal(shape.paths[0]?.inTangents, undefined, "straight sides carry no tangents");
});

test("a repeated moveto is a lineto, and a relative moveto starts from the current point", () => {
  allClose(verticesOf(path("M0 0 10 0 10 10")), [[0, 0], [10, 0], [10, 10]]);
  assert.equal(shapesOf(path("M10 10 l5 0 m5 5 l5 0")).at(0)?.paths.length, 2);
  allClose(shapesOf(path("M10 10 l5 0 m5 5 l5 0"))[0]?.paths[1]?.vertices, [[20, 15], [25, 15]]);
});

test("a close that returns to the start merges the duplicate vertex", () => {
  allClose(verticesOf(path("M0 0 L10 0 L10 10 L0 0 Z")), [[0, 0], [10, 0], [10, 10]]);
});

test("a drawing command after Z continues from the start of the closed loop", () => {
  const paths = firstShape(path("M10 10 l10 0 l0 10 z l5 5")).paths;
  assert.equal(paths.length, 2);
  allClose(paths[1]?.vertices, [[10, 10], [15, 15]]);
});

test("C writes out and in tangents relative to their vertices", () => {
  const route = firstShape(path("M0 0 C0 10 10 10 10 0")).paths[0];
  allClose(route?.vertices, [[0, 0], [10, 0]]);
  allClose(route?.outTangents, [[0, 10], [0, 0]]);
  allClose(route?.inTangents, [[0, 0], [0, 10]]);
  assert.equal(route?.closed, false);
});

test("S reflects the previous cubic control point, and starts from the current point after a line", () => {
  const route = firstShape(path("M0 0 C0 10 10 10 10 0 S20 -10 20 0")).paths[0];
  allClose(route?.outTangents, [[0, 10], [0, -10], [0, 0]]);
  allClose(firstShape(path("M0 0 L10 0 S20 10 20 0")).paths[0]?.outTangents, [[0, 0], [0, 0], [0, 0]]);
});

test("Q becomes a cubic with the two thirds control points", () => {
  const route = firstShape(path("M0 0 Q10 10 20 0")).paths[0];
  allClose(route?.outTangents, [[6.6667, 6.6667], [0, 0]]);
  allClose(route?.inTangents, [[0, 0], [-6.6667, 6.6667]]);
});

test("T reflects the previous quadratic control point", () => {
  const route = firstShape(path("M0 0 Q10 10 20 0 T40 0")).paths[0];
  allClose(route?.outTangents, [[6.6667, 6.6667], [6.6667, -6.6667], [0, 0]]);
});

test("a half circle arc becomes cubics through the arc's midpoint", () => {
  const route = firstShape(`<path d="M0 0 A10 10 0 0 1 20 0" fill="none" stroke="#000"/>`).paths[0];
  assert.equal(route?.vertices.length, 3);
  closeTo(route?.vertices[1], [10, -10]);
  closeTo(route?.vertices[2], [20, 0]);
  closeTo(route?.outTangents?.[0], [0, -5.5228]);
});

test("the sweep and large-arc flags choose between the four arcs, including compact flag syntax", () => {
  const sweepZero = firstShape(`<path d="M0 0 a10 10 0 0 0 20 0" fill="none" stroke="#000"/>`).paths[0];
  closeTo(sweepZero?.vertices[1], [10, 10]);
  const compact = firstShape(`<path d="M0 0a10 10 0 0120 0" fill="none" stroke="#000"/>`).paths[0];
  closeTo(compact?.vertices[1], [10, -10]);
  const large = firstShape(`<path d="M0 0 A20 20 0 1 1 10 0" fill="none" stroke="#000"/>`).paths[0];
  assert.ok((large?.vertices.length ?? 0) >= 4, "a large arc is more than a half turn");
});

test("an arc with a zero radius is a straight side and radii too small are enlarged", () => {
  const straight = firstShape(`<path d="M0 0 A0 5 0 0 1 20 0" fill="none" stroke="#000"/>`).paths[0];
  allClose(straight?.vertices, [[0, 0], [20, 0]]);
  assert.equal(straight?.outTangents, undefined);
  const enlarged = firstShape(`<path d="M0 0 A1 1 0 0 1 20 0" fill="none" stroke="#000"/>`).paths[0];
  closeTo(enlarged?.vertices.at(-1), [20, 0]);
});

test("a syntax error keeps the path before it and is reported", () => {
  const result = converted(path("M0 0 L10 0 L oops"));
  allClose(result.layers[0]?.shapes[0]?.paths[0]?.vertices, [[0, 0], [10, 0]]);
  assert.deepEqual(result.notes.approximated, ["malformed-path-data"]);
});

test("coordinates may run together: signs, exponents and decimals without separators", () => {
  allClose(verticesOf(path("M1.5.5L1e1-2")), [[1.5, 0.5], [10, -2]]);
});
