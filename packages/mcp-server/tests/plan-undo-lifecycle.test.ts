// Proves Undo of a plan: receipt ordering, undo groups taken one at a time or all at once, the registry-driven undo notices, and undo of agent work and of jobs.
import test from "node:test";
import assert from "node:assert/strict";
import { representativeSnapshot } from "@extynt/project-graph";
import { ACTION_PLAN_SCHEMA } from "@extynt/action-plan";
import { array, decodeOrThrow, number, object, optional, string } from "@extynt/decode";
import { callTool } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import type { JsonObject } from "@extynt/decode";
import { operationsOf } from "../src/operations.js";
import { undoNotices } from "../src/notices.js";
import { authoring, dataOf } from "./support/fixtures.js";
import { refusalOf } from "./support/json-results.js";
import { planContext, planIn, planStatusOf, preparedPlan, succeeded } from "./support/plan-views.js";
import type { PlanContext } from "./support/plan-views.js";

const APPLIED_RECEIPT: JsonObject = { status: "executed", postcondition: "passed", mayHaveMutated: true, afterFingerprint: representativeSnapshot.fingerprint };

const undoStepShape = object({ times: number(), remaining: number(), undoGroup: string() });
const agentUndoShape = object({ planId: optional(string()), times: number(), groups: number(), scope: string(), summary: optional(string()) });
const jobUndoShape = object({
  planId: string(), times: number(), batchOrder: array(string()), skipped: array(object({ planId: string(), reason: string() })),
  job: object({ remainingUndoGroups: number() }),
});

function appliedPlan(context: PlanContext, receipt: JsonObject): StoredPlan {
  const record = preparedPlan(context);
  record.status = "verified";
  record.receipt = { ...APPLIED_RECEIPT, ...receipt };
  return record;
}

function undoWith(targetReceipt: JsonObject, otherReceipt: JsonObject) {
  const context = planContext();
  const target = appliedPlan(context, targetReceipt);
  appliedPlan(context, otherReceipt);
  return callTool("ae_undo_plan", { planId: target.plan.planId }, context);
}

test("ae_undo_plan compares receipt times numerically and never treats a missing timestamp as oldest", () => {
  const earlier = undoWith({ receivedAt: "2026-09-16T10:00:00.000Z" }, { receivedAt: "Sep 15, 2026" });
  assert.ok(earlier.ok, `an earlier non-ISO receipt must not win: ${JSON.stringify(earlier)}`);
  assert.equal(planStatusOf(earlier).status, "undo_requested");
  const unknown = undoWith({}, { receivedAt: "2026-09-16T11:00:00.000Z" });
  assert.ok(unknown.ok, `a missing target timestamp must not refuse the undo: ${JSON.stringify(unknown)}`);
  assert.equal(planStatusOf(unknown).status, "undo_requested");
  const later = undoWith({ receivedAt: "2026-09-16T10:00:00.000Z" }, { receivedAt: "2026-09-16T11:00:00.000Z" });
  assert.equal(refusalOf(later).code, "UNDO_NOT_LATEST");
});

test("a plan applied in several undo groups is undone one step at a time or all at once", () => {
  const context = planContext();
  const record = appliedPlan(context, { undoGroups: 3, appliedOperations: [] });
  const planId = record.plan.planId;

  const step = decodeOrThrow(undoStepShape, succeeded(callTool("ae_undo_plan", { planId, scope: "last" }, context)).data);
  assert.equal(step.times, 1, "the last step is one undo");
  assert.equal(step.remaining, 3);
  assert.equal(step.undoGroup, `extynt — ${planId} (3/3)`, "the group named is the one on top of the stack");

  record.status = "partially_undone";
  record.undo = { groups: 3, undone: 1, stateFingerprint: representativeSnapshot.fingerprint };
  const rest = decodeOrThrow(undoStepShape, succeeded(callTool("ae_undo_plan", { planId, scope: "all" }, context)).data);
  assert.equal(rest.times, 2, "all takes back the two groups that are left, not three");
  assert.equal(rest.remaining, 2);
  assert.equal(rest.undoGroup, `extynt — ${planId} (2/3)`);
});

