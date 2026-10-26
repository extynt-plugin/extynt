// Covers how the converter reads the svg frame: viewBox, size, alignment and nested svg elements.
import test from "node:test";
import assert from "node:assert/strict";
import { convertSvg, vectorArtworkFallback } from "../src/index.js";
import { allClose, converted, refused, svgOf, verticesOf } from "./svg-convert-helpers.js";

const marker = '<path d="M0 0 L100 50"/>';

test("width and height set the comp size and the viewBox is scaled into it", () => {
  const result = converted('<rect width="100" height="50"/>', 'width="200" height="100" viewBox="0 0 100 50"');
  assert.deepEqual(result.size, [200, 100]);
  allClose(result.layers[0]?.shapes[0]?.paths[0]?.vertices, [[0, 0], [200, 0], [200, 100], [0, 100]]);
});

test("a viewBox alone sets the comp size; one dimension and a viewBox derive the other", () => {
  assert.deepEqual(converted(marker, 'viewBox="0 0 120 80"').size, [120, 80]);
  assert.deepEqual(converted(marker, 'width="240" viewBox="0 0 120 80"').size, [240, 160]);
  assert.deepEqual(converted(marker, 'height="40" viewBox="0 0 120 80"').size, [60, 40]);
});

test("width and height without a viewBox draw in pixels; units convert at 96 per inch", () => {
  const result = converted(marker, 'width="1in" height="48pt"');
  assert.deepEqual(result.size, [96, 64]);
  allClose(result.layers[0]?.shapes[0]?.paths[0]?.vertices, [[0, 0], [100, 50]]);
});

test("a viewBox origin shifts the content", () => {
  allClose(verticesOf('<path d="M10 10 L20 20"/>', 'viewBox="10 10 100 100"'), [[0, 0], [10, 10]]);
});

test("preserveAspectRatio: meet centres by default, and none stretches", () => {
  allClose(verticesOf('<path d="M0 0 L100 50"/>', 'width="200" height="200" viewBox="0 0 100 50"'), [[0, 50], [200, 150]]);
  allClose(verticesOf('<path d="M0 0 L100 50"/>', 'width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="none"'), [[0, 0], [200, 200]]);
  allClose(verticesOf('<path d="M0 0 L100 50"/>', 'width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="xMinYMin meet"'), [[0, 0], [200, 100]]);
  allClose(verticesOf('<path d="M0 0 L100 50"/>', 'width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="xMaxYMax slice"'), [[-200, 0], [200, 200]]);
});

test("percentage lengths resolve against the viewBox", () => {
  allClose(verticesOf('<rect width="50%" height="10%"/>', 'viewBox="0 0 200 100"'), [[0, 0], [100, 0], [100, 10], [0, 10]]);
});

test("an SVG without any size is refused with the reason", () => {
  assert.match(refused(marker, ""), /no usable width, height or viewBox/);
  assert.match(refused(marker, 'width="50%" height="50%"'), /no usable width, height or viewBox/);
});

test("a comp larger than After Effects allows is refused", () => {
  assert.match(refused(marker, 'width="40000" height="10"'), /30000 px comp limit/);
});

test("vectorArtworkFallback carries layers, size and notes, or the reason there is none", () => {
  const good = vectorArtworkFallback(svgOf('<rect width="10" height="10"/>', 'width="64" height="48"'));
  assert.deepEqual(good.fallbackSize, [64, 48]);
  assert.equal(good.fallbackLayers?.length, 1);
  assert.deepEqual(good.fallbackNotes, { approximated: [], skipped: [] });
  assert.equal(good.fallbackUnavailable, undefined);
  const bad = vectorArtworkFallback(svgOf("<text>x</text>"));
  assert.match(bad.fallbackUnavailable ?? "", /no filled or stroked shapes/);
  assert.equal(bad.fallbackLayers, undefined);
});

test("markup that is not an SVG tree is refused rather than thrown", () => {
  assert.equal(convertSvg("<svg><g></svg>").ok, false);
  assert.equal(convertSvg("<div/>").ok, false);
  assert.equal(vectorArtworkFallback("not xml").fallbackUnavailable !== undefined, true);
});

test("a nested svg is drawn as a group and flagged", () => {
  const result = converted('<svg><rect width="5" height="5"/></svg>');
  assert.equal(result.layers.length, 1);
  assert.deepEqual(result.notes.approximated, ["nested-svg"]);
});
