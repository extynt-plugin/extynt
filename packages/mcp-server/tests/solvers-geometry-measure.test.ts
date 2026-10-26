// Tests for measureLayer on scaled, parented, animated, unsized and precomp layers, and the caveats it reports.
import test from "node:test";
import assert from "node:assert/strict";
import { measureLayer } from "../src/solvers/geometry.js";
import { makeComposition, makeLayer, measured, sceneSnapshot, solidSource, standardProperties, transformProperty } from "./solvers-fixtures.js";

test("measureLayer with scale", () => {
  const layer = makeLayer("layer1", "Solid", standardProperties({ anchor: [100, 50], position: [500, 500], scale: [50, 200] }), { sourceId: "solid1" });
  const result = measured({ layers: [layer], sources: [solidSource("solid1", 200, 100)] });
  assert.deepEqual(result.scaleInComp, [50, 200]);
});

test("measureLayer with parent chain", () => {
  const parent = makeLayer("parent", "Parent", standardProperties({ position: [500, 500], rotation: 90 }));
  const child = makeLayer("child", "Child", standardProperties({ position: [100, 0] }), { parentId: "parent" });
  const result = measured({ layers: [parent, child] }, "child");
  assert.deepEqual(result.anchorInComp, [500, 600]);
  assert.deepStrictEqual(result.parentChain, ["parent"]);
  assert.strictEqual(result.rotationInComp, 90);
});

test("measureLayer separated position dimensions", () => {
  const properties = [
    transformProperty("ADBE Anchor Point", [0, 0]),
    transformProperty("ADBE Position_0", 150),
    transformProperty("ADBE Position_1", 250),
    transformProperty("ADBE Scale", [100, 100]),
    transformProperty("ADBE Rotate Z", 0),
  ];
  const result = measured({ layers: [makeLayer("layer1", "Test", properties)] });
  assert.deepEqual(result.anchorInComp, [150, 250]);
});

test("measureLayer missing properties with caveat", () => {
  const result = measured({ layers: [makeLayer("layer1", "Test")] });
  assert.deepEqual(result.anchorInComp, [0, 0]);
  assert.ok(result.caveats.some((caveat) => caveat.includes("missing or invalid")));
});

test("measureLayer animated property caveat", () => {
  const properties = [
    transformProperty("ADBE Anchor Point", [0, 0]),
    transformProperty("ADBE Position", [100, 100], 5),
    transformProperty("ADBE Scale", [100, 100]),
    transformProperty("ADBE Rotate Z", 0),
  ];
  const result = measured({ layers: [makeLayer("layer1", "Test", properties)], currentTime: 2.5 });
  assert.ok(result.caveats.some((caveat) => caveat.includes("animated") && caveat.includes("2.5")));
});

test("measureLayer text layer no size", () => {
  const layer = makeLayer("layer1", "Text", standardProperties({ position: [960, 540] }), { type: "text" });
  const result = measured({ layers: [layer] });
  assert.strictEqual(result.size, null);
  assert.strictEqual(result.bounds, null);
  const sizeCaveat = result.caveats.find((caveat) => caveat.includes("no fixed size")) ?? "";
  assert.match(sizeCaveat, /sourceRectAtTime/, "the rendered extent for motion comes from an expression");
  assert.doesNotMatch(sizeCaveat, /capture a frame and use ae_observe_frame for rendered bounds/, "a capture is for judging appearance, not for measuring");
});

test("measureLayer parent cycle", () => {
  const layer1 = makeLayer("layer1", "Layer1", standardProperties(), { parentId: "layer2" });
  const layer2 = makeLayer("layer2", "Layer2", standardProperties(), { parentId: "layer1" });
  const result = measureLayer(sceneSnapshot({ layers: [layer1, layer2] }), "comp1", "layer1");
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert(result.error.message.includes("cycle"));
});

test("measureLayer precomp source size", () => {
  const layer = makeLayer("layer1", "Precomp", standardProperties(), { compositionSourceId: "precomp-comp" });
  const precomp = makeComposition("precomp-comp", [], [640, 480]);
  const result = measured({ layers: [layer], otherCompositions: [precomp] });
  assert.deepEqual(result.size, [640, 480]);
});
