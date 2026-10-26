// Proves the plan tools list, prepare, approve, recall, status and cancel plans, and that a plan which never reached After Effects can be approved again.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { array, boolean, decodeOrThrow, jsonValue, nullable, object, string } from "@extynt/decode";
import { callTool, handleMcpRequest, planOperations } from "../src/index.js";
import { arrayAt, objectAt, objectsIn, stringAt, stringsIn } from "../src/json.js";
import { parsedJsonObject } from "./support/narrow.js";
import type { JsonObject } from "@extynt/decode";
import { VERIFIED_HOST, dataOf } from "./support/fixtures.js";
import { payloadOf, refusalOf, storedOperations } from "./support/json-results.js";
import { planContext, planIn, planRowsOf, planStatusOf, preparedPlan, recallPageOf, succeeded } from "./support/plan-views.js";
import type { PlanContext } from "./support/plan-views.js";

const NOT_RUN_RECEIPT: JsonObject = { status: "rejected", postcondition: "not_run", mayHaveMutated: false, mutationState: "not-applied", error: { code: "HOST_READ_FAILED", message: "After Effects did not answer the read before applying." } };
const PARTIAL_RECEIPT: JsonObject = { status: "rejected", postcondition: "partial_mutation_possible", mayHaveMutated: true, mutationState: "partial-applied" };

function beatTarget(): { compositionId: string; layerId: string } {
  const composition = representativeSnapshot.compositions[0];
  const layer = composition?.layers[0];
  assert.ok(composition && layer, "the fixture has a composition with a layer");
  return { compositionId: composition.id, layerId: layer.id };
}

function beatOperations(count: number): JsonObject[] {
  const target = beatTarget();
  return Array.from({ length: count }, (_, index) => ({ type: "add_marker", target, time: index * 0.1, comment: `m${index}` }));
}

function commentsOf(operations: ReadonlyArray<{ comment?: string | undefined }>): Array<string | undefined> {
  return operations.map((operation) => operation.comment);
}

