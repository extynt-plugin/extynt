/** What the sidecar is doing, as the panel sees it: a job whatever request started it, held plans, MCP calls, and Stop. */
import assert from "node:assert/strict";
import test from "node:test";
import { activityFor, activityViewOf } from "../src/server-activity.js";
import type { ReadOnlySidecar } from "../src/server.js";
import { fieldOf, readJson, textOf } from "./http-json.js";
import type { WorkflowBatch } from "@extynt/workflow";
import { WORKFLOW_OWNER, type WorkflowHandoffContract } from "../src/workflow-orchestration.js";
import { authorization, batchFixture, storedPlanFixture } from "./sidecar-fixture.js";
import { openSse, raw, startUiSidecar } from "./ui-fixture.js";

const heldPlan = (planId: string) => storedPlanFixture(planId, "prepared");

function setHeldStatus(sidecar: ReadOnlySidecar, status: "applying" | "prepared"): void {
  const plan = sidecar.plans.get("plan-held");
  assert.ok(plan);
  plan.status = status;
}

const waitsOf = (sidecar: ReadOnlySidecar) => activityViewOf(sidecar).jobs[0]?.waits ?? [];

function resumedJob(sidecar: ReadOnlySidecar, state: "running" | "waiting_receipt" = "running"): string {
  const jobId = sidecar.workflowCoordinator.openJob("req-1", "Build the title card", { requestId: "req-1", autoApply: true });
  sidecar.workflowRuns.set(jobId, { jobId, requestId: "req-1", goalSummary: "Build the title card", autoApply: true, controller: new AbortController(), state, pendingBatchId: null, nextCycle: 3, continuation: null });
  sidecar.chatProgress.set("req-1", { requestId: "req-1", step: 41, maxSteps: 60, phase: "tool", label: "Reading the layers", notes: [], at: new Date().toISOString() });
  return jobId;
}

test("a job still running after its request ended is active, with its origin", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const jobId = resumedJob(sidecar);
  activityFor(sidecar).via.set(jobId, "self-continue");
  const [job] = activityViewOf(sidecar).jobs;
  assert.deepEqual([job?.jobId, job?.status, job?.via, job?.requestOpen, job?.step, job?.activity], [jobId, "working", "self-continue", false, 41, "Reading the layers"]);
  const client = await openSse(port);
  t.after(() => client.close());
  const frame = await client.waitFor((entry) => entry.event === "activity");
  assert.equal(textOf(frame.data, "jobs.0.via"), "self-continue");
  const boot = await readJson(await fetch(`http://127.0.0.1:${port}/v1/ui/bootstrap`, { headers: authorization }));
  assert.equal(textOf(boot, "activity.jobs.0.jobId"), jobId);
});

test("a plan held for Apply shows the job as waiting for it", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const jobId = resumedJob(sidecar, "waiting_receipt");
  sidecar.plans.set("plan-held", heldPlan("plan-held"));
  sidecar.workflowCoordinator.jobIdForPlan = (planId: string) => (planId === "plan-held" ? jobId : null);
  const [job] = activityViewOf(sidecar).jobs;
  assert.deepEqual([job?.status, job?.activity, job?.plans], ["waiting-apply", "waiting for your Apply", ["plan-held"]]);
  setHeldStatus(sidecar, "applying");
  assert.equal(activityViewOf(sidecar).jobs[0]?.activity, "applying plan");
});

test("an MCP tool call is listed as it runs and with its outcome, without secrets", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const client = await openSse(port);
  t.after(() => client.close());
  const reply = await fetch(`http://127.0.0.1:${port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json", "x-ae-client": "agent", "x-ae-client-version": "9.9.9" }, body: JSON.stringify({ name: "ae_get_plan_status", arguments: { planId: "plan-7", apiKey: "sk-secret" } }) });
  assert.equal(reply.status >= 400, true);
  const frame = await client.waitFor((entry) => entry.event === "mcp" && fieldOf(entry.data, "calls.0.state") !== "running");
  assert.deepEqual([textOf(frame.data, "calls.0.tool"), textOf(frame.data, "calls.0.client"), textOf(frame.data, "calls.0.state")], ["ae_get_plan_status", "9.9.9", "error"]);
  assert.deepEqual(fieldOf(frame.data, "calls.0.planIds"), ["plan-7"]);
  assert.equal(JSON.stringify(frame.data).includes("sk-secret"), false);
  assert.equal(activityFor(sidecar).calls.length, 1);
});

test("a call from the panel itself is not an MCP call", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  await fetch(`http://127.0.0.1:${port}/v1/mcp/tools/call`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ name: "ae_status", arguments: {} }) });
  assert.equal(activityFor(sidecar).calls.length, 0);
});

test("Stop cancels the job, wherever its request is", async (t) => {
  const { sidecar, port } = await startUiSidecar(t);
  const jobId = resumedJob(sidecar);
  const stopped = await raw(port, { method: "POST", path: `/v1/ui/jobs/${jobId}/stop`, authorized: true, headers: { host: `127.0.0.1:${port}` } });
  assert.equal(stopped.status, 200, stopped.text);
  assert.equal(sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId]?.status, "cancelled");
  assert.equal(sidecar.workflowRuns.get(jobId)?.state, "terminal");
  assert.deepEqual(activityViewOf(sidecar).jobs, []);
  const again = await raw(port, { method: "POST", path: `/v1/ui/jobs/${jobId}/stop`, authorized: true });
  assert.equal(again.status, 200, "a second Stop answers clearly instead of 404");
  assert.match(again.text, /already-finished/);
});

