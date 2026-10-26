/** The sidecar, not the panel, judges the read taken just before an approved plan runs. */
import assert from "node:assert/strict";
import test from "node:test";
import { precheckAdmission, precheckPlanId } from "../src/apply-precheck.js";

const plan = { snapshotFingerprint: "fp-plan", selectionFingerprint: "sel-plan" };

test("a read that shows the project and selection the plan was made against is admitted", () => {
  assert.deepEqual(precheckAdmission(plan, { fingerprint: "fp-plan", selectionFingerprint: "sel-plan" }), { ok: true });
  assert.deepEqual(precheckAdmission({ snapshotFingerprint: "fp-plan" }, { fingerprint: "fp-plan", selectionFingerprint: "anything" }), { ok: true }, "a plan made without a selection binds none");
});

test("a changed project is refused as STALE_SNAPSHOT before a changed selection is mentioned", () => {
  const stale = precheckAdmission(plan, { fingerprint: "fp-now", selectionFingerprint: "sel-now" });
  assert.equal(stale.ok, false); assert.equal(!stale.ok && stale.code, "STALE_SNAPSHOT");
  assert.match(!stale.ok ? stale.text : "", /nothing was run/); assert.match(!stale.ok ? stale.text : "", /propose the plan again/);
});

test("the same project with another selection is refused as SELECTION_CHANGED, and says it read the selection", () => {
  const moved = precheckAdmission(plan, { fingerprint: "fp-plan", selectionFingerprint: "sel-now" });
  assert.equal(moved.ok, false); assert.equal(!moved.ok && moved.code, "SELECTION_CHANGED");
  assert.match(!moved.ok ? moved.text : "", /selected layers/);
});

test("a v0.2 plan of derive_layer steps binds the selection only when it says EXACT_SELECTION; any other plan always does", () => {
  const read = { fingerprint: "fp-plan", selectionFingerprint: "sel-now" };
  const derive = { ...plan, schemaVersion: "0.2" as const, operations: [{ type: "derive_layer" as const, target: { compositionId: "1", layerId: "18", snapshotFingerprint: "fp-plan", selectionFingerprint: "sel-plan" }, kind: "split" as const, newLayerId: "__new__:a", time: 3 }] };
  assert.deepEqual(precheckAdmission(derive, read), { ok: true });
  const exact = precheckAdmission({ ...derive, preconditions: [{ code: "EXACT_SELECTION", description: "unchanged" }] }, read);
  assert.equal(!exact.ok && exact.code, "SELECTION_CHANGED");
  const mixed = precheckAdmission({ ...derive, operations: [...derive.operations, { type: "set_layer_name" as const, target: { compositionId: "1", layerId: "18", snapshotFingerprint: "a", selectionFingerprint: "b" }, name: "x" }] }, read);
  assert.equal(!mixed.ok && mixed.code, "SELECTION_CHANGED");
});

test("a plan the sidecar no longer holds is not admitted", () => {
  const unknown = precheckAdmission(undefined, { fingerprint: "fp-plan", selectionFingerprint: "sel-plan" });
  assert.equal(unknown.ok, false); assert.equal(!unknown.ok && unknown.code, "PLAN_UNKNOWN");
});

test("only a snapshot post that names a plan and the precheck purpose is a precheck", () => {
  assert.equal(precheckPlanId({ url: "/v1/snapshots?purpose=precheck&planId=plan-1" }), "plan-1");
  assert.equal(precheckPlanId({ url: "/v1/snapshots?planId=plan-1" }), undefined);
  assert.equal(precheckPlanId({ url: "/v1/snapshots?purpose=verify&planId=plan-1" }), undefined);
  assert.equal(precheckPlanId({ url: "/v1/snapshots?purpose=precheck" }), undefined);
  assert.equal(precheckPlanId({ url: "/v1/snapshots?purpose=precheck&planId=" + "x".repeat(300) }), undefined);
  assert.equal(precheckPlanId({ url: undefined }), undefined);
});

function jobsOf(owners: Record<string, string>, lineage: Record<string, { planId: string; before: string }>) {
  return {
    jobIdForPlan: (planId: string) => owners[planId] ?? null,
    lineageChain: (from: string, to: string) => { const chain: string[] = []; let cursor = to; for (let hops = 0; hops < 64 && cursor !== from; hops += 1) { const link = lineage[cursor]; if (!link) return null; chain.unshift(link.planId); cursor = link.before; } return cursor === from ? chain : null; },
  };
}
const planB = { planId: "B", snapshotFingerprint: "fp0", selectionFingerprint: "sel0", schemaVersion: "0.2" as const, operations: [{ type: "set_layer_name" as const, target: { compositionId: "1", layerId: "4", snapshotFingerprint: "fp0", selectionFingerprint: "sel0" }, name: "x" }] };

test("a job plan queued beside one that changed the active comp still applies: its own plan moved the project and the selection", () => {
  const jobs = jobsOf({ A: "job-1", B: "job-1" }, { fp1: { planId: "A", before: "fp0" } });
  assert.deepEqual(precheckAdmission(planB, { fingerprint: "fp1", selectionFingerprint: "sel1" }, jobs), { ok: true });
});

test("a project change the job did not make still refuses its plan", () => {
  const jobs = jobsOf({ A: "job-1", B: "job-1" }, { fp1: { planId: "A", before: "fp0" } });
  const edited = precheckAdmission(planB, { fingerprint: "fp2-user-edit", selectionFingerprint: "sel1" }, jobs);
  assert.equal(!edited.ok && edited.code, "STALE_SNAPSHOT");
  const otherJob = precheckAdmission(planB, { fingerprint: "fp1", selectionFingerprint: "sel1" }, jobsOf({ A: "job-2", B: "job-1" }, { fp1: { planId: "A", before: "fp0" } }));
  assert.equal(!otherJob.ok && otherJob.code, "STALE_SNAPSHOT", "another plan's change is not the job's own");
});

test("a job plan ignores a moved selection unless it says EXACT_SELECTION; a plan that is not a job's keeps the guard", () => {
  const jobs = jobsOf({ B: "job-1" }, {});
  const read = { fingerprint: "fp0", selectionFingerprint: "sel-user" };
  assert.deepEqual(precheckAdmission(planB, read, jobs), { ok: true });
  const exact = precheckAdmission({ ...planB, preconditions: [{ code: "EXACT_SELECTION", description: "unchanged" }] }, read, jobs);
  assert.equal(!exact.ok && exact.code, "SELECTION_CHANGED");
  const loose = precheckAdmission(planB, read, jobsOf({}, {}));
  assert.equal(!loose.ok && loose.code, "SELECTION_CHANGED", "a user's selection-bound plan is still refused");
});

test("the never-ran refusal budget counts refusals in a row: a batch that ran resets it", async () => {
  const { neverRanIn } = await import("../src/server-workflow-seal-receipt.js");
  const refused = { lifecycle: "settled", execution: { state: "rejected_before_apply", mutation: "none", mayHaveMutated: false } };
  const ran = { lifecycle: "settled", execution: { state: "executed", mutation: "applied", mayHaveMutated: true } };
  const seen = (order: Array<{ lifecycle: string; execution: { state: string; mutation: string; mayHaveMutated: boolean } }>) => neverRanIn({ jobs: { j: { batchIds: order.map((_, i) => `b${i}`) } }, batches: Object.fromEntries(order.map((batch, i) => [`b${i}`, batch])) }, "j");
  assert.equal(seen([refused, ran, refused, ran, refused]), 1, "transient refusals hours apart do not add up");
  assert.equal(seen([ran, refused, refused, refused]), 3, "refusals in a row do");
});
