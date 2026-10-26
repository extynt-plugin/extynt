// Tests that ae_queue_add and ae_queue_fix accept a JSON string that parses to an array and name an unparseable one.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/index.js";
import type { JsonObject } from "@extynt/decode";
import { refusalOf, storedOperations } from "./support/json-results.js";
import { queueContext, queuedPlan } from "./support/queue-context.js";

const marker: JsonObject = { type: "add_marker", target: { compositionId: "comp-main", layerId: "layer-title" }, time: 1, comment: "one" };

test("operations sent as a JSON string that parses to an array are accepted as that array", () => {
  const context = queueContext();
  const result = callTool("ae_queue_add", { operations: JSON.stringify([marker]) }, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(storedOperations(queuedPlan(context)).length, 1);
});

test("operations sent as an unparseable string say a string was received, not that the array is empty", () => {
  const result = callTool("ae_queue_add", { operations: "[{\"type\": oops" }, queueContext());
  const error = refusalOf(result);
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.match(error.message, /operations must be an array of operation objects/);
  assert.match(error.message, /string was received/);
  assert.doesNotMatch(error.message, /at least one/);
});

test("edits sent as a JSON string are accepted by ae_queue_fix; an unparseable one is named", () => {
  const context = queueContext();
  callTool("ae_queue_add", { operations: [marker] }, context);
  const bad = callTool("ae_queue_fix", { edits: "nope" }, context);
  assert.match(refusalOf(bad).message, /edits must be an array.*string was received/);
});
