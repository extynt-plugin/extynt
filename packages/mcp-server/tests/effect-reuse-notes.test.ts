// Tests for effect reuse notes.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot, type ProjectSnapshot } from "@extynt/project-graph";
import { effectReuseNotes } from "../src/effect-reuse-notes.js";

const PARADE = "ADBE Effect Parade";
function withGlow(): ProjectSnapshot {
  const snapshot: ProjectSnapshot = structuredClone(representativeSnapshot);
  const layer = snapshot.compositions.find((composition) => composition.id === "comp-main")?.layers.find((candidate) => candidate.id === "layer-title");
  assert.ok(layer);
  layer.properties = [{ path: PARADE, matchName: PARADE, displayName: "Effects", kind: "group", valueType: "unknown", value: null, canSetValue: false, children: [{ path: `${PARADE}/ADBE Glo2`, matchName: "ADBE Glo2", displayName: "Glow", kind: "group", valueType: "unknown", value: null, canSetValue: false }] }];
  return snapshot;
}
const ensure = [{ type: "ensure_effect", effectMatchName: "ADBE Glo2", target: { compositionId: "comp-main", layerId: "layer-title", effectPath: `${PARADE}/ADBE Glo2` } }];

test("reusing an effect on a layer warns, unless this job created the layer", () => {
  const snapshot = withGlow();
  assert.equal(effectReuseNotes(ensure, snapshot).length, 1);
  assert.equal(effectReuseNotes(ensure, snapshot, new Set(["other"])).length, 1, "another layer's id is not ownership");
  assert.deepEqual(effectReuseNotes(ensure, snapshot, new Set(["layer-title"])), []);
});
