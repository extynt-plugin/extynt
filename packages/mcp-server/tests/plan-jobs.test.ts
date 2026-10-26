// Proves job identity across plan batches: ids are named never inferred, the status line counts honestly, and a job-scoped undo goes newest-first and refuses out of order.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTION_PLAN_SCHEMA } from "@extynt/action-plan";
import { array, decodeOrThrow, number, object, string } from "@extynt/decode";
import { representativeSnapshot } from "@extynt/project-graph";
import { callTool } from "../src/index.js";
import type { StoredPlan } from "../src/index.js";
import type { JsonObject } from "@extynt/decode";
import { authoring, dataOf, jobShape } from "./support/fixtures.js";
import { refusalOf } from "./support/json-results.js";
import { planContext, planIn, succeeded } from "./support/plan-views.js";
import type { PlanContext } from "./support/plan-views.js";

interface BatchOptions { status?: StoredPlan["status"]; createdAt: string; before?: string; after?: string; mutated?: boolean; groups?: number; undone?: number }

const jobRowShape = object({ planId: string(), jobId: string(), jobBatch: number(), job: jobShape });
const jobUndoShape = object({
  planId: string(), scope: string(), times: number(), batchOrder: array(string()), batches: number(), note: string(),
  skipped: array(object({ planId: string(), reason: string() })),
  jobUndo: object({ jobId: string(), order: array(object({ planId: string(), expectedFingerprint: string() })) }),
});

function batchReceipt(planId: string, options: BatchOptions, status: string): JsonObject {
  return {
    planId, operation: "apply_plan", status: status === "failed" ? "rejected" : "executed", receivedAt: options.createdAt, mayHaveMutated: options.mutated === true,
    afterFingerprint: options.after ?? null, beforeFingerprint: options.before ?? null, ...(options.groups ? { undoGroups: options.groups } : {}),
  };
}

function batchRecord(planId: string, jobId: string, options: BatchOptions): StoredPlan {
  const status = options.status ?? "prepared";
  return {
    plan: { schemaVersion: ACTION_PLAN_SCHEMA, planId, summary: `Batch ${planId}`, snapshotFingerprint: options.before ?? "fp-0", operations: [], requiresApproval: true },
    status,
    jobId,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    ...(status === "prepared" ? {} : { receipt: batchReceipt(planId, options, status) }),
    ...(options.undone ? { undo: { groups: options.groups ?? 1, undone: options.undone, stateFingerprint: null } } : {}),
  };
}

function holding(...records: StoredPlan[]): PlanContext {
  const context = planContext();
  for (const record of records) context.plans.set(record.plan.planId, record);
  return context;
}

function applied(planId: string, jobId: string, options: BatchOptions): StoredPlan {
  return batchRecord(planId, jobId, { status: "verified", mutated: true, ...options });
}

function atFingerprint(context: PlanContext, fingerprint: string): PlanContext {
  return { ...context, snapshot: { ...representativeSnapshot, fingerprint } };
}

const createdJobView = object({ planId: string(), jobId: string(), job: jobShape });

test("a job id is named, never inferred: omit it to start a job, pass it back to continue one", () => {
  const context = authoring();
  const first = decodeOrThrow(createdJobView, succeeded(callTool("ae_plan_create", { summary: "Countdown leader" }, context)).data);
  assert.match(first.jobId, /^job-/, "a create with no jobId starts a job with an id the sidecar minted");
  assert.equal(first.job.batches, 1, "and the plan is that job's first batch");
  assert.equal(first.job.applied, 0);
  assert.match(first.job.line, /^Job job-/, "the status line names the job");
  assert.match(first.job.line, /1 batch/, "and counts its batches");

  const second = decodeOrThrow(createdJobView, succeeded(callTool("ae_plan_create", { summary: "Countdown leader, numbers", jobId: first.jobId }, context)).data);
  assert.equal(second.jobId, first.jobId, "the batch joins the job it named");
  assert.equal(second.job.batches, 2, "and the job now has two batches");
  assert.notEqual(second.planId, first.planId, "each batch is still its own plan, with its own approval and undo group");

  const third = decodeOrThrow(createdJobView, succeeded(callTool("ae_plan_create", { summary: "Countdown leader, numbers" }, context)).data);
  assert.notEqual(third.jobId, first.jobId, "a create with no jobId never inherits one from the summary or the store");
  assert.equal(third.job.batches, 1, "the new job stands alone");

  const unknown = callTool("ae_plan_create", { summary: "Continuation of a job I made up", jobId: "job-0000000000-invented" }, context);
  assert.equal(refusalOf(unknown).code, "JOB_NOT_FOUND");
});

