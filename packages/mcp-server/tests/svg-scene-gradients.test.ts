// Tests for SVG gradients reduced to a two-colour ramp: stop offsets move the ramp's ends, and every loss the ramp cannot carry is warned about.
import assert from "node:assert/strict";
import test from "node:test";
import { compileSvgScene, type CompiledScene, type CompiledSceneLayer } from "../src/index.js";

function scene(defs: string, shape: string): CompiledScene {
  const result = compileSvgScene(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs>${defs}</defs><g id="Part">${shape}</g></svg>`, { width: 1000, height: 1000 });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.scene;
}

function part(compiled: CompiledScene): CompiledSceneLayer {
  const found = compiled.layers.find((entry) => entry.name === "Part");
  assert.ok(found?.ramp, "Part was compiled with a ramp");
  return found;
}

function warningsAbout(compiled: CompiledScene): string {
  return compiled.warnings.filter((warning) => warning.startsWith('"Part"')).join("\n");
}

const WIDE_RECT = '<rect x="0" y="0" width="1000" height="100" fill="url(#g)"/>';
const SQUARE = '<rect x="0" y="0" width="400" height="400" fill="url(#g)"/>';

test("a linear gradient's first and last stop offsets move the ramp's start and end", () => {
  const compiled = scene('<linearGradient id="g"><stop offset="0.2" stop-color="#000"/><stop offset="80%" stop-color="#fff"/></linearGradient>', WIDE_RECT);
  const ramp = part(compiled).ramp;
  assert.deepEqual([ramp?.start, ramp?.end], [[-300, -50], [300, -50]]);
  assert.equal(warningsAbout(compiled), "");
});

test("a radial gradient's last stop offset shrinks the ramp's radius", () => {
  const ramp = part(scene('<radialGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="0.5" stop-color="#fff"/></radialGradient>', SQUARE)).ramp;
  assert.deepEqual([ramp?.start, ramp?.end], [[0, 0], [100, 0]]);
});

test("a middle stop off the straight blend is warned about; one on it is not", () => {
  const off = scene('<linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="0.5" stop-color="#0f0"/><stop offset="1" stop-color="#f00"/></linearGradient>', WIDE_RECT);
  assert.match(warningsAbout(off), /middle colour stops are not carried/);
  const on = scene('<linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="0.5" stop-color="#800000"/><stop offset="1" stop-color="#f00"/></linearGradient>', WIDE_RECT);
  assert.equal(warningsAbout(on), "");
});

test("a radial focal point is warned about", () => {
  const compiled = scene('<radialGradient id="g" fx="0.2" fy="0.3"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>', SQUARE);
  assert.match(warningsAbout(compiled), /focal point \(fx, fy\) is not carried/);
});

test("a radial stretched by a non-square box is warned about; a square one is not", () => {
  const radial = '<radialGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>';
  assert.match(warningsAbout(scene(radial, WIDE_RECT)), /stretched into an ellipse/);
  assert.equal(warningsAbout(scene(radial, SQUARE)), "");
});

test("a radial whose first stop is off its centre is warned about", () => {
  const compiled = scene('<radialGradient id="g"><stop offset="0.3" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>', SQUARE);
  assert.match(warningsAbout(compiled), /first stop is off its centre/);
});

test("stop opacity is still warned about", () => {
  const compiled = scene('<linearGradient id="g"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#fff"/></linearGradient>', WIDE_RECT);
  assert.match(warningsAbout(compiled), /stop opacity is not carried/);
});
