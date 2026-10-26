// Proves that a marker binds to the composition it names or the open one, and follows a composition created earlier in the same plan.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { stringAt } from "../src/json.js";
import { planContext, propose, storedPlanOf, successObject, targetField } from "./support/proposal-views.js";
import { storedOperations } from "./support/json-results.js";

test("a marker without a layerId binds to the open composition instead of inheriting a layer", () => {
  const context = planContext();
  const result = propose("Composition timeline", [{ type: "add_marker", target: {}, time: 1, comment: "Beat" }], context);
  const [marker] = storedOperations(storedPlanOf(context, result));
  assert.equal(targetField(marker, "compositionId"), representativeSnapshot.activeCompositionId);
  assert.equal(targetField(marker, "layerId"), undefined, "the marker stays composition-scoped");
});

test("a layer marker keeps its layer, and a composition marker follows a composition made earlier in the plan", () => {
  const layer = propose("Layer marker", [{ type: "add_marker", target: { compositionId: "comp-main", layerId: "layer-title" }, time: 1, comment: "Beat" }], planContext());
  assert.ok(stringAt(successObject(layer), "planId"));
  const created = propose("Scene marker", [
    { type: "create_composition", newCompositionId: "__new__:scene", name: "Scene", width: 1920, height: 1080, durationSeconds: 6, frameRate: 30 },
    { type: "add_marker", target: { compositionId: "__new__:scene" }, time: 1, comment: "Beat" },
  ], planContext());
  assert.ok(stringAt(successObject(created), "planId"));
});
