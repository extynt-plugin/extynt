// Tests that batch size is counted as the engine counts JSON nodes and that an oversized batch is refused with a fixable error.

import assert from "node:assert/strict";
import test from "node:test";
import { MAX_WORKFLOW_JSON_NODES } from "@extynt/workflow";
import { BATCH_NODE_BUDGET, batchNodeGate, jsonNodes, type QueueHolder } from "../src/workflow-batch-nodes.js";

const starfield = (count: number) => ({ type: "create_layer", layerType: "shape", name: "Stars", shapes: Array.from({ length: count }, () => ({ paths: [{ vertices: [[0, 0], [1, 0], [1, 1], [0, 1]], inTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0], [0, 0]], closed: true }], fill: [1, 1, 1] })) });
const noQueue: QueueHolder = { state: { openQueuePlanId: null, plans: { get: () => undefined } } };

test("nodes are counted as the engine counts them, and the budget leaves room for the admission envelope", () => {
  assert.equal(jsonNodes({ a: [1, 2], b: null }), 5);
  assert.ok(BATCH_NODE_BUDGET < MAX_WORKFLOW_JSON_NODES);
});

test("a batch under the node budget is queued as before", () => {
  assert.equal(batchNodeGate(noQueue, "ae_queue_add", { operations: [starfield(10)] }), undefined);
  assert.equal(batchNodeGate(noQueue, "ae_queue_finish", {}), undefined);
});

test("an operation too heavy for any batch is refused by index while the queue is still open, naming the fix", () => {
  const refused = batchNodeGate(noQueue, "ae_queue_add", { operations: [{ type: "create_layer", name: "Bg" }, starfield(78)] });
  assert.equal(refused?.error.code, "OPERATION_TOO_HEAVY");
  assert.match(refused?.error.message ?? "", /operation 1 alone/);
  assert.match(refused?.error.message ?? "", /repeater/);
});

test("operations that fit alone but not together are refused with a split, not dropped", () => {
  const half = starfield(Math.floor(BATCH_NODE_BUDGET / jsonNodes(starfield(1).shapes[0]) / 2) + 2);
  const refused = batchNodeGate(noQueue, "ae_queue_add", { operations: [half, half] });
  assert.equal(refused?.error.code, "BATCH_FULL");
  assert.match(refused?.error.message ?? "", /two ae_queue_add calls/);
});

test("the scene compiler's shared node budget is the workflow engine's batch budget", async () => {
  const { SCENE_BATCH_NODE_BUDGET } = await import("@extynt/mcp-server");
  assert.equal(SCENE_BATCH_NODE_BUDGET, BATCH_NODE_BUDGET);
});