test("ae_list_plans surfaces a plan created by an external caller so the panel can discover it without knowing the planId in advance", () => {
  const context = planContext();
  const proposed = succeeded(callTool("ae_propose_plan", {
    summary: "Variant 1: fade in",
    operations: [{ type: "animate_property", target: { compositionId: "comp-main", layerId: "layer-title", propertyPath: "ADBE Transform Group/ADBE Opacity" }, role: "transform.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }],
  }, context));
  const row = planRowsOf(callTool("ae_list_plans", {}, context)).find((candidate) => candidate.planId === dataOf(proposed).planId);
  assert.ok(row);
  assert.equal(row.status, "prepared");
  assert.equal(row.summary, "Variant 1: fade in");
});

function failedPlanFixtures(context: PlanContext): { refusedId: string; partialId: string; freshId: string } {
  const refused = preparedPlan(context);
  refused.status = "failed";
  refused.receipt = { planId: refused.plan.planId, ...NOT_RUN_RECEIPT };
  const partial = preparedPlan(context);
  partial.status = "failed";
  partial.receipt = { planId: partial.plan.planId, ...PARTIAL_RECEIPT };
  return { refusedId: refused.plan.planId, partialId: partial.plan.planId, freshId: preparedPlan(context).plan.planId };
}

test("ae_list_plans says whether a failed plan ever reached After Effects, so a refusal that ran nothing can be retried", () => {
  const context = planContext();
  const ids = failedPlanFixtures(context);
  const rows = planRowsOf(callTool("ae_list_plans", {}, context));
  const rowOf = (planId: string) => rows.find((row) => row.planId === planId);
  assert.equal(rowOf(ids.refusedId)?.status, "failed");
  assert.equal(rowOf(ids.refusedId)?.postcondition, "not_run");
  assert.equal(rowOf(ids.refusedId)?.mayHaveMutated, false, "a plan refused before its first host write reports that nothing ran");
  assert.equal(rowOf(ids.partialId)?.postcondition, "partial_mutation_possible");
  assert.equal(rowOf(ids.partialId)?.mayHaveMutated, true);
  assert.equal(rowOf(ids.freshId)?.postcondition, null);
  assert.equal(rowOf(ids.freshId)?.mayHaveMutated, false);
});

function approveAfter(receipt: JsonObject) {
  const context = { ...planContext(), ...VERIFIED_HOST };
  const record = preparedPlan(context);
  record.status = "failed";
  record.receipt = receipt;
  return callTool("ae_approve_plan", { planId: record.plan.planId }, context);
}

test("a plan refused before its first host write can be approved again; one that may have written cannot", () => {
  const retried = approveAfter({ planId: "refused", ...NOT_RUN_RECEIPT });
  assert.ok(retried.ok, `a refusal that ran nothing must stay approvable: ${JSON.stringify(retried)}`);
  assert.equal(planStatusOf(retried).status, "approved");
  const blocked = approveAfter({ planId: "partial", ...PARTIAL_RECEIPT });
  assert.equal(blocked.ok, false, "a partial apply must not be approvable a second time");
  assert.equal(refusalOf(blocked).code, "PLAN_MAY_HAVE_MUTATED");
});

const preparedView = object({
  planId: string(),
  plan: object({ schemaVersion: string(), operations: array(jsonValue) }),
  presentation: object({ target: object({ layerName: string() }), effect: object({ action: string() }), motion: object({ property: string() }) }),
  approvalCapability: nullable(object({ oneTime: boolean() })),
});

test("a prepared change carries a v0.2 plan, a presentation of its target, effect and motion, and a one-time approval capability", () => {
  const context = { ...planContext(), ...VERIFIED_HOST };
  succeeded(callTool("ae_get_fresh_edit_context", {}, context));
  const view = decodeOrThrow(preparedView, succeeded(callTool("ae_prepare_change", {}, context)).data);
  assert.equal(view.plan.schemaVersion, "0.2");
  assert.equal(view.plan.operations.length, 3);
  assert.equal(view.presentation.target.layerName, "TITLE — Summer");
  assert.equal(view.presentation.effect.action, "Use observed");
  assert.equal(view.presentation.motion.property, "Position");
  assert.equal(view.approvalCapability?.oneTime, true);
});

test("typed edit tools present, approve, cancel, and report receipts without generic mutation tools", () => {
  const context = { ...planContext(), ...VERIFIED_HOST };
  const planId = preparedPlan(context).plan.planId;
  succeeded(callTool("ae_present_plan", { planId }, context));
  succeeded(callTool("ae_approve_plan", { planId }, context));
  assert.equal(planStatusOf(callTool("ae_get_plan_status", { planId }, context)).status, "approved");
  assert.equal(refusalOf(callTool("ae_get_receipt", { planId }, context)).code, "RECEIPT_NOT_FOUND");
  assert.equal(callTool("ae_apply_jsx", {}, context).ok, false);
  succeeded(callTool("ae_cancel_plan", { planId }, context));
});

test("plan status does not report an executed-but-unverified plan as applied", () => {
  const context = planContext();
  const record = preparedPlan(context);
  const planId = record.plan.planId;
  record.status = "applied_unverified";
  record.receipt = { planId, status: "executed", postcondition: "failed", verification: { targetFound: false, steps: [{ operation: "create_composition", observed: false }] } };

  const status = planStatusOf(callTool("ae_get_plan_status", { planId }, context));
  assert.notEqual(status.status, "applied");
  assert.equal(status.status, "applied_unverified");
  assert.equal(status.verified, false);
  assert.equal(status.postcondition, "failed");
  assert.ok(status.warning, "an unverified apply must carry an explicit warning");
  assert.equal(refusalOf(callTool("ae_approve_plan", { planId }, context)).code, "PLAN_ALREADY_APPLIED");
  assert.equal(refusalOf(callTool("ae_cancel_plan", { planId }, context)).code, "PLAN_ALREADY_APPLIED");
});

function appliedBeatsPlan(context: PlanContext) {
  const proposed = succeeded(callTool("ae_propose_plan", { summary: "Three beats", operations: beatOperations(3) }, context));
  const planId = dataOf(proposed).planId;
  const record = planIn(context.plans, planId);
  record.status = "applied";
  record.receipt = { planId, status: "executed", postcondition: "passed", mayHaveMutated: true };
  return { planId, record };
}

test("ae_recall_plan returns the operations of a plan that has already been applied", () => {
  const context = planContext();
  const { planId, record } = appliedBeatsPlan(context);
  assert.equal(planStatusOf(callTool("ae_get_plan_status", { planId }, context)).operations, undefined, "planStatus does not become an echo for applied plans");

  const recalled = succeeded(callTool("ae_recall_plan", { planId }, context));
  const page = recallPageOf(recalled);
  assert.equal(page.planId, planId);
  assert.equal(page.status, "applied");
  assert.equal(page.editable, false, "a plan that has run cannot be edited in place");
  assert.equal(page.summary, "Three beats");
  assert.equal(page.operationCount, 3);
  assert.equal(page.fromIndex, 0);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(commentsOf(page.operations), ["m0", "m1", "m2"]);
  assert.deepEqual(arrayAt(payloadOf(recalled), "operations"), planOperations(record));
});

test("ae_recall_plan still recalls a plan in every settled status, and ae_amend_plan refuses to edit it", () => {
  const context = planContext();
  const { planId, record } = appliedBeatsPlan(context);
  for (const status of ["applied", "verified", "failed", "undone"] as const) {
    record.status = status;
    const page = recallPageOf(callTool("ae_recall_plan", { planId }, context));
    assert.equal(page.status, status, `${status} must still recall`);
    assert.equal(page.editable, false);
    assert.deepEqual(commentsOf(page.operations), ["m0", "m1", "m2"]);
  }
  record.status = "applied";
  const amended = callTool("ae_amend_plan", { planId, edits: [{ op: "remove", index: 0 }] }, context);
  assert.equal(refusalOf(amended).code, "PLAN_NOT_EDITABLE");
});

test("ae_recall_plan reports an unknown planId exactly as the other plan tools do", () => {
  const context = planContext();
  const recalled = refusalOf(callTool("ae_recall_plan", { planId: "plan-that-never-existed" }, context));
  const status = refusalOf(callTool("ae_get_plan_status", { planId: "plan-that-never-existed" }, context));
  assert.equal(recalled.code, "PLAN_NOT_FOUND");
  assert.deepEqual(recalled, status, "one lookup, one error shape");
  assert.equal(refusalOf(callTool("ae_recall_plan", {}, context)).code, "INVALID_ARGUMENT");
});

test("an operation index taken from ae_recall_plan is the index ae_amend_plan edits", () => {
  const context = planContext();
  const target = beatTarget();
  const planId = dataOf(succeeded(callTool("ae_propose_plan", { summary: "Three beats", operations: beatOperations(3) }, context))).planId;
  const recalled = recallPageOf(callTool("ae_recall_plan", { planId }, context));
  assert.equal(recalled.editable, true);

  const index = recalled.operations.findIndex((operation) => operation.comment === "m1");
  assert.equal(index, 1, "the recalled list is in plan order");
  const replacement = { type: "add_marker", target, time: 0.1, comment: "m1-amended" };
  succeeded(callTool("ae_amend_plan", { planId, edits: [{ op: "replace", index, operation: replacement }] }, context));
  const stored = storedOperations(planIn(context.plans, planId));
  assert.equal(stored[index]?.comment, "m1-amended", "the index from the recall addressed the operation it named");
  assert.deepEqual(stored.map((operation) => operation.comment), ["m0", "m1-amended", "m2"], "and nothing else moved");
});

test("ae_recall_plan pages a long plan deterministically, keeping every index the plan's own", () => {
  const context = planContext();
  const planId = dataOf(succeeded(callTool("ae_propose_plan", { summary: "Five beats", operations: beatOperations(5) }, context))).planId;
  const page = recallPageOf(callTool("ae_recall_plan", { planId, limit: 2 }, context));
  assert.equal(page.operationCount, 5);
  assert.equal(page.fromIndex, 0);
  assert.deepEqual(commentsOf(page.operations), ["m0", "m1"]);
  assert.equal(page.nextCursor, 2, "the continuation is the next operation index");
  assert.match(page.next ?? "", /cursor 2/, "and it says so, rather than leaving the model to guess");
  assert.ok(page.nextCursor !== null, "a continuation cursor is a number, not the end of the list");
  const secondPage = recallPageOf(callTool("ae_recall_plan", { planId, cursor: page.nextCursor, limit: 2 }, context));
  assert.equal(secondPage.fromIndex, 2, "an index on a later page is still the plan's index");
  assert.deepEqual(commentsOf(secondPage.operations), ["m2", "m3"]);
  assert.equal(secondPage.nextCursor, 4);
  assert.ok(secondPage.nextCursor !== null, "a continuation cursor is a number, not the end of the list");
  const thirdPage = recallPageOf(callTool("ae_recall_plan", { planId, cursor: secondPage.nextCursor, limit: 2 }, context));
  assert.deepEqual(commentsOf(thirdPage.operations), ["m4"]);
  assert.equal(thirdPage.nextCursor, null, "the last page says so rather than leaving the caller to guess");
  assert.equal(refusalOf(callTool("ae_recall_plan", { planId, cursor: 9 }, context)).code, "INVALID_ARGUMENT");
});

test("ae_present_plan keeps the operation labels in the agent-facing view", () => {
  const context = planContext();
  const planId = preparedPlan(context).plan.planId;
  const response = handleMcpRequest({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ae_present_plan", arguments: { planId } } }, context);
  const text = stringAt(objectsIn(arrayAt(objectAt(response, "result"), "content"))[0], "text");
  assert.ok(text, "the response carries its view as text");
  const view = parsedJsonObject(text);
  assert.deepEqual(stringsIn(arrayAt(objectAt(view, "data"), "ops")), ["Blur amount · TITLE — Summer: 12 → 24", "Position · TITLE — Summer: 960, 540 → 1000, 540"]);
});

test("an inspect with no compositionId reads the active composition, like its siblings", () => {
  const context = { snapshot: representativeSnapshot };
  assert.equal(stringAt(payloadOf(callTool("ae_inspect_composition", {}, context)), "id"), "comp-main");
  assert.equal(stringAt(payloadOf(callTool("ae_inspect_layer", { layerId: "layer-title" }, context)), "id"), "layer-title");
  succeeded(callTool("ae_inspect_composition", { compositionId: "" }, context));
});
