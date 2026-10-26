/**
 * Apply-plan host contract: inline SVG becomes a native shape composition with the requested timing, and a managed source copy.
 * The fake host and payload builders live in host-apply-harness.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FakeCompItem, loadApplyPlan } from "./host-apply-harness.js";
import { required } from "./host-fake-lookup.js";
import { applyPlan, assertApplied } from "./host-plan-io.js";
import { fieldOf } from "./json-narrow.js";

const GRADIENT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#0ff"/><stop offset="1" stop-color="#fa0"/></linearGradient></defs><g transform="translate(10 10)"><path d="M0 0 L80 0 L40 80 Z" fill="url(#g)"/></g></svg>';

function importedComposition(projectItems: ReadonlyArray<ReturnType<typeof loadApplyPlan>["projectItems"][number]>, name: string): FakeCompItem {
  return required(projectItems.find((item): item is FakeCompItem => item instanceof FakeCompItem && item.name === name), `composition ${name}`);
}

test("apply_plan materialises bounded inline SVG, spans its composition and layers, and reports retained source", () => {
  const { apply, comp, projectItems, writtenContents } = loadApplyPlan();
  const sourceHash = "a".repeat(64);
  const requestedDuration = 6;
  const requestedFrameRate = 24;
  const metadata = { bytes: Buffer.byteLength(GRADIENT_SVG), elements: 7, maxDepth: 4, pathCommands: 4, gradientStops: 2, gradients: 1, masks: 0, clipPaths: 0, sourceHash };
  const result = applyPlan(apply, "svg-editable", [
    {
      operation: "create_vector_artwork", newItemId: "__new__:vector", name: "Gradient Mark", svg: GRADIENT_SVG, sourceHash, metadata,
      importMode: "editable", managedSourcePolicy: "retain", durationSeconds: requestedDuration, frameRate: requestedFrameRate,
    },
    { operation: "create_layer", compositionId: "comp-main", layerId: "__new__:vector-layer", layerType: "footage", sourceItemId: "__new__:vector", name: "Gradient Mark" },
  ]);
  assertApplied(result);
  assert.equal(fieldOf(result, "steps", 0, "verification"), "managed-svg-written-and-native-shape-composition-imported");
  assert.equal(fieldOf(result, "steps", 0, "nativeShapeLayers"), 1);
  assert.equal(fieldOf(result, "steps", 0, "sourceHash"), sourceHash);
  assert.equal(fieldOf(result, "steps", 0, "durationSeconds"), requestedDuration);
  assert.equal(fieldOf(result, "steps", 0, "frameRate"), requestedFrameRate);
  assert.equal(fieldOf(result, "managedSources", 0, "persistsAfterUndo"), true);
  assert.match(String(fieldOf(result, "receipt", "rollback")), /retained managed SVG files remain on disk/);
  assert.equal(fieldOf(result, "managedSources", 0, "path"), undefined, "receipts do not expose the user's absolute managed-app-data path");
  const managedPath = [...writtenContents.keys()].find((path) => /^\/user-data\/extynt\/Managed SVG\/svg-/.test(path));
  assert.ok(managedPath, "the host wrote the source under its private managed SVG directory");
  assert.equal(writtenContents.get(managedPath), GRADIENT_SVG);
  const imported = importedComposition(projectItems, "Gradient Mark");
  assert.equal(imported.duration, requestedDuration);
  assert.equal(imported.frameRate, requestedFrameRate);
  assert.equal(imported.layerItems.every((layer) => layer.inPoint === 0 && layer.outPoint === requestedDuration), true);
  const last = required(comp.layerItems.at(-1), "layer added to the composition");
  assert.equal(last.name, "Gradient Mark");
  assert.equal(last.inPoint, 0);
  assert.equal(last.outPoint, requestedDuration);
});

test("apply_plan uses the documented one-second 30 fps vector fallback when no composition timing is supplied", () => {
  const { apply, projectItems } = loadApplyPlan();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
  const sourceHash = "b".repeat(64);
  const metadata = { bytes: Buffer.byteLength(svg), elements: 2, maxDepth: 1, pathCommands: 2, gradientStops: 0, gradients: 0, masks: 0, clipPaths: 0, sourceHash };
  const result = applyPlan(apply, "svg-default-timing", [
    { operation: "create_vector_artwork", newItemId: "__new__:vector", name: "Default Mark", svg, sourceHash, metadata, importMode: "editable", managedSourcePolicy: "retain" },
  ]);
  assertApplied(result);
  const imported = importedComposition(projectItems, "Default Mark");
  assert.equal(imported.duration, 1);
  assert.equal(imported.frameRate, 30);
  assert.equal(imported.layerItems.every((layer) => layer.inPoint === 0 && layer.outPoint === 1), true);
  assert.equal(fieldOf(result, "steps", 0, "durationSeconds"), 1);
  assert.equal(fieldOf(result, "steps", 0, "frameRate"), 30);
});
