/** The fake host's capture is a crude picture of the composition's visible layers, not a flat field. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectSnapshot } from "@extynt/project-graph";
import { applyOperationsToFixture } from "../src/fake-host.js";
import { fixtureSnapshotFromProbe } from "../src/fake-host-probe.js";
import { scenePng } from "../src/fake-plugin-frame.js";
import { sceneOf } from "../src/fake-plugin-scene.js";
import type { WireObject } from "../src/wire-types.js";

const empty = (): ProjectSnapshot => applyOperationsToFixture({ snapshot: fixtureSnapshotFromProbe({ result: {} }), operations: [{ type: "create_composition", newCompositionId: "__new__:c", name: "C", width: 1000, height: 500, durationSeconds: 5, frameRate: 30 }] }).snapshot;

function sceneWith(layers: readonly WireObject[]) {
  const base = empty(), id = base.compositions[0]?.id ?? "";
  const snapshot = layers.length ? applyOperationsToFixture({ snapshot: base, operations: layers.map((layer, at) => ({ type: "create_layer", target: { compositionId: id, layerId: `__new__:l${at}` }, ...layer })) }).snapshot : base;
  return sceneOf({ project: snapshot, compositionId: id, time: 1, width: 200, height: 100 });
}

const spans = (start: number, size: number, middle: number): boolean => start < middle && start + size > middle;

test("an empty composition captures a flat background frame", () => {
  const scene = sceneWith([]);
  assert.deepEqual(scene?.rects, []);
  assert.ok(scenePng(200, 100, scene?.background ?? [0, 0, 0], []).length > 0);
});

test("a centred text layer covers the middle of the frame and leaves the corners as background", () => {
  const scene = sceneWith([{ layerType: "text", name: "T", text: "Hello" }]);
  assert.equal(scene?.rects.length, 1);
  const rect = scene?.rects[0];
  assert.ok(rect, "the text layer drew a rectangle");
  assert.ok(spans(rect.x, rect.width, 100), `${JSON.stringify(rect)} covers the horizontal middle`);
  assert.ok(spans(rect.y, rect.height, 50), `${JSON.stringify(rect)} covers the vertical middle`);
  assert.ok(rect.x > 0 && rect.y > 0, "the near corners stay background");
  assert.ok(rect.x + rect.width < 200 && rect.y + rect.height < 100, "the far corners stay background");
  assert.deepEqual(rect.rgb, [255, 255, 255]);
});

test("nulls and cameras draw nothing", () => {
  const scene = sceneWith([{ layerType: "null", name: "N" }, { layerType: "camera", name: "Cam" }]);
  assert.deepEqual(scene?.rects, []);
});

test("an unknown composition has no scene", () => {
  assert.equal(sceneOf({ project: empty(), compositionId: "nope", time: 0, width: 10, height: 10 }), undefined);
});
