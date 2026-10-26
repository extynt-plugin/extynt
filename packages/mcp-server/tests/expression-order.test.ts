// Tests that a queue or plan seals an expression after the keyframes and layers it depends on while the queue keeps the order it was sent in.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import { stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { resultData, storedOperations } from "./support/json-results.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";
import { representativeSnapshot } from "@extynt/project-graph";

const TITLE = { compositionId: "comp-main", layerId: "layer-title" };
const SCALE = "ADBE Transform Group/ADBE Scale";
const POSITION = "ADBE Transform Group/ADBE Position";

interface Sealed {
  ok: boolean;
  text: string;
  sealed: ReadonlyArray<JsonObject>;
  queued: ReadonlyArray<JsonObject>;
}

function sealed(operations: JsonObject[]): Sealed {
  const context = queueContext();
  const added = callTool("ae_queue_add", { operations }, context);
  assert.equal(added.ok, true, JSON.stringify(added));
  const queued = storedOperations(queuedPlan(context));
  const finished = callTool("ae_queue_finish", {}, context);
  return { ok: finished.ok, text: JSON.stringify(finished), sealed: storedOperations([...context.plans.values()][0]), queued };
}

const keys = (target: JsonObject, role: string): JsonObject => ({ type: "animate_property", target, role, keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [100, 100] }] });
const types = (operations: ReadonlyArray<JsonObject>): ReadonlyArray<string | undefined> => operations.map((operation) => stringAt(operation, "type"));

test("run 15 shape: loopOut before the keyframes on the same property is sealed after them, the queue keeps its positions", () => {
  const result = sealed([
    { type: "set_expression", target: { ...TITLE, propertyPath: SCALE }, source: 'loopOut("pingpong")', enabled: true },
    keys({ ...TITLE, propertyPath: SCALE }, "transform.scale"),
  ]);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(types(result.queued), ["set_expression", "animate_property"]);
  assert.deepEqual(types(result.sealed), ["animate_property", "set_expression"]);
});

test("an expression whose source names a layer created later in the batch moves after that layer", () => {
  const result = sealed([
    { type: "set_expression", target: { ...TITLE, propertyPath: POSITION }, source: 'thisComp.layer("Anchor").transform.position', enabled: true },
    { type: "set_layer_attribute", target: { ...TITLE }, role: "shy", value: false },
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:anchor" }, layerType: "null", name: "Anchor" },
  ]);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(types(result.sealed).slice(-1), ["set_expression"]);
  assert.equal(types(result.sealed).indexOf("create_layer"), 1);
});

test("independent operations, and an expression on a different property, keep their order", () => {
  const result = sealed([
    { type: "set_expression", target: { ...TITLE, propertyPath: POSITION }, source: "wiggle(2, 10)", enabled: true },
    keys({ ...TITLE, propertyPath: SCALE }, "transform.scale"),
    { type: "set_layer_name", target: TITLE, name: "Renamed" },
  ]);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(types(result.sealed), ["set_expression", "animate_property", "set_layer_name"]);
});

test("ae_propose_plan applies the same order to a whole plan", () => {
  const context = { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() };
  const result = callTool("ae_propose_plan", { summary: "Pingpong", operations: [
    { type: "set_expression", target: { ...TITLE, propertyPath: SCALE }, source: 'loopOut("pingpong")', enabled: true },
    keys({ ...TITLE, propertyPath: SCALE }, "transform.scale"),
  ] }, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  const planId = stringAt(resultData(result), "planId");
  assert.ok(planId);
  assert.deepEqual(types(storedOperations(context.plans.get(planId))), ["animate_property", "set_expression"]);
});
