// Shared assertions and accessors for the svg converter tests.
import assert from "node:assert/strict";
import { convertSvg, type ConvertedLayer, type ConvertedShape, type SvgConversion } from "../src/index.js";

export function svgOf(inner: string, attrs = 'viewBox="0 0 100 100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
}

export function converted(inner: string, attrs?: string): Extract<SvgConversion, { ok: true }> {
  const result = convertSvg(svgOf(inner, attrs));
  if (!result.ok) assert.fail(result.reason);
  return result;
}

export function refused(inner: string, attrs?: string): string {
  const result = convertSvg(svgOf(inner, attrs));
  if (result.ok) assert.fail("expected the converter to refuse this SVG");
  return result.reason;
}

export function shapesOf(inner: string, attrs?: string): ConvertedShape[] {
  return converted(inner, attrs).layers.flatMap((layer) => layer.shapes);
}

export function layersOf(inner: string, attrs?: string): ConvertedLayer[] { return converted(inner, attrs).layers; }

export function firstShape(inner: string, attrs?: string): ConvertedShape {
  const shape = shapesOf(inner, attrs)[0];
  assert.ok(shape, "the SVG converted to no shape");
  return shape;
}

export function verticesOf(inner: string, attrs?: string): ReadonlyArray<readonly number[]> { return firstShape(inner, attrs).paths[0]?.vertices ?? []; }

export function closeTo(actual: readonly number[] | undefined, expected: readonly number[], epsilon = 1e-3): void {
  assert.ok(actual, "missing value");
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => assert.ok(Math.abs((actual[index] ?? NaN) - value) <= epsilon, `${JSON.stringify(actual)} is not close to ${JSON.stringify(expected)}`));
}

export function allClose(actual: readonly (readonly number[])[] | undefined, expected: readonly (readonly number[])[], epsilon = 1e-3): void {
  assert.ok(actual, "missing list");
  assert.equal(actual.length, expected.length, JSON.stringify(actual));
  expected.forEach((point, index) => closeTo(actual[index], point, epsilon));
}
