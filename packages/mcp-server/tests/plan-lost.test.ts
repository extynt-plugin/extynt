// Proves a plan the sidecar lost is answered with its recorded code and message by every plan tool, listed as cancelled, and distinguished from a plan nobody recorded.
import test from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../src/index.js";
import type { LostPlanNote } from "../src/index.js";
import { jsonFieldsOf } from "../src/json.js";
import { refusalOf } from "./support/json-results.js";
import { planContext, succeeded } from "./support/plan-views.js";
import type { PlanContext } from "./support/plan-views.js";

const LOST: LostPlanNote = { planId: "plan-lost", code: "PLAN_EXPIRED_BY_RESTART", message: "This plan was cancelled because extynt's sidecar restarted before it was approved; nothing was changed. Propose it again.", summary: "Fade the title in", at: "2026-10-05T12:00:00.000Z", cancelled: true };

function contextWithLostPlan(): PlanContext {
  return { ...planContext(), lostPlans: { find: (planId) => (planId === LOST.planId ? LOST : undefined), cancelled: () => [LOST] } };
}

test("every plan tool answers a lost plan with the recorded code and message", () => {
  const context = contextWithLostPlan();
  for (const name of ["ae_get_plan_status", "ae_approve_plan", "ae_cancel_plan", "ae_recall_plan", "ae_undo_plan", "ae_amend_plan", "ae_plan_add", "ae_plan_complete"]) {
    const answer = callTool(name, { planId: LOST.planId, edits: [{ op: "remove", index: 0 }], operations: [] }, context);
    assert.deepEqual(refusalOf(answer), { code: LOST.code, message: LOST.message }, name);
  }
});

test("a plan nobody recorded is still PLAN_NOT_FOUND", () => {
  const answer = callTool("ae_get_plan_status", { planId: "plan-never-made" }, contextWithLostPlan());
  assert.equal(refusalOf(answer).code, "PLAN_NOT_FOUND");
});

test("ae_list_plans lists a plan lost before it was applied as cancelled, with the reason", () => {
  const listed = succeeded(callTool("ae_list_plans", {}, contextWithLostPlan()));
  assert.deepEqual(listed.data, [jsonFieldsOf({ planId: LOST.planId, status: "cancelled", summary: LOST.summary, createdAt: LOST.at, updatedAt: LOST.at, presentation: null, postcondition: null, mayHaveMutated: false, approvalExpired: false, droppedBecause: LOST.message, jobId: null, job: null, jobBatch: null })]);
});
