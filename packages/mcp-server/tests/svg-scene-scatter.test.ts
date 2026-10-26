// Tests that data-scatter places a deterministic field of sized and faded shapes inside its area, clamps oversized counts, wins over data-repeat, and that translate rows of larger marks stay Repeaters.
import assert from "node:assert/strict";
import test from "node:test";
import { sceneManifest } from "../src/index.js";
import type { CompiledSceneLayer } from "../src/index.js";
import { compileScene, layerAt, layerNamed, present } from "./support/svg-scene.js";

const sky = (attributes: string, mark = '<circle cx="10" cy="10" r="3" fill="#fff"/>'): string => `<svg viewBox="0 0 800 600"><g id="Bg"><rect width="800" height="600" fill="#001"/></g><g id="Stars" ${attributes}>${mark}</g></svg>`;
const stars = (attributes: string, mark?: string): CompiledSceneLayer => layerNamed(compileScene(sky(attributes, mark), { width: 800, height: 600 }), "Stars");
const verticesOf = (layer: CompiledSceneLayer, index: number) => present(present(layer.shapes[index], `shape ${index}`).paths[0], `path of shape ${index}`).vertices;
const centreOf = (layer: CompiledSceneLayer, index: number): [number, number] => {
  const vertices = verticesOf(layer, index);
  const xs = vertices.map((vertex) => vertex[0]), ys = vertices.map((vertex) => vertex[1]);
  return [layer.anchor[0] + (Math.min(...xs) + Math.max(...xs)) / 2, layer.anchor[1] + (Math.min(...ys) + Math.max(...ys)) / 2];
};
const radiusOf = (layer: CompiledSceneLayer, index: number): number => {
  const xs = verticesOf(layer, index).map((vertex) => vertex[0]);
  return (Math.max(...xs) - Math.min(...xs)) / 2;
};
const opacityOf = (layer: CompiledSceneLayer, index: number): number => present(layer.shapes[index], `shape ${index}`).opacity ?? 100;

test("fraction repeat opacities are read as percent, larger values stay percent", () => {
  const row = (opacity: string) => stars(`data-repeat="5" data-repeat-offset="translate(30 0)" data-repeat-opacity="${opacity}"`, '<circle cx="10" cy="10" r="30" fill="#fff"/>').repeat;
  assert.deepEqual([row("0.2 0.95")?.startOpacity, row("0.2 0.95")?.endOpacity], [20, 95]);
  assert.equal(row("1")?.endOpacity, 100);
  assert.deepEqual([row("100 20")?.startOpacity, row("100 20")?.endOpacity], [100, 20]);
});

test("data-scatter places N shapes inside the area, sized and faded within range", () => {
  const layer = stars('data-scatter="40" data-scatter-area="100 50 300 200" data-scatter-size="1 2" data-scatter-opacity="0.5 0.8"');
  assert.equal(layer.shapes.length, 40);
  assert.equal(layer.scatter, 40);
  assert.equal(layer.repeat, undefined);
  for (let index = 0; index < 40; index += 1) {
    const [x, y] = centreOf(layer, index);
    assert.ok(x >= 99.9 && x <= 400.1 && y >= 49.9 && y <= 250.1, `${x},${y}`);
    assert.ok(radiusOf(layer, index) >= 3 - 0.05 && radiusOf(layer, index) <= 6 + 0.05, `radius ${radiusOf(layer, index)}`);
    assert.ok(opacityOf(layer, index) >= 49.9 && opacityOf(layer, index) <= 80.1, `opacity ${opacityOf(layer, index)}`);
  }
  const manifest = sceneManifest(compileScene(sky('data-scatter="40"'), { width: 800, height: 600 }));
  assert.equal(present(manifest.layers[1], "the Stars manifest row").scattered, "scattered 40");
});

test("a scatter is deterministic and defaults to the whole canvas", () => {
  const attributes = 'data-scatter="30"';
  assert.deepEqual(stars(attributes), stars(attributes));
  const [, , width, height] = stars(attributes).bounds;
  assert.ok(width > 400 && height > 300);
});

test("a copy never shrinks below one pixel of radius", () => {
  const layer = stars('data-scatter="20" data-scatter-size="0.01 0.02"');
  for (let index = 0; index < 20; index += 1) assert.ok(radiusOf(layer, index) >= 0.99, `radius ${radiusOf(layer, index)}`);
});

test("a count over the shape limit is clamped with a warning", () => {
  const result = compileScene(sky('data-scatter="400"'), { width: 800, height: 600 });
  assert.equal(layerAt(result, 1).shapes.length, 256);
  assert.ok(result.warnings.some((warning) => warning.includes("data-scatter 400")));
});

test("data-scatter wins over data-repeat and warns", () => {
  const result = compileScene(sky('data-scatter="10" data-repeat="5" data-repeat-offset="translate(9 9)"'), { width: 800, height: 600 });
  assert.equal(layerAt(result, 1).repeat, undefined);
  assert.equal(layerAt(result, 1).shapes.length, 10);
  assert.ok(result.warnings.some((warning) => warning.includes("data-repeat was ignored")));
});

test("the failed starfield (66 dot copies stepping translate(23 19)) compiles as a field with opacities 20..95", () => {
  const result = compileScene(sky('data-repeat="66" data-repeat-offset="translate(23 19)" data-repeat-opacity="0.2 0.95"', '<circle cx="50" cy="50" r="2" fill="#fff"/>'), { width: 800, height: 600 });
  const layer = layerAt(result, 1);
  assert.equal(layer.repeat, undefined);
  assert.equal(layer.scatter, 66);
  assert.equal(layer.shapes.length, 66);
  assert.ok(layer.shapes.every((shape) => (shape.opacity ?? 100) >= 19.9 && (shape.opacity ?? 100) <= 95.1));
  assert.ok(result.warnings.some((warning) => warning.includes("data-scatter")));
  assert.ok(layer.bounds[2] > 400 && layer.bounds[3] > 300);
});

test("a translate row of larger marks, or fewer than 20 copies, stays a Repeater", () => {
  assert.equal(stars('data-repeat="30" data-repeat-offset="translate(40 0)"', '<circle cx="10" cy="10" r="30" fill="#fff"/>').repeat?.copies, 30);
  assert.equal(stars('data-repeat="10" data-repeat-offset="translate(40 0)"').repeat?.copies, 10);
});