test("an undo is refused when the project moved on, and when every group is already undone", () => {
  const context = planContext();
  const record = appliedPlan(context, { undoGroups: 3, appliedOperations: [] });
  const planId = record.plan.planId;
  record.status = "partially_undone";
  record.undo = { groups: 3, undone: 1, stateFingerprint: "a-state-we-did-not-leave" };
  assert.equal(refusalOf(callTool("ae_undo_plan", { planId, scope: "all" }, context)).code, "UNDO_PROJECT_CHANGED");

  record.status = "undone";
  record.undo = { groups: 3, undone: 3, stateFingerprint: representativeSnapshot.fingerprint };
  assert.equal(refusalOf(callTool("ae_undo_plan", { planId, scope: "all" }, context)).code, "UNDO_NOT_APPLICABLE");
});

function noticesFor(rows: ReadonlyArray<JsonObject>) {
  return undoNotices(operationsOf(rows));
}

function noticeCodes(rows: ReadonlyArray<JsonObject>): string[] {
  return noticesFor(rows).map((notice) => `${notice.severity}:${notice.code}`);
}

test("what Undo can and cannot take back is read from the registry, not from what a plan happens to contain", () => {
  assert.deepEqual(noticeCodes([{ type: "render_composition", executeAuthorization: "RENDER_NOW" }]), ["unverified:NOT_UNDOABLE"]);
  assert.deepEqual(noticeCodes([{ type: "export_mogrt" }]), ["unverified:NOT_UNDOABLE"]);
  assert.deepEqual(noticeCodes([{ type: "apply_preset" }, { type: "ensure_effect" }]), [], "scoped Undo reverts a plain effect add, so no Undo-only note");
  assert.deepEqual(noticeCodes([{ type: "ensure_layer_style" }]), ["note:UNDO_ONLY"]);
  assert.deepEqual(noticeCodes([{ type: "import_file" }, { type: "set_footage_proxy" }, { type: "set_composition_guides" }]), ["note:REVERSIBLE_BY_OPERATION"]);
  assert.deepEqual(noticeCodes([{ type: "remove_layer", destructive: true }]), ["note:DESTRUCTIVE"]);
  for (const type of ["precompose_layers", "ensure_text_animator", "add_text_animator", "create_shape_group", "ensure_shape_fill", "ensure_shape_stroke", "add_shape_item", "ensure_effect", "add_essential_property"]) {
    assert.equal(noticeCodes([{ type }]).some((code) => /CLEANUP|NOT_UNDOABLE/.test(code)), false, `${type} is undone by one Ctrl+Z and must not be called irreversible`);
  }
  assert.deepEqual(noticeCodes([{ type: "cleanup_project" }, { type: "render_composition", executeAuthorization: "RENDER_NOW" }, { type: "remove_mask", destructive: true }]), ["unverified:NOT_UNDOABLE", "note:UNDO_ONLY", "note:DESTRUCTIVE"]);
});

test("plan notice sentences agree in number with the steps they count", () => {
  const find = (code: string, rows: ReadonlyArray<JsonObject>) => noticesFor(rows).find((notice) => notice.code === code);
  const one = find("NOT_UNDOABLE", [{ type: "export_mogrt" }]);
  assert.ok(one);
  assert.match(one.detail, /^One step writes a file or starts a render\. .*so that output stays even after/);
  assert.equal(one.title, "Nothing takes one step of this plan back.");
  const many = find("NOT_UNDOABLE", [{ type: "export_mogrt" }, { type: "export_mogrt" }]);
  assert.ok(many);
  assert.match(many.detail, /^2 steps write a file or start a render\. .*so those outputs stay even after/);
  assert.equal(many.title, "Nothing takes 2 steps of this plan back.");
  const removable = [{ type: "import_file" }, { type: "set_footage_proxy" }];
  assert.match(find("REVERSIBLE_BY_OPERATION", removable.slice(0, 1))?.title ?? "", /^One step here stays until something removes it\.$/);
  assert.match(find("REVERSIBLE_BY_OPERATION", removable)?.title ?? "", /^2 steps here stay until something removes them\.$/);
});

test("a precompose says taking it apart is two steps, and in which order", () => {
  const notices = noticesFor([{ type: "precompose_layers" }]);
  const twoStep = notices.find((notice) => notice.code === "UNPRECOMPOSE_TWO_STEPS");
  assert.ok(twoStep, `a precompose has to say how it comes apart: ${JSON.stringify(notices)}`);
  assert.equal(twoStep.severity, "note");
  assert.equal(notices.some((notice) => notice.code === "NOT_UNDOABLE"), false, "one Undo takes a precompose back whole");
  assert.deepEqual(twoStep.operationIndexes, [0]);
  assert.equal(twoStep.because, "#1 precompose_layers");
  assert.match(twoStep.title, /two steps, in this order/);
  assert.match(twoStep.detail, /Remove the precomp layer first/);
  assert.match(twoStep.action ?? "", /remove_layer .*then delete_project_item/);
  assert.match(twoStep.detail, /the layer goes with it/);
  assert.equal(noticesFor([{ type: "create_layer" }]).some((notice) => notice.code === "UNPRECOMPOSE_TWO_STEPS"), false);
});

