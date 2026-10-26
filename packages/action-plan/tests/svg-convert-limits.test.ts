// Covers the converter's size limits and the refusals they produce.
import test from "node:test";
import assert from "node:assert/strict";
import { convertSvg } from "../src/index.js";
import { converted, refused, svgOf } from "./svg-convert-helpers.js";

const rects = (count: number): string => Array.from({ length: count }, (_, index) => `<rect x="${index}" width="1" height="1"/>`).join("");
const polyline = (points: number): string => `<polyline fill="none" stroke="#000" points="${Array.from({ length: points }, (_, index) => `${index},${index % 7}`).join(" ")}"/>`;

test("exactly 256 shapes still convert", () => {
  const result = converted(rects(256));
  assert.equal(result.layers.length, 256);
});

test("257 shapes make the fallback unavailable, and the reason says so", () => {
  const reason = refused(rects(257));
  assert.match(reason, /more than 256 shapes/);
  assert.match(reason, /fallback is unavailable/);
});

test("more than 12000 points make the fallback unavailable", () => {
  assert.match(refused(Array.from({ length: 13 }, () => polyline(1000)).join("")), /more than 12000 points/);
  assert.equal(converted(Array.from({ length: 12 }, () => polyline(1000)).join("")).layers.length, 12);
});

test("a single subpath of more than 1000 points is refused", () => {
  assert.match(refused(polyline(1001)), /more than 1000 points/);
});

test("an element with more than 64 subpaths is refused", () => {
  const subpaths = Array.from({ length: 65 }, (_, index) => `M${index} 0 L${index} 5`).join(" ");
  assert.match(refused(`<path fill="none" stroke="#000" d="${subpaths}"/>`), /65 subpaths/);
});

test("nothing is dropped silently: a refused SVG yields no layers at all", () => {
  const result = convertSvg(svgOf(rects(300)));
  assert.equal(result.ok, false);
  assert.equal("layers" in result, false);
});
