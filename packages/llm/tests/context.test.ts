/** Nested-layer fixtures: the ancestor walk in `selectProjectContext` is otherwise unexercised,
 * because the representative snapshot's selection has no parent chain. */
import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshot, type LayerSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { selectProjectContext } from "../src/index.js";

function layer(id: string, parentId: string | null): LayerSnapshot {
  return {
    id, index: 1, name: id, type: "null", enabled: true, shy: false, solo: false, locked: false,
    startTime: 0, inPoint: 0, outPoint: 5, stretch: 100, parentId, matteLayerId: null, matteType: "none",
    isSelected: false, sourceId: null, properties: [],
  };
}

function nestedSnapshot(layers: LayerSnapshot[], selectedLayerIds: string[]): ProjectSnapshot {
  return createSnapshot({
    capturedAt: "2026-09-11T15:00:00.000Z",
    host: { application: "After Effects", version: "26.2.1", buildNumber: "2", platform: "macOS", architecture: "arm64" },
    project: { name: "Nested", filePath: null },
    revision: "ae-revision-nested",
    activeCompositionId: "comp-nested",
    currentTime: 0,
    selection: { compositionId: "comp-nested", layerIds: selectedLayerIds },
    compositions: [
      { id: "comp-nested", name: "Nested", width: 1920, height: 1080, pixelAspect: 1, duration: 5, frameRate: 24, workAreaStart: 0, workAreaDuration: 5, layers },
    ],
  });
}

test("the ancestor walk reports each parent of a selected layer once", () => {
  const snapshot = nestedSnapshot([layer("layer-root", null), layer("layer-mid", "layer-root"), layer("layer-child", "layer-mid")], ["layer-child"]);
  const context = selectProjectContext(snapshot).context;
  assert.deepEqual(context.selectedLayers.map((entry) => entry.id), ["layer-child"]);
  assert.deepEqual(context.selectionAncestors.map((entry) => entry.id), ["layer-mid", "layer-root"]);
  assert.equal(new Set(context.selectionAncestors.map((entry) => entry.id)).size, context.selectionAncestors.length);
  assert.equal(context.selectionAncestors.every((entry) => entry.isSelected === false), true);
});

test("a selected parent is not repeated as an ancestor, and a parent outside the composition adds none", () => {
  const nested = [layer("layer-root", null), layer("layer-mid", "layer-root"), layer("layer-child", "layer-mid")];
  const bothSelected = selectProjectContext(nestedSnapshot(nested, ["layer-child", "layer-mid"])).context;
  assert.deepEqual(bothSelected.selectedLayers.map((entry) => entry.id), ["layer-child", "layer-mid"]);
  assert.deepEqual(bothSelected.selectionAncestors.map((entry) => entry.id), ["layer-root"]);

  const orphan = selectProjectContext(nestedSnapshot([layer("layer-child", "layer-gone")], ["layer-child"])).context;
  assert.deepEqual(orphan.selectionAncestors, []);
  assert.equal(orphan.selectedLayers.length, 1);
});