test("undo takes back the newest work without the model ever being handed its id", () => {
  const context = authoring();
  const ring = { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:ring" }, layerType: "shape", name: "Ring" };
  const planId = dataOf(succeeded(callTool("ae_propose_plan", { summary: "Ring", operations: [ring] }, context))).planId;
  const record = planIn(context.plans, planId);
  record.status = "verified";
  record.receipt = { planId, status: "executed", postcondition: "passed", mayHaveMutated: true, receivedAt: "2026-01-01T00:00:00.000Z", afterFingerprint: representativeSnapshot.fingerprint, undoGroups: 2 };

  const undone = decodeOrThrow(agentUndoShape, succeeded(callTool("ae_undo_agent_work", { scope: "all", waitSeconds: 0 }, context)).data);
  assert.equal(undone.planId, undefined, "the model is never handed the id, even to undo");
  assert.equal(undone.times, 2, "every group that work still has");
  assert.equal(undone.groups, 2);
  assert.equal(undone.scope, "all");
  assert.equal(undone.summary, "Ring", "and it is told which work it just took back");
  assert.equal(record.status, "undo_requested");
  assert.equal(refusalOf(callTool("ae_undo_agent_work", {}, authoring())).code, "UNDO_NOT_APPLICABLE");
});

test("a plan whose undo groups held no step is never pressed for, and does not stand in front of the plan below it", () => {
  const context = planContext();
  const earlier = appliedPlan(context, { receivedAt: "2026-10-17T10:00:00.000Z", undoGroups: 2 });
  const noop = appliedPlan(context, { receivedAt: "2026-10-17T10:05:00.000Z", undoGroups: 0 });

  const refused = refusalOf(callTool("ae_undo_plan", { planId: noop.plan.planId, scope: "all" }, context));
  assert.equal(refused.code, "UNDO_NOT_APPLICABLE");
  assert.match(refused.message, /changed nothing/);
  assert.equal(noop.status, "verified", "nothing was requested");

  const undone = decodeOrThrow(agentUndoShape, succeeded(callTool("ae_undo_plan", { planId: earlier.plan.planId, scope: "all" }, context)).data);
  assert.equal(undone.times, 2);
  assert.equal(undone.groups, 2);

  earlier.status = "verified";
  const agent = decodeOrThrow(agentUndoShape, succeeded(callTool("ae_undo_agent_work", { scope: "all", waitSeconds: 0 }, context)).data);
  assert.equal(agent.times, 2);
  assert.equal(earlier.status, "undo_requested");
  assert.equal(noop.status, "verified");
});

function jobBatch(planId: string, receivedAt: string, undoGroups: number): StoredPlan {
  return {
    plan: { schemaVersion: ACTION_PLAN_SCHEMA, planId, summary: `Batch ${planId}`, snapshotFingerprint: representativeSnapshot.fingerprint, operations: [], requiresApproval: true },
    status: "verified", jobId: "job-noop", createdAt: receivedAt, updatedAt: receivedAt,
    receipt: { planId, operation: "apply_plan", status: "executed", receivedAt, mayHaveMutated: true, afterFingerprint: representativeSnapshot.fingerprint, undoGroups },
  };
}

test("a job-scoped undo skips a batch that left no undo step and says why", () => {
  const context = planContext();
  for (const record of [jobBatch("job-a", "2026-10-17T10:00:00.000Z", 1), jobBatch("job-b", "2026-10-17T10:05:00.000Z", 0)]) context.plans.set(record.plan.planId, record);
  const undone = decodeOrThrow(jobUndoShape, succeeded(callTool("ae_undo_plan", { planId: "job-b", scope: "job" }, context)).data);
  assert.deepEqual(undone.batchOrder, ["job-a"], "no Undo is pressed for the batch with no step");
  assert.equal(undone.planId, "job-a");
  assert.equal(undone.times, 1);
  assert.equal(undone.job.remainingUndoGroups, 1);
  assert.deepEqual(undone.skipped, [{ planId: "job-b", reason: "it changed nothing, so it left no undo step" }]);
});
