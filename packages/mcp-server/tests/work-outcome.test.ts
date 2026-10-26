// Proves the one work-outcome reading the panel agent and external clients share: the read-back line groups and bounds, names the field a step used, and counts undone groups from the undo receipt.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool, workOutcomeView } from "../src/index.js";
import type { StoredPlan, ToolContext } from "../src/index.js";
import { numberAt, stringAt } from "../src/json.js";
import type { JsonObject } from "@extynt/decode";
import { dataOf } from "./support/fixtures.js";
import { successOf } from "./support/protocol-views.js";

const RING: JsonObject[] = [{ type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:ring" }, layerType: "shape", name: "Ring" }];

function storedPlan(): StoredPlan {
  const context: ToolContext & { plans: Map<string, StoredPlan> } = { snapshot: representativeSnapshot, plans: new Map<string, StoredPlan>() };
  const planId = dataOf(successOf(callTool("ae_propose_plan", { summary: "Ring", operations: RING }, context))).planId;
  const record = context.plans.get(planId);
  assert.ok(record, "the proposed plan is stored");
  return record;
}

test("a failed read-back is named by its basis and field, grouped, and counted past what was itemised", () => {
  const record = storedPlan();
  record.receipt = { status: "executed", postcondition: "failed", repair: { failedCount: 12, operations: [
    ...Array.from({ length: 5 }, (_, index) => ({ index, basis: "text-document-mismatch", field: "font" })),
    { index: 5, basis: "readback-mismatch" },
  ] } };
  const work = workOutcomeView(record);
  assert.equal(numberAt(work, "failedOperations"), 12);
  assert.equal(stringAt(work, "failureBasis"), "text-document-mismatch (font) ×5; readback-mismatch; +6 more");
});

test("a failed verification step names the option it differed on when it carries no field", () => {
  const record = storedPlan();
  record.receipt = { status: "executed", postcondition: "failed", verification: { steps: [
    { verificationState: "exact", basis: "observed" },
    { verificationState: "failed", basis: "text-document-mismatch", option: "font" },
  ] } };
  assert.equal(stringAt(workOutcomeView(record), "failureBasis"), "text-document-mismatch (font)");
});

test("a passing or unreadable receipt carries no failure line", () => {
  const record = storedPlan();
  record.receipt = { status: "executed", postcondition: "passed", repair: { failedCount: 3, operations: [{ basis: "x" }] } };
  assert.equal(workOutcomeView(record).failureBasis, undefined);
  record.receipt = { status: "executed", postcondition: "failed" };
  assert.equal(workOutcomeView(record).failedOperations, undefined);
});

test("undone groups come from the undo receipt when the plan has no undo count and its status says it was undone", () => {
  const record = storedPlan();
  record.status = "undone";
  record.undoReceipt = { undone: 2.9 };
  assert.equal(numberAt(workOutcomeView(record), "undoneGroups"), 2);
  record.status = "verified";
  assert.equal(numberAt(workOutcomeView(record), "undoneGroups"), 0);
  record.undo = { groups: 3, undone: 1, stateFingerprint: null };
  assert.equal(numberAt(workOutcomeView(record), "undoneGroups"), 1);
});
