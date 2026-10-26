// Tests that batch closure analysis records creator-to-consumer edges and its budget.

import assert from "node:assert/strict";
import test from "node:test";
import type { ActionPlanV2Operation } from "@extynt/action-plan";
import { analyzeWorkflowBatch, WORKFLOW_BATCH_BUDGET } from "../src/index.js";

const target = { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snap-1", selectionFingerprint: "sel-1" };

function rename(name: string): ActionPlanV2Operation {
  return { type: "set_layer_name", target, name };
}

function createLayer(id = "title"): ActionPlanV2Operation {
  return { type: "create_layer", target: { ...target, layerId: `__new__:${id}` }, layerType: "text", name: "Title", text: "Title" };
}

function renameCreated(): ActionPlanV2Operation {
  return { type: "set_layer_name", target: { ...target, layerId: "__new__:title" }, name: "Renamed title" };
}

function duplicateLayer(): ActionPlanV2Operation {
  return Object.assign({}, { type: "duplicate_layer" as const, target: { ...target }, newLayerId: "__new__:duplicate" }, { name: "Duplicate" });
}

test("batch closure records creator-to-consumer edges without changing operation order", () => {
  const result = analyzeWorkflowBatch([createLayer(), renameCreated()]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dependencies, [{ operation: 1, dependsOn: 0, placeholder: "__new__:title" }]);
  assert.equal(result.mutationUnits, 3, "creating plus ensuring work has deterministic weighted cost");
});

test("batch closure recognizes root-level duplicate-layer producers", () => {
  const result = analyzeWorkflowBatch([duplicateLayer(), { type: "set_layer_name", target: { ...target, layerId: "__new__:duplicate" }, name: "Renamed duplicate" }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dependencies, [{ operation: 1, dependsOn: 0, placeholder: "__new__:duplicate" }]);
});

test("placeholder-shaped user content is not interpreted as an identifier dependency", () => {
  const text: ActionPlanV2Operation = {
    type: "set_text_document",
    target,
    text: "Show __new__:title literally",
  };
  const result = analyzeWorkflowBatch([text]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dependencies, []);
});

test("batch closure refuses a consumer before its creator", () => {
  const result = analyzeWorkflowBatch([renameCreated(), createLayer()]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DEPENDENCY_ORDER");
  assert.equal(result.index, 0);
  assert.equal(result.placeholder, "__new__:title");
});

test("batch closure refuses unresolved cross-batch placeholders", () => {
  const unresolved: ActionPlanV2Operation = { type: "set_layer_name", target: { ...target, layerId: "__new__:from-earlier-batch" }, name: "Renamed title" };
  const result = analyzeWorkflowBatch([unresolved]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DEPENDENCY_UNRESOLVED");
  assert.match(result.message, /rebound to a verified host id/);
});

test("batch closure refuses malformed placeholders in producer and consumer id fields", () => {
  const malformedProducer = createLayer("bad name");
  const producer = analyzeWorkflowBatch([malformedProducer]);
  assert.equal(producer.ok, false);
  if (!producer.ok) {
    assert.equal(producer.code, "PLACEHOLDER_INVALID");
    assert.equal(producer.index, 0);
  }

  const malformedConsumer: ActionPlanV2Operation = { type: "set_layer_name", target: { ...target, layerId: "__new__:bad name" }, name: "Never reaches host" };
  const consumer = analyzeWorkflowBatch([malformedConsumer]);
  assert.equal(consumer.ok, false);
  if (!consumer.ok) {
    assert.equal(consumer.code, "PLACEHOLDER_INVALID");
    assert.match(consumer.message, /target\.layerId/);
  }
});

test("batch closure refuses duplicate producers instead of choosing one", () => {
  const result = analyzeWorkflowBatch([createLayer(), createLayer()]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DEPENDENCY_UNRESOLVED");
  assert.match(result.message, /produced more than once/);
});

test("batch closure enforces explicit operation, mutation, and host-time budgets", () => {
  const operationBound = analyzeWorkflowBatch(Array.from({ length: 3 }, () => rename("x")), { ...WORKFLOW_BATCH_BUDGET, maxOperations: 2 });
  assert.equal(operationBound.ok, false);
  if (!operationBound.ok) assert.equal(operationBound.code, "OPERATION_BOUND");

  const mutationBound = analyzeWorkflowBatch([createLayer("title-a"), createLayer("title-b")], { ...WORKFLOW_BATCH_BUDGET, maxMutationUnits: 3 });
  assert.equal(mutationBound.ok, false);
  if (!mutationBound.ok) assert.equal(mutationBound.code, "MUTATION_BUDGET");

  const animated: ActionPlanV2Operation = { type: "animate_property", target: { ...target, propertyPath: "ADBE Transform Group/ADBE Position" }, role: "transform.position", keyframes: Array.from({ length: 3 }, (_, time) => ({ time, value: [time, time] })) };
  const hostTimeBound = analyzeWorkflowBatch([animated], { ...WORKFLOW_BATCH_BUDGET, maxHostTimeUnits: 5 });
  assert.equal(hostTimeBound.ok, false);
  if (!hostTimeBound.ok) assert.equal(hostTimeBound.code, "HOST_TIME_BUDGET");
});

test("custom closure budgets cannot widen the hard operation ceiling", () => {
  const result = analyzeWorkflowBatch(Array.from({ length: 257 }, () => rename("bounded")), { maxOperations: Number.MAX_SAFE_INTEGER, maxMutationUnits: Number.MAX_SAFE_INTEGER, maxHostTimeUnits: Number.MAX_SAFE_INTEGER });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "OPERATION_BOUND");
});
