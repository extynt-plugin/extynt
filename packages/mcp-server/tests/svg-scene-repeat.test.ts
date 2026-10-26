// Tests that data-repeat on a scene group becomes a native Repeater with scale, rotation, translate and opacity values, that invalid attributes only warn, and that a group without it adds no Repeater.
import assert from "node:assert/strict";
import test from "node:test";
import { designPlaceholder, sceneManifest } from "../src/index.js";
import type { SceneBuildTarget } from "../src/index.js";
import { compileScene, firstOp, layerAt, layerNamed, layerOps, opAt, opsOfType, present } from "./support/svg-scene.js";

const scene = (attributes: string): string => `<svg viewBox="0 0 800 600"><g id="Bg"><rect width="800" height="600" fill="#001"/></g><g id="Rings" data-anchor="400 300" ${attributes}><circle cx="400" cy="300" r="40" fill="none" stroke="#fc0" stroke-width="4"/></g></svg>`;
const rings = (attributes: string) => layerNamed(compileScene(scene(attributes)), "Rings");
const build: SceneBuildTarget = { compositionId: "comp-1", center: [400, 300], size: [800, 600] };

test("scale-only data-repeat makes concentric rings from one drawn circle", () => {
  const compiled = compileScene(scene('data-repeat="12" data-repeat-offset="scale(1.12)"'));
  const layer = layerNamed(compiled, "Rings");
  assert.equal(layer.shapes.length, 1);
  assert.deepEqual(layer.repeat, { copies: 12, position: [0, 0], scale: [112, 112] });
  const operations = layerOps(layer, designPlaceholder("Rings", 1), build);
  const draw = operations.findIndex((operation) => operation.type === "draw_vector_shapes");
  assert.deepEqual(opAt(operations, draw + 1), {
    type: "add_shape_item", target: opAt(operations, 0).target, groupId: "root", item: "repeater", newItemId: "__new__:design-2-rings-repeater", name: "Rings Repeater",
    values: { copies: 12, position: [0, 0], scale: [112, 112] },
  });
  assert.equal(present(sceneManifest(compiled).layers[1], "the Rings manifest row").repeater, "12 copies");
});

test("rotate-only, translate and opacity fade reach the Repeater values", () => {
  assert.deepEqual(rings('data-repeat="8" data-repeat-offset="rotate(45)"').repeat, { copies: 8, position: [0, 0], rotation: 45 });
  const row = rings('data-repeat="5" data-repeat-offset="translate(30 0) scale(0.9)" data-repeat-opacity="100 20"').repeat;
  assert.deepEqual(row, { copies: 5, position: [30, 0], scale: [90, 90], startOpacity: 100, endOpacity: 20 });
});

test("a translate offset follows the viewBox scale", () => {
  const compiled = compileScene('<svg viewBox="0 0 400 300"><g id="Dots"><circle cx="20" cy="20" r="5" fill="#fff"/></g><g id="Row" data-repeat="4" data-repeat-offset="translate(10 0)"><circle cx="20" cy="40" r="5" fill="#fff"/></g></svg>', { width: 800, height: 600 });
  assert.deepEqual(layerAt(compiled, 1).repeat?.position, [20, 0]);
});

test("invalid repeat attributes warn and add no Repeater", () => {
  for (const attributes of ['data-repeat="1" data-repeat-offset="scale(2)"', 'data-repeat="many" data-repeat-offset="scale(2)"', 'data-repeat="6"', 'data-repeat="6" data-repeat-offset="skewX(10)"', 'data-repeat="6" data-repeat-offset="scale(1)"']) {
    const result = compileScene(scene(attributes));
    assert.equal(layerAt(result, 1).repeat, undefined, attributes);
    assert.ok(result.warnings.some((warning) => warning.includes("data-repeat")), attributes);
  }
  const badOpacity = compileScene(scene('data-repeat="6" data-repeat-offset="scale(1.1)" data-repeat-opacity="loud"'));
  assert.equal(layerAt(badOpacity, 1).repeat?.copies, 6);
  assert.equal(layerAt(badOpacity, 1).repeat?.endOpacity, undefined);
  assert.ok(badOpacity.warnings.some((warning) => warning.includes("data-repeat-opacity")));
});

test("a layer without data-repeat has no Repeater operation", () => {
  const operations = layerOps(rings(""), designPlaceholder("Rings", 1), build);
  assert.equal(opsOfType(operations, "add_shape_item").length, 0);
  assert.ok(firstOp(operations, "draw_vector_shapes"));
});
