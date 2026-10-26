// Proves that a plan's operations resolve the composition they target: explicit ids win, omitted ones follow the plan or the open composition, and ambiguity is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/index.js";
import { arrayAt, objectsIn, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { storedOperations, refusalOf } from "./support/json-results.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";
import { planContext, presentationOf, propose, storedPlanOf, targetField } from "./support/proposal-views.js";

const SCENE_SIZE = { width: 1920, height: 1080, durationSeconds: 6, frameRate: 30 };
const NAMED_SCENE: JsonObject = { type: "create_composition", newCompositionId: "__new__:scene", name: "Scene", ...SCENE_SIZE };
const UNNAMED_SCENE: JsonObject = { type: "create_composition", name: "Scene", ...SCENE_SIZE };
const PLANET_IN_SCENE: JsonObject = { type: "create_layer", target: { compositionId: "__new__:scene", layerId: "__new__:planet" }, layerType: "shape", name: "Planet" };
const PLANET_AMBIGUOUS: JsonObject = { type: "create_layer", target: { layerId: "__new__:planet" }, layerType: "shape", name: "Planet" };

function storedFor(summary: string, operations: ReadonlyArray<JsonObject>): ReadonlyArray<JsonObject> {
  const context = planContext();
  return storedOperations(storedPlanOf(context, propose(summary, operations, context)));
}

test("a named create_composition followed by a create_layer without a compositionId is refused as ambiguous", () => {
  const rocket: JsonObject = { ...NAMED_SCENE, name: "Rocket Launch" };
  const { code, message } = refusalOf(propose("Rocket Launch", [rocket, PLANET_AMBIGUOUS], planContext()));
  assert.equal(code, "AMBIGUOUS_COMPOSITION");
  assert.match(message, /Operation 1 \(create_layer\)/);
  assert.match(message, /"Rocket Launch"/);
  assert.match(message, /__new__:scene/);
});

test("an unnamed create_composition followed by an ambiguous create_layer is refused with __new__:comp0", () => {
  const { code, message } = refusalOf(propose("Scene", [UNNAMED_SCENE, PLANET_AMBIGUOUS], planContext()));
  assert.equal(code, "AMBIGUOUS_COMPOSITION");
  assert.match(message, /__new__:comp0/);
  assert.match(message, /comp-main/);
});

test("an unnamed create_composition then a create_layer targeted at __new__:comp0 is accepted", () => {
  const explicit: JsonObject = { ...PLANET_IN_SCENE, target: { compositionId: "__new__:comp0", layerId: "__new__:planet" } };
  const operations = storedFor("Scene", [UNNAMED_SCENE, explicit]);
  assert.equal(targetField(operations[1], "compositionId"), "__new__:comp0");
});

test("operations on a created layer inherit its composition", () => {
  const operations = storedFor("Scene setup", [
    NAMED_SCENE,
    PLANET_IN_SCENE,
    { type: "set_layer_name", target: { layerId: "__new__:planet" }, name: "Planet Updated" },
    { type: "add_marker", target: { layerId: "__new__:planet" }, time: 0, comment: "Start" },
  ]);
  assert.equal(targetField(operations[1], "compositionId"), "__new__:comp0", "create_layer targets the new composition");
  assert.equal(targetField(operations[2], "compositionId"), "__new__:comp0", "set_layer_name inherits composition from its layer");
  assert.equal(targetField(operations[3], "compositionId"), "__new__:comp0", "add_marker inherits composition from its layer");
});

test("a refused ae_queue_add leaves the earlier accepted call queued", () => {
  const context = queueContext();
  const first = callTool("ae_queue_add", { operations: [NAMED_SCENE, PLANET_IN_SCENE] }, context);
  assert.ok(first.ok, first.ok ? "" : JSON.stringify(first.error));
  const second = callTool("ae_queue_add", { operations: [{ type: "create_layer", target: { layerId: "__new__:rocket" }, layerType: "shape", name: "Rocket" }] }, context);
  assert.equal(refusalOf(second).code, "AMBIGUOUS_COMPOSITION");
  const queued = storedOperations(queuedPlan(context));
  assert.equal(queued.length, 2, "call 1 operations still queued after call 2 is refused");
  assert.deepEqual(queued.map((operation) => stringAt(operation, "type")), ["create_composition", "create_layer"]);
});

test("set_composition_settings with no compositionId in a plan that creates a composition is refused as ambiguous", () => {
  const { code, message } = refusalOf(propose("Setup", [NAMED_SCENE, { type: "set_composition_settings", target: {}, name: "Scene Updated" }], planContext()));
  assert.equal(code, "AMBIGUOUS_COMPOSITION");
  assert.match(message, /Operation 1 \(set_composition_settings\)/);
});

test("a plan without create_composition and an omitted compositionId resolves to the active composition", () => {
  const operations = storedFor("Add layer", [{ type: "create_layer", target: { layerId: "__new__:bar" }, layerType: "shape", name: "Bar" }]);
  assert.equal(targetField(operations[0], "compositionId"), "comp-main", "resolves to active composition");
});

test("plan card rows name new layers instead of 'New layer' and show the existing layer's name", () => {
  const context = planContext();
  const result = propose("Scene with elements", [
    { ...NAMED_SCENE, name: "Rocket Launch" },
    PLANET_IN_SCENE,
    { type: "set_layer_name", target: { layerId: "__new__:planet" }, name: "Planet Updated" },
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:title" }, layerType: "text", name: "Title", text: "Rocket" },
    { type: "set_layer_name", target: { compositionId: "comp-main", layerId: "layer-footage" }, name: "Plate 2" },
  ], context);
  const rows = objectsIn(arrayAt(presentationOf(result), "values"));
  assert.deepEqual(rows.map((row) => row.label), ["Create composition", "Add shape layer", "Rename layer", "Add text layer", "Rename layer"]);
  const cells = rows.map((row) => [row.target, row.before, row.after]);
  assert.deepEqual(cells[0]?.[0], "Rocket Launch");
  assert.deepEqual(cells[1]?.[0], "Planet");
  assert.deepEqual(cells[2], ["Planet", "Planet", "Planet Updated"]);
  assert.deepEqual([cells[3]?.[0], cells[3]?.[2]], ["Title", "Rocket"]);
  assert.deepEqual(cells[4], ["Plate", "Plate", "Plate 2"]);
});

test("create_composition then set_composition_settings on it in one plan is accepted", () => {
  const settings: JsonObject = { type: "set_composition_settings", target: { compositionId: "__new__:scene" }, settings: { motionBlur: true, workAreaDuration: 4 } };
  const operations = storedFor("Scene", [NAMED_SCENE, settings]);
  const created = stringAt(operations[0], "newCompositionId");
  assert.ok(created, JSON.stringify(operations[0]));
  assert.equal(targetField(operations[1], "compositionId"), created);
});
