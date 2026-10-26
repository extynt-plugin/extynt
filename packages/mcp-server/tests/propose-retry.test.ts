// Proves ae_propose_plan returns the waiting plan for an identical proposal, and a new plan when the proposal changed or the first was cancelled.
import test from "node:test";
import assert from "node:assert/strict";
import { array, decodeOrThrow, object, optional, string } from "@extynt/decode";
import { callTool } from "../src/index.js";
import type { JsonObject } from "@extynt/decode";
import { authoring, dataOf } from "./support/fixtures.js";
import { planIn, succeeded } from "./support/plan-views.js";

const TITLE_LAYER: JsonObject = { type: "create_layer", target: { compositionId: "comp-main" }, layerType: "text", name: "Title", text: "Directed by" };
const waitingView = object({ otherWaitingPlans: optional(object({ plans: array(object({ planId: string() })), note: string() })) });

test("proposing the same change again returns the plan nobody has acted on instead of a second one", () => {
  const context = authoring();
  const first = succeeded(callTool("ae_propose_plan", { summary: "Add a title", operations: [TITLE_LAYER] }, context));
  const again = succeeded(callTool("ae_propose_plan", { summary: "Add a title", operations: [TITLE_LAYER] }, context));
  assert.equal(dataOf(again).planId, dataOf(first).planId);
  assert.equal(context.plans.size, 1);
});

test("a changed proposal, or one whose first plan was cancelled, is a new plan", () => {
  const context = authoring();
  const first = succeeded(callTool("ae_propose_plan", { summary: "Add a title", operations: [TITLE_LAYER] }, context));
  const other = succeeded(callTool("ae_propose_plan", { summary: "Add a title", operations: [{ ...TITLE_LAYER, name: "Credits" }] }, context));
  assert.notEqual(dataOf(other).planId, dataOf(first).planId);
  const waiting = decodeOrThrow(waitingView, other.data).otherWaitingPlans;
  assert.deepEqual(waiting?.plans.map((entry) => entry.planId), [dataOf(first).planId], "a revised proposal names the draft it may replace");
  assert.match(waiting?.note ?? "", /ae_cancel_plan/);
  planIn(context.plans, dataOf(first).planId).status = "cancelled";
  const third = succeeded(callTool("ae_propose_plan", { summary: "Add a title", operations: [TITLE_LAYER] }, context));
  assert.notEqual(dataOf(third).planId, dataOf(first).planId);
});
