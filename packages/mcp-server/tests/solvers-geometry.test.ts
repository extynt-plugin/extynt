// Tests for measureLayer: refusals, an unsized layer, a solid with a size, and a rotated solid.
import test from "node:test";
import assert from "node:assert/strict";
import { measureLayer } from "../src/solvers/geometry.js";
import { makeLayer, measured, sceneSnapshot, solidSource, standardProperties } from "./solvers-fixtures.js";

test("measureLayer unknown composition", () => {
  const result = measureLayer(sceneSnapshot({ layers: [] }), "unknown-comp", "layer1");
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert(result.error.message.includes("Composition"));
});

test("measureLayer unknown layer", () => {
  const result = measureLayer(sceneSnapshot({ layers: [] }), "comp1", "unknown-layer");
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert(result.error.message.includes("Layer"));
});

test("measureLayer identity layer with no source", () => {
  const result = measured({ layers: [makeLayer("layer1", "Test", standardProperties())] });
  assert.deepEqual(result.anchorInComp, [0, 0]);
  assert.strictEqual(result.size, null);
  assert.strictEqual(result.bounds, null);
});

test("measureLayer solid with size and position", () => {
  const layer = makeLayer("layer1", "Solid", standardProperties({ anchor: [100, 50], position: [960, 540] }), { sourceId: "solid1" });
  const result = measured({ layers: [layer], sources: [solidSource("solid1", 200, 100)] });
  assert.deepEqual(result.size, [200, 100]);
  assert.deepEqual(result.bounds, { left: 860, top: 490, right: 1060, bottom: 590, width: 200, height: 100, center: [960, 540] });
});

test("measureLayer rotated solid", () => {
  const properties = standardProperties({ anchor: [100, 50], position: [960, 540], rotation: 90 });
  const layer = makeLayer("layer1", "Solid", properties, { sourceId: "solid1" });
  const result = measured({ layers: [layer], sources: [solidSource("solid1", 200, 100)] });
  assert.strictEqual(result.bounds?.width, 100);
  assert.strictEqual(result.bounds?.height, 200);
  assert.deepEqual(result.bounds?.center, [960, 540]);
  assert.strictEqual(result.rotationInComp, 90);
});
