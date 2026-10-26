// Tests that a queue whose plan was sealed, approved, applied or cancelled reports that, clears its pointer and opens a fresh batch on the next add.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/index.js";
import { stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { payloadOf, refusalOf, resultData, storedOperations } from "./support/json-results.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";

let tick = 0;
const marker = (comment: string): JsonObject => ({ type: "add_marker", target: { compositionId: "comp-main", layerId: "layer-title" }, time: ++tick, comment });

test("ae_queue_fix leaves the open queue a draft with no approval capability, so only the seal presents it", () => {
  const context = queueContext();
  assert.equal(callTool("ae_queue_add", { operations: [marker("one"), marker("two")] }, context).ok, true);
  const planId = queuedPlan(context).plan.planId;
  const fixed = callTool("ae_queue_fix", { edits: [{ op: "replace", index: 1, operation: marker("fixed") }] }, context);
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  const record = queuedPlan(context);
  assert.equal(record.status, "draft");
  assert.equal(record.approvalCapability, undefined);
  assert.equal(context.queue.planId, planId);
  const sealed = callTool("ae_queue_finish", {}, context);
  assert.equal(sealed.ok, true, JSON.stringify(sealed));
  assert.equal(context.queue.planId, null);
});

test("ae_queue_finish with nothing open is a no-op success, and the work already applied stands", () => {
  const context = queueContext();
  const finished = payloadOf(callTool("ae_queue_finish", {}, context));
  assert.equal(finished.sealed, false);
  assert.equal(finished.queued, 0);
  assert.match(stringAt(finished, "next") ?? "", /Any change already applied stands/);
});

const CLOSED_STATUSES = ["approved", "applied", "cancelled"] as const;

function assertClosedQueueClears(status: (typeof CLOSED_STATUSES)[number]): void {
  const context = queueContext();
  callTool("ae_queue_add", { operations: [marker("one")] }, context);
  const planId = queuedPlan(context).plan.planId;
  queuedPlan(context).status = status;
  const finished = payloadOf(callTool("ae_queue_finish", {}, context));
  assert.equal(finished.sealed, false);
  assert.match(stringAt(finished, "next") ?? "", new RegExp(`plan ${planId}`));
  assert.match(stringAt(finished, "next") ?? "", /next ae_queue_add opens a new batch/);
  assert.equal(context.queue.planId, null);
  assert.equal(payloadOf(callTool("ae_queue_finish", {}, context)).sealed, false);
  assert.equal(callTool("ae_queue_add", { operations: [marker("two")] }, context).ok, true);
  assert.notEqual(context.queue.planId, planId);
  assert.equal(storedOperations(queuedPlan(context)).length, 1);
}

test("a queue whose plan was approved and applied answers with what happened, clears the pointer, and the next add opens a fresh batch", () => {
  for (const status of CLOSED_STATUSES) assertClosedQueueClears(status);
});

test("ae_queue_fix and ae_queue_add on a closed batch say so and clear it", () => {
  const context = queueContext();
  callTool("ae_queue_add", { operations: [marker("one")] }, context);
  const planId = queuedPlan(context).plan.planId;
  queuedPlan(context).status = "applied";
  const fixed = callTool("ae_queue_fix", { edits: [{ op: "remove", index: 0 }] }, context);
  assert.match(refusalOf(fixed).message, /already sealed and applied \(plan /);
  assert.equal(context.queue.planId, null);
  context.queue.planId = planId;
  const added = callTool("ae_queue_add", { operations: [marker("two")] }, context);
  assert.equal(added.ok, true);
  assert.match(stringAt(resultData(added), "closedBatch") ?? "", /already sealed and applied/);
  assert.match(stringAt(resultData(added), "next") ?? "", /^Your earlier batch/);
});
