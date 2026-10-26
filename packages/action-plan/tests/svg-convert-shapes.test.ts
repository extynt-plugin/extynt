// Covers basic shape conversion: rect, circle, ellipse, line, polyline, polygon, groups and layers.
import test from "node:test";
import assert from "node:assert/strict";
import { allClose, closeTo, converted, firstShape, layersOf, refused, shapesOf, verticesOf } from "./svg-convert-helpers.js";

test("a rect is four closed straight vertices", () => {
  const shape = firstShape('<rect x="10" y="20" width="30" height="40"/>');
  allClose(shape.paths[0]?.vertices, [[10, 20], [40, 20], [40, 60], [10, 60]]);
  assert.equal(shape.paths[0]?.closed, true);
  assert.deepEqual(shape.fill, { color: [0, 0, 0] });
});

test("a rect with rx and ry has eight vertices and curved corners; a lone rx sets ry", () => {
  const rounded = firstShape('<rect width="40" height="20" rx="4" ry="2"/>').paths[0];
  assert.equal(rounded?.vertices.length, 8);
  allClose(rounded?.vertices.slice(0, 2), [[4, 0], [36, 0]]);
  closeTo(rounded?.outTangents?.[1], [2.2091, 0]);
  const loneRx = firstShape('<rect width="40" height="20" rx="4"/>').paths[0];
  closeTo(loneRx?.vertices[2], [40, 4]);
});

test("corner radii are clamped to half the rect", () => {
  const pill = firstShape('<rect width="40" height="20" rx="100"/>').paths[0];
  closeTo(pill?.vertices[0], [20, 0]);
  closeTo(pill?.vertices[2], [40, 10]);
});

test("a circle is four curved vertices with quarter-circle handles", () => {
  const circle = firstShape('<circle cx="50" cy="50" r="10"/>').paths[0];
  allClose(circle?.vertices, [[60, 50], [50, 60], [40, 50], [50, 40]]);
  closeTo(circle?.outTangents?.[0], [0, 5.5228]);
  closeTo(circle?.inTangents?.[0], [0, -5.5228]);
});

test("an ellipse is four curved vertices with quarter-ellipse handles", () => {
  const ellipse = firstShape('<ellipse cx="50" cy="50" rx="20" ry="10"/>').paths[0];
  allClose(ellipse?.vertices, [[70, 50], [50, 60], [30, 50], [50, 40]]);
  closeTo(ellipse?.outTangents?.[1], [-11.0457, 0]);
});

test("zero-sized shapes draw nothing", () => {
  assert.equal(converted('<rect width="0" height="5"/><circle r="0"/><rect width="9" height="9"/>').layers.length, 1);
});

test("a line is an open two-point path that only a stroke can draw", () => {
  const shape = firstShape('<line x1="0" y1="0" x2="50" y2="25" stroke="#f00" stroke-width="3"/>');
  allClose(shape.paths[0]?.vertices, [[0, 0], [50, 25]]);
  assert.equal(shape.paths[0]?.closed, false);
  assert.equal(shape.stroke?.width, 3);
  assert.equal(shape.fill, undefined, "a line has no fill area; the inherited black fill is not drawn for it");
});

test("polyline stays open and polygon closes; an odd trailing number is ignored", () => {
  assert.equal(firstShape('<polyline points="0,0 10,0 10,10" fill="none" stroke="#000"/>').paths[0]?.closed, false);
  const polygon = firstShape('<polygon points="0,0 10,0 10,10 7"/>').paths[0];
  assert.equal(polygon?.closed, true);
  allClose(polygon?.vertices, [[0, 0], [10, 0], [10, 10]]);
});

test("a shape with neither fill nor stroke is not drawn, and a missing path is skipped", () => {
  assert.match(refused('<rect width="9" height="9" fill="none"/>'), /no filled or stroked shapes/);
  assert.match(refused('<path/><path d=""/>'), /no filled or stroked shapes/);
});

test("display none and visibility hidden drop a subtree or an element", () => {
  assert.equal(shapesOf('<g display="none"><rect width="9" height="9"/></g><rect id="kept" width="9" height="9"/><rect width="9" height="9" visibility="hidden"/>').length, 1);
});

test("groups nest, and nothing inside defs, clipPath, mask, or symbol is drawn", () => {
  const shapes = shapesOf('<defs><rect id="a" width="9" height="9"/></defs><g><g><rect width="5" height="5"/></g></g><clipPath id="c"><rect width="9" height="9"/></clipPath><mask id="m"><rect width="9" height="9"/></mask>');
  assert.equal(shapes.length, 1);
});

test("one shape layer per top-level element or group, named by id or element and position, in document order", () => {
  const layers = layersOf('<rect id="bg" width="100" height="100"/><g id="logo"><circle r="5"/><path d="M0 0 L9 9" stroke="#000"/></g><defs/><g><rect width="1" height="1"/></g><circle cx="5" cy="5" r="3"/>');
  assert.deepEqual(layers.map((layer) => layer.name), ["bg", "logo", "g 4", "circle 5"]);
  assert.equal(layers[1]?.shapes.length, 2);
  assert.deepEqual(layers[1]?.shapes.map((shape) => shape.name), ["circle 2", "path 3"], "shape names count on across the document");
});

test("verticesOf reads the first path of the first shape", () => {
  allClose(verticesOf('<polygon points="1,2 3,4"/>'), [[1, 2], [3, 4]]);
});