test("a job's batches share one identity, carry a batch ordinal, and are counted by the status line", () => {
  const context = authoring();
  const created = decodeOrThrow(createdJobView, succeeded(callTool("ae_plan_create", { summary: "Countdown leader" }, context)).data);
  const second = decodeOrThrow(createdJobView, succeeded(callTool("ae_plan_create", { summary: "Countdown leader, numbers", jobId: created.jobId }, context)).data);
  for (const [planId, layerId] of [[created.planId, "__new__:counter"], [second.planId, "__new__:numbers"]] as const) {
    const layer = { type: "create_layer", target: { compositionId: "comp-main", layerId }, layerType: "text", name: "Counter", text: "3" };
    const added = succeeded(callTool("ae_plan_add", { planId, operations: [layer] }, context));
    assert.equal(dataOf(added).jobId, created.jobId);
    const sealed = succeeded(callTool("ae_plan_complete", { planId }, context));
    assert.equal(dataOf(sealed).jobId, created.jobId, "sealing keeps the job identity");
  }
  const rows = decodeOrThrow(array(jobRowShape), succeeded(callTool("ae_list_plans", {}, context)).data);
  const mine = rows.filter((row) => row.jobId === created.jobId);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((row) => row.jobBatch).sort(), [1, 2], "each row says which batch of the job it is");
  assert.equal(mine[0]?.job.batches, 2, "and each row carries the same status line");
  assert.equal(mine[0]?.job.line, mine[1]?.job.line, "two rows of one job cannot disagree about it");
  assert.deepEqual(mine[0]?.job, mine[1]?.job, "the whole rollup is the same for every row of the job");
});

test("the job status line counts applied, failed and not applied, and never invents a total", () => {
  const jobId = "job-fixture";
  const context = holding(
    applied("plan-a", jobId, { createdAt: "2026-09-11T10:00:00.000Z", before: "fp-0", after: "fp-1", groups: 2 }),
    batchRecord("plan-b", jobId, { status: "failed", createdAt: "2026-09-11T10:05:00.000Z", before: "fp-1", after: "fp-2", mutated: true }),
    batchRecord("plan-c", jobId, { createdAt: "2026-09-11T10:10:00.000Z" }),
  );
  const rows = decodeOrThrow(array(jobRowShape), succeeded(callTool("ae_list_plans", {}, context)).data);
  const row = rows.find((entry) => entry.planId === "plan-a");
  assert.ok(row);
  assert.equal(row.job.applied, 1, "a verified batch is one the host applied");
  assert.equal(row.job.failed, 1, "a rejected receipt is a failed batch");
  assert.equal(row.job.notApplied, 1, "a batch with no receipt never applied");
  assert.equal(row.job.batches, 3);
  assert.equal(row.jobBatch, 1, "the rows are numbered in creation order");
  assert.deepEqual(row.job.toApply, ["plan-c"], "what remains to apply is named, oldest first");
  assert.deepEqual(row.job.toUndo, ["plan-a"], "what remains to undo is named, newest applied first");
  assert.equal(row.job.remainingUndoGroups, 2, "the outstanding undo groups are the host's own count, not an estimate");
  assert.equal(row.job.undoOrderBasis, "apply-time");
  assert.match(row.job.line, /3 batches/);
  assert.match(row.job.line, /1 applied, 1 failed, 1 not applied/);
  assert.match(row.job.line, /Next to apply: plan-c/);
  assert.equal(/of \d+ batch/.test(row.job.line), false, "a total the sidecar cannot know must not appear in the line");
});

