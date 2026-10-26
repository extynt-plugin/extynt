// Covers fill, stroke, opacity, gradient and inherited style conversion and what is reported as approximated or skipped.
import test from "node:test";
import assert from "node:assert/strict";
import { converted, firstShape, refused } from "./svg-convert-helpers.js";

const square = (attrs: string): string => `<rect width="10" height="10" ${attrs}/>`;

test("fill colours: #rgb, #rrggbb, rgb(), percentages, and named basics", () => {
  assert.deepEqual(firstShape(square('fill="#f00"')).fill?.color, [1, 0, 0]);
  assert.deepEqual(firstShape(square('fill="#00ff80"')).fill?.color, [0, 1, 0.502]);
  assert.deepEqual(firstShape(square('fill="rgb(0, 0, 255)"')).fill?.color, [0, 0, 1]);
  assert.deepEqual(firstShape(square('fill="rgb(100%, 50%, 0%)"')).fill?.color, [1, 0.5, 0]);
  assert.deepEqual(firstShape(square('fill="navy"')).fill?.color, [0, 0, 0.502]);
  assert.deepEqual(firstShape(square('fill="WHITE"')).fill?.color, [1, 1, 1]);
});

test("the default fill is black and the default stroke is none", () => {
  const shape = firstShape(square(""));
  assert.deepEqual(shape.fill, { color: [0, 0, 0] });
  assert.equal(shape.stroke, undefined);
});

test("fill none with a stroke draws the stroke only, with width, cap, join and miter limit", () => {
  const shape = firstShape(square('fill="none" stroke="#0f0" stroke-width="4" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="8"'));
  assert.equal(shape.fill, undefined);
  assert.deepEqual(shape.stroke, { color: [0, 1, 0], width: 4, cap: 2, join: 3, miterLimit: 8 });
  assert.deepEqual(firstShape(square('fill="none" stroke="#000" stroke-linecap="square" stroke-linejoin="round"')).stroke, { color: [0, 0, 0], width: 1, cap: 3, join: 2 });
});

test("opacity, fill-opacity and stroke-opacity become AE percentages", () => {
  const shape = firstShape(square('fill="#f00" stroke="#00f" opacity="0.5" fill-opacity="0.25" stroke-opacity="0.8"'));
  assert.equal(shape.opacity, 50);
  assert.equal(shape.fill?.opacity, 25);
  assert.equal(shape.stroke?.opacity, 80);
  assert.equal(firstShape(square('fill="#f00"')).opacity, undefined);
});

test("an alpha channel in the colour multiplies into the paint opacity", () => {
  assert.equal(firstShape(square('fill="#ff000080"')).fill?.opacity, 50.1961);
  assert.equal(firstShape(square('fill="rgba(0,0,0,0.5)" fill-opacity="0.5"')).fill?.opacity, 25);
});

test("fill-rule evenodd selects AE's even-odd rule", () => {
  assert.equal(firstShape('<path d="M0 0 L10 0 L10 10 Z M2 2 L8 2 L8 8 Z" fill-rule="evenodd"/>').fill?.rule, 2);
  assert.equal(firstShape(square("")).fill?.rule, undefined);
});

test("presentation attributes inherit from groups and the root; currentColor follows color", () => {
  const shape = firstShape('<g fill="#00f" stroke="#fff" stroke-width="2"><rect width="5" height="5"/></g>');
  assert.deepEqual([shape.fill?.color, shape.stroke?.width], [[0, 0, 1], 2]);
  const rooted = converted('<rect width="5" height="5"/>', 'viewBox="0 0 10 10" fill="#0f0"');
  assert.deepEqual(rooted.layers[0]?.shapes[0]?.fill?.color, [0, 1, 0]);
  assert.deepEqual(firstShape('<g color="#f00"><rect width="5" height="5" fill="currentColor"/></g>').fill?.color, [1, 0, 0]);
});

test("group opacity multiplies into its shapes and is reported as approximated", () => {
  const result = converted('<g opacity="0.5"><g opacity="0.5"><rect width="5" height="5"/></g></g>');
  assert.equal(result.layers[0]?.shapes[0]?.opacity, 25);
  assert.deepEqual(result.notes.approximated, ["group-opacity"]);
});

test("a gradient paint uses its first stop and records the approximation", () => {
  const result = converted('<defs><linearGradient id="g"><stop offset="0" stop-color="#ff8000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>');
  assert.deepEqual(result.layers[0]?.shapes[0]?.fill?.color, [1, 0.502, 0]);
  assert.deepEqual(result.notes.approximated, ["gradient"]);
});

test("a gradient reaches its stops through href, on strokes too, and a stop opacity counts", () => {
  const result = converted('<defs><linearGradient id="base"><stop stop-color="#00ff00" stop-opacity="0.5"/></linearGradient><radialGradient id="r" href="#base"/></defs><circle r="5" fill="none" stroke="url(#r)"/>');
  const stroke = result.layers[0]?.shapes[0]?.stroke;
  assert.deepEqual([stroke?.color, stroke?.opacity], [[0, 1, 0], 50]);
  assert.deepEqual(result.notes.approximated, ["gradient"]);
});

test("a pattern fill or a dangling reference is not painted and is reported", () => {
  const pattern = converted('<defs><pattern id="p" width="2" height="2"/></defs><rect width="9" height="9" fill="url(#p)" stroke="#000"/>');
  assert.equal(pattern.layers[0]?.shapes[0]?.fill, undefined);
  assert.deepEqual(pattern.notes.skipped, ["pattern-paint"]);
  assert.deepEqual(converted('<rect width="9" height="9" fill="url(#nope)" stroke="#000"/>').notes.skipped, ["missing-paint-reference"]);
  assert.deepEqual(converted('<rect width="9" height="9" fill="url(#nope) #f00"/>').layers[0]?.shapes[0]?.fill?.color, [1, 0, 0]);
});

test("an unreadable colour keeps the inherited paint and says so", () => {
  const result = converted('<g fill="#f00"><rect width="9" height="9" fill="bluish"/></g>');
  assert.deepEqual(result.layers[0]?.shapes[0]?.fill?.color, [1, 0, 0]);
  assert.deepEqual(result.notes.approximated, ["unsupported-colour"]);
});

test("text is skipped and reported; an SVG of only text has nothing to convert", () => {
  const result = converted('<rect width="9" height="9"/><text x="1" y="9">Hi</text>');
  assert.deepEqual(result.notes.skipped, ["text"]);
  assert.equal(result.layers.length, 1);
  assert.match(refused('<text>Only text</text>'), /no filled or stroked shapes/);
});

test("clip-path, mask, filter and dashes are skipped features, never silent", () => {
  const result = converted('<rect width="9" height="9" clip-path="url(#c)" mask="url(#m)" filter="url(#f)" stroke="#000" stroke-dasharray="2 2"/>');
  assert.deepEqual(result.notes.skipped, ["clip-path", "mask", "filter", "stroke-dasharray"]);
});

test("a stroke of zero width or transparent paint is not drawn", () => {
  assert.equal(firstShape(square('stroke="#000" stroke-width="0"')).stroke, undefined);
  assert.equal(firstShape(square('stroke="transparent"')).stroke, undefined);
});