function withBatches(sidecar: ReadOnlySidecar, batches: Record<string, WorkflowBatch>): void {
  const store = sidecar.workflowCoordinator.workflowStore;
  const real = store.getState.bind(store);
  Object.defineProperty(store, "getState", { value: () => { const state = real(); return { ...state, batches: { ...state.batches, ...batches } }; } });
}
const verified = batchFixture("settled");

const viewOf = (sidecar: ReadOnlySidecar) => { const [job] = activityViewOf(sidecar).jobs; assert.ok(job, "the job is listed"); return job; };
const checklistOf = (sidecar: ReadOnlySidecar) => { const list = viewOf(sidecar).checklist; assert.ok(list, "the job carries a checklist"); return list; };
const stamps = (list: ReturnType<typeof checklistOf>): Array<string | undefined> => list.items.map((item) => item.verifiedAt);

test("the job carries when it started and a checklist whose items are stamped once, when they verify", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const jobId = resumedJob(sidecar);
  assert.equal(viewOf(sidecar).checklist, null, "no checklist yet");
  assert.equal(viewOf(sidecar).startedAt, sidecar.workflowCoordinator.workflowStore.getState().jobs[jobId]?.createdAt);
  sidecar.workflowSidecarActions.set(jobId, { lines: [], unlooked: { batches: 0, lackVisual: false }, checklist: { items: [{ id: "bar-01", title: "Bars" }, { id: "bar-02", title: "More bars" }, { id: "title-01", title: "Title" }], batchItems: { b1: ["bar-01"], b2: ["bar-02"] }, attempts: {}, unbuilt: {} } });
  const before = checklistOf(sidecar);
  assert.deepEqual(before.items.map((item) => item.status), ["open", "open", "open"]);
  assert.deepEqual(before.phases, [{ name: "bar", verified: 0, total: 2 }, { name: "title", verified: 0, total: 1 }]);
  assert.equal(before.current, "bar-01");
  withBatches(sidecar, { b1: verified });
  const first = checklistOf(sidecar);
  assert.deepEqual([first.items[0]?.status, typeof stamps(first)[0]], ["verified", "string"]);
  assert.equal(stamps(first)[1], undefined);
  assert.equal(first.current, "bar-02");
  assert.deepEqual(first.phases[0], { name: "bar", verified: 1, total: 2 });
  const stamp = stamps(first)[0];
  withBatches(sidecar, { b2: verified });
  const second = stamps(checklistOf(sidecar));
  assert.equal(second[0], stamp, "an item's stamp is set once");
  assert.equal(typeof second[1], "string");
  assert.equal(sidecar.workflowSidecarActions.get(jobId)?.checklist?.verifiedAt?.["bar-01"], stamp, "kept on the checklist, so a restart keeps it");
});

test("the time a job spends waiting for Apply is recorded as an interval", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const jobId = resumedJob(sidecar, "waiting_receipt");
  assert.deepEqual(waitsOf(sidecar), []);
  sidecar.plans.set("plan-held", heldPlan("plan-held"));
  sidecar.workflowCoordinator.jobIdForPlan = (planId: string) => (planId === "plan-held" ? jobId : null);
  const open = waitsOf(sidecar);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.to, null, "still waiting");
  assert.equal(waitsOf(sidecar).length, 1, "reading again does not open a second interval");
  setHeldStatus(sidecar, "applying");
  const closed = waitsOf(sidecar);
  assert.deepEqual([closed.length, typeof closed[0]?.to], [1, "string"]);
  setHeldStatus(sidecar, "prepared");
  assert.equal(waitsOf(sidecar).length, 2, "a second hold is a second interval");
});

test("a specialist the orchestrator consulted is listed with its role and state, without its text", async (t) => {
  const { sidecar } = await startUiSidecar(t);
  const jobId = resumedJob(sidecar);
  const base = { turn: 1, text: "SECRET STREAM", reasoning: "SECRET REASONING" };
  const handoff: WorkflowHandoffContract = { owner: WORKFLOW_OWNER, sceneLayerManifest: [], masksAndZOrder: [], motionContinuity: [], requirementChecklist: [], verificationFramesAndEvidence: [], executionStages: [], requiredEvidenceKinds: [], submissionPolicy: "orchestrator-only" };
  sidecar.workflowOrchestrations.set(jobId, { owner: WORKFLOW_OWNER, mode: "delegated", specialists: [], unavailable: [], handoff, activity: [
    { ...base, role: "visual-scene", status: "running", updatedAt: "2026-10-01T10:00:20.000Z", startedAt: "2026-10-01T10:00:00.000Z" },
    { ...base, role: "motion", status: "completed", updatedAt: "2026-10-01T10:00:09.000Z", startedAt: "2026-10-01T10:00:00.000Z" },
  ] });
  const [job] = activityViewOf(sidecar).jobs;
  assert.deepEqual(job?.specialists, [
    { role: "visual-scene", state: "running", startedAt: "2026-10-01T10:00:00.000Z", elapsedMs: null, label: "Visual scene" },
    { role: "motion", state: "done", startedAt: "2026-10-01T10:00:00.000Z", elapsedMs: 9000, label: "Motion" },
  ]);
  assert.equal(JSON.stringify(job).includes("SECRET"), false);
});