test("undo scope \"job\" orders batches newest-applied-first and never attempts one that never applied", () => {
  const jobId = "job-countdown";
  const context = holding(
    applied("plan-1", jobId, { createdAt: "2026-09-11T10:00:00.000Z", before: "fp-0", after: "fp-1" }),
    batchRecord("plan-2", jobId, { status: "failed", createdAt: "2026-09-11T10:05:00.000Z" }),
    applied("plan-3", jobId, { createdAt: "2026-09-11T10:10:00.000Z", before: "fp-1", after: "fp-2" }),
  );
  const undone = decodeOrThrow(jobUndoShape, succeeded(callTool("ae_undo_plan", { planId: "plan-3", scope: "job" }, atFingerprint(context, "fp-2"))).data);
  assert.equal(undone.scope, "job");
  assert.equal(undone.planId, "plan-3", "the newest applied batch is the one that goes first");
  assert.deepEqual(undone.batchOrder, ["plan-3", "plan-1"], "earlier batches come back later");
  assert.equal(undone.batches, 2);
  assert.equal(undone.times, 1, "this command presses Undo for the head batch only");
  assert.equal(planIn(context.plans, "plan-3").status, "undo_requested");
  assert.equal(planIn(context.plans, "plan-1").status, "verified", "the batch behind it is not requested yet");
  assert.equal(planIn(context.plans, "plan-2").status, "failed", "and the batch that never applied is left exactly as it was");
  assert.deepEqual(undone.skipped, [{ planId: "plan-2", reason: "the host did not execute it" }]);
  assert.match(undone.note, /skipped/);
  assert.deepEqual(undone.jobUndo.order.map((entry) => entry.planId), ["plan-3", "plan-1"]);
  assert.equal(undone.jobUndo.order[0]?.expectedFingerprint, "fp-2", "the head's guard is the project it left behind");
  assert.equal(undone.jobUndo.order[1]?.expectedFingerprint, "fp-1", "and the batch underneath it expects the state its own apply left");
});

test("undo scope \"job\" refuses to skip past a newer batch of another job", () => {
  const context = holding(
    applied("plan-a", "job-x", { createdAt: "2026-09-11T10:00:00.000Z", before: "fp-0", after: "fp-1" }),
    applied("plan-b", "job-x", { createdAt: "2026-09-11T10:05:00.000Z", before: "fp-1", after: "fp-2" }),
    applied("plan-out", "job-other", { createdAt: "2026-09-11T10:09:00.000Z", before: "fp-2", after: "fp-3" }),
  );
  const refused = callTool("ae_undo_plan", { planId: "plan-b", scope: "job" }, atFingerprint(context, "fp-2"));
  assert.equal(refusalOf(refused).code, "UNDO_NOT_LATEST");
  assert.equal(planIn(context.plans, "plan-b").status, "verified", "a refusal changes nothing");
});

test("undo scope \"job\" refuses a job whose batches another job's batch straddles, and one already undone", () => {
  const interleaved = holding(
    applied("plan-a", "job-x", { createdAt: "2026-09-11T10:00:00.000Z", before: "fp-0", after: "fp-1" }),
    applied("plan-mid", "job-other", { createdAt: "2026-09-11T10:02:00.000Z", before: "fp-1", after: "fp-2" }),
    applied("plan-b", "job-x", { createdAt: "2026-09-11T10:05:00.000Z", before: "fp-2", after: "fp-3" }),
  );
  const straddled = callTool("ae_undo_plan", { planId: "plan-b", scope: "job" }, atFingerprint(interleaved, "fp-3"));
  assert.equal(refusalOf(straddled).code, "UNDO_NOT_CONTIGUOUS");

  const finished = holding(batchRecord("plan-a", "job-done", { status: "undone", createdAt: "2026-09-11T10:00:00.000Z", before: "fp-0", after: "fp-1", mutated: true }));
  const nothing = refusalOf(callTool("ae_undo_plan", { planId: "plan-a", scope: "job" }, finished));
  assert.equal(nothing.code, "UNDO_NOT_APPLICABLE");
  assert.match(nothing.message, /already been undone/);
});
