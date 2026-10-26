/*
 * The fixture project behind the fake plugin, end to end against a real sidecar: a sealed batch is applied through the native lane,
 * receipted and verified by the sidecar, and the workflow engine settles its bounded cycles only on verified receipts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isolatedProfileDirectory } from "../src/host-profile.js";
import { startSidecar } from "../src/sidecar.js";
import type { SidecarHandle } from "../src/sidecar-client.js";
import { workflowOf } from "../src/fake-plugin-wait.js";
import type { WorkflowProjection } from "../src/workflow-projection.js";
import { dataObjectEnvelope, latestWorkEnvelope, pipelineEnvelope, readEnvelope, receiptEnvelope, rowsEnvelope, workflowStatusEnvelope } from "../src/envelopes.js";
import { jsonObject, jsonOptionalString, jsonRows } from "../src/wire-reads.js";
import { startRig } from "./fake-plugin-rig.js";
import { parseWire, required } from "./test-support.js";
import type { WireObject, WireValue } from "../src/wire-types.js";

async function continuePauseOffered(sidecar: SidecarHandle): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${sidecar.port}/v1/workflow/status`, { headers: { Authorization: `Bearer ${sidecar.token}` } });
  assert.equal(response.status, 200);
  return readEnvelope(workflowStatusEnvelope, parseWire(await response.text()), "the workflow status body").pause !== null;
}

async function blockedWorkflow(sidecar: SidecarHandle, jobId: string): Promise<WorkflowProjection> {
  const deadline = Date.now() + 8_000;
  let projection = await workflowOf(sidecar);
  while (projection.jobs.find((job) => job.jobId === jobId)?.status !== "blocked" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    projection = await workflowOf(sidecar);
  }
  return projection;
}

async function completedWorkflow(sidecar: SidecarHandle, jobId: string): Promise<WorkflowProjection> {
  const deadline = Date.now() + 3_000;
  let projection = await workflowOf(sidecar);
  while (projection.jobs.find((job) => job.jobId === jobId)?.status !== "completed" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    projection = await workflowOf(sidecar);
  }
  assert.equal(projection.jobs.find((job) => job.jobId === jobId)?.status, "completed", JSON.stringify(projection));
  return projection;
}

function assertExactVerification(verification: WireObject): void {
  assert.equal(verification.targetFound, true);
  const steps = jsonRows(verification.steps, "the verification steps");
  assert.ok(steps.length > 0 && steps.every((step) => step.verificationState === "exact"), JSON.stringify(steps));
}

async function verifiedReceipt(sidecar: SidecarHandle, planId: string): Promise<WireObject> {
  const receipt = readEnvelope(receiptEnvelope, await sidecar.callTool("ae_get_receipt", { planId }), "the retained verified receipt").data.receipt;
  assert.equal(receipt.postcondition, "passed");
  assertExactVerification(jsonObject(receipt.verification, "the verification"));
  return receipt;
}

test("a sealed batch is applied, receipted, and visible to the next inspection", async (t) => {
  const rig = await startRig("apply", { host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "chat-fake-plugin", message: "rename to Hero" });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  await rig.settle();

  assert.ok(host.batches.length >= 1, `expected an applied batch, got ${JSON.stringify(host.batches)}`);
  const batch = required(host.batches[0]);
  assert.equal(batch.operations, 1);
  assert.equal(batch.applied, 1, `the batch was refused: ${JSON.stringify(batch.refused)}`);
  assert.deepEqual(batch.refused, []);
  assert.equal(batch.mutated, true);

  const plans = await sidecar.callTool("ae_list_plans", {});
  assert.match(JSON.stringify(plans), /"postcondition":"passed"/, "the receipt must settle the plan, not leave it approved");
  assert.ok(readEnvelope(rowsEnvelope, plans, "the ae_list_plans envelope").data.some((row) => row.planId === batch.planId), "the applied batch is a stored plan");

  const receipt = readEnvelope(receiptEnvelope, await sidecar.callTool("ae_get_receipt", { planId: batch.planId }), "the ae_get_receipt envelope").data.receipt;
  assert.equal(receipt.status, "executed");
  assert.equal(receipt.postcondition, "passed");
  assertExactVerification(jsonObject(receipt.verification, "the receipt verification"));
  assert.equal(receipt.mutationState, "applied", `the host reports the project changed, got ${String(receipt.mutationState)}`);

  const status = await sidecar.callTool("ae_status", {});
  const latest = readEnvelope(latestWorkEnvelope, status, "the ae_status envelope").data.latestWork;
  assert.equal(latest.undoGroups, 1, `the receipt must carry the batch's own group count, got ${JSON.stringify(latest)}`);
  assert.equal(latest.applied, true);
  assert.equal(latest.verified, true);

  await rig.read();
  const inspected = await sidecar.callTool("ae_inspect_layer", { compositionId: "comp-main", layerId: "layer-title" });
  const inspectedData = readEnvelope(dataObjectEnvelope, inspected, "the ae_inspect_layer envelope").data;
  assert.equal(inspectedData.name, "Hero", `the re-read snapshot must carry the applied rename, got ${JSON.stringify(inspectedData).slice(0, 300)}`);
});

test("workflow-v1 runs two fresh model cycles only after verified receipts", async (t) => {
  const rig = await startRig("two-cycles", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 3 }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "workflow-two-cycles", message: "rename to Hero" });
  await rig.settle();

  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.outcome, "planned", JSON.stringify(response.body).slice(0, 500));
  assert.equal((response.body.plans ?? []).length, 2, "one explicit request produced two bounded model batches");
  assert.equal(response.body.failure, undefined);

  const firstPlanId = response.body.plans?.[0]?.planId;
  assert.ok(firstPlanId, "the verified batch has a receipt id");
  const verifiedReceipt = readEnvelope(receiptEnvelope, await sidecar.callTool("ae_get_receipt", { planId: firstPlanId }), "the verified receipt").data.receipt;
  assert.equal(verifiedReceipt.postcondition, "passed");
  const verification = jsonObject(verifiedReceipt.verification, "the verified receipt verification");
  assertExactVerification(verification);
  assert.equal("hostVersion" in verification, false, "fixture read-back must not imply a real AE version claim");

  assert.equal(host.batches.length, 2, "the host applied each sealed batch exactly once");
  assert.ok(host.batches.every((batch) => batch.applied === batch.operations));

  const projection = await rig.workflow();
  assert.equal(projection.jobs.length, 1);
  assert.equal(projection.jobs[0]?.status, "completed");
  assert.equal(projection.batches.length, 2);
  assert.ok(projection.batches.every((batch) => batch.lifecycle === "settled" && batch.execution === "executed" && batch.verification === "verified"));
  assert.deepEqual(projection.batches[1]?.dependencies, [projection.batches[0]?.batchId]);
  assert.equal(projection.stages.length, 2, "the two verified batches settle two sidecar-owned stages");
  assert.deepEqual(projection.stages.map((stage) => stage.status), ["completed", "completed"]);
  assert.deepEqual(projection.batches.map((batch) => batch.stageId), projection.stages.map((stage) => stage.stageId));
  assert.deepEqual(projection.divergences, []);
  assert.equal(projection.continuation, null);
});

async function queuedForHost(handle: { callTool(name: string, args?: WireObject): Promise<WireObject> }): Promise<WireValue | undefined> {
  return readEnvelope(pipelineEnvelope, await handle.callTool("ae_status", {}), "the ae_status envelope").data.pipeline.queued;
}

test("workflow-v1 replays a completed durable ledger without redispatching settled work", async (t) => {
  const first = await startRig("durable-replay", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 3, preserveHome: true }, host: { receiptMode: "verified" } });
  t.after(() => first.stop());
  const response = await first.sidecar.chat({ requestId: "workflow-durable-replay", message: "rename to Hero" });
  await first.settle();
  assert.equal(response.body.outcome, "planned", JSON.stringify(response.body).slice(0, 400));
  assert.equal(first.host.batches.length, 2);
  const before = await first.workflow();
  assert.equal(before.resumeSupported, true);
  await first.stop();

  const restarted = await startSidecar({ kind: "mock" }, { workflowMaxCycles: 3, isolatedHome: first.sidecar.isolatedHome });
  t.after(() => restarted.stop());
  const after = await workflowOf(restarted);
  assert.equal(after.resumeSupported, true);
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.stages, before.stages);
  assert.deepEqual(after.batches, before.batches);
  assert.equal(after.activeJobId, null);
  assert.equal(after.activeDispatchLease, null);

  assert.equal(await queuedForHost(restarted), 0, "replayed settled batches must not be offered to the host again");
});

test("workflow-v1 blocks a provider failure after a sealed cycle without retrying the host batch", async (t) => {
  const rig = await startRig("provider-failure", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 3, workflowProviderFailureAfterSeal: true }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "workflow-provider-failure", message: "rename to Hero" });
  await rig.settle();

  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(response.body.outcome, "failed");
  assert.equal(jsonObject(response.body.failure, "the chat failure").code, "PROVIDER_ERROR");
  assert.equal(host.batches.length, 1, "a provider failure after seal must not retry or duplicate the settled host batch");
  const projection = await rig.workflow();
  assert.equal(projection.jobs[0]?.status, "blocked");
  assert.equal(projection.jobs[0]?.providerCycle, 2);
  assert.deepEqual(projection.batches, [{ ...projection.batches[0], lifecycle: "settled", verification: "verified" }]);
  assert.equal(projection.providerFailures[0]?.code, "PROVIDER_ERROR");
  assert.equal(projection.providerFailures[0]?.afterSeal, true);
  assert.equal(projection.activeJobId, null);
  assert.equal(projection.activeDispatchLease, null);
  const retained = await verifiedReceipt(sidecar, required(host.batches[0]).planId);

  const nextResponse = await sidecar.chat({ requestId: "workflow-after-provider-failure", message: "rename to Hero again" });
  await rig.settle();
  assert.equal(nextResponse.status, 200);
  assert.equal(host.batches.length, 2, "the unrelated job can start after a provider-only blocker without replaying the prior host batch");
  const afterProjection = await rig.workflow();
  assert.equal(afterProjection.jobs.length, 2);
  assert.equal(afterProjection.batches.length, 2);
  assert.deepEqual(afterProjection.batches[0], projection.batches[0], "the old verified batch retains its evidence and identity");
  assert.deepEqual(await verifiedReceipt(sidecar, required(host.batches[0]).planId), retained);
  assert.notEqual(required(host.batches[1]).planId, required(host.batches[0]).planId, "only a fresh unrelated batch was dispatched");
});

test("workflow-v1 continues across one-cycle authoring windows until reducer-owned completion", async (t) => {
  const rig = await startRig("cycle-window", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 1 }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "workflow-cycle-window", message: "rename to Hero" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.outcome, "planned");
  assert.equal(response.body.failure, undefined, "one authoring window is a continuation boundary, not a terminal provider failure");
  assert.equal((response.body.plans ?? []).length, 1);
  const initial = await workflowOf(sidecar);
  const jobId = required(initial.jobs[0]).jobId;
  const projection = await completedWorkflow(sidecar, jobId);
  await rig.settle();

  assert.equal(projection.jobs.length, 1, "all windows retain the same workflow identity");
  assert.equal(projection.jobs[0]?.providerCycle, 2, "two bounded authoring cycles; the sidecar closes the finished turn with its own receipt-backed completion, so no third model cycle runs");
  assert.equal(host.batches.length, 2);
  assert.equal(new Set(host.batches.map((batch) => batch.planId)).size, 2, "each sealed batch is applied once");
  assert.equal(projection.batches.length, 2);
  assert.ok(projection.batches.every((batch) => batch.lifecycle === "settled" && batch.verification === "verified"));
  assert.deepEqual(projection.providerFailures, []);
  assert.equal(projection.activeJobId, null);
  assert.equal(projection.activeDispatchLease, null);
  assert.equal(projection.continuation, null);
  const retained = await verifiedReceipt(sidecar, required(host.batches[0]).planId);

  const nextResponse = await sidecar.chat({ requestId: "workflow-after-cycle-window", message: "rename to Hero again" });
  assert.equal(nextResponse.status, 200);
  const nextInitial = await workflowOf(sidecar);
  const nextJob = required(nextInitial.jobs.find((job) => job.jobId !== jobId));
  const after = await completedWorkflow(sidecar, nextJob.jobId);
  await rig.settle();
  assert.equal(host.batches.length, 4);
  assert.equal(new Set(host.batches.map((batch) => batch.planId)).size, 4);
  assert.equal(after.jobs.length, 2);
  assert.equal(after.batches.length, 4);
  assert.deepEqual(after.batches.slice(0, 2), projection.batches);
  assert.deepEqual(await verifiedReceipt(sidecar, required(host.batches[0]).planId), retained);
});

test("a settled provider-blocked workflow restarts without changing its durable history or redispatching", async (t) => {
  const first = await startRig("provider-blocked-restart", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 3, workflowProviderFailureAfterSeal: true, preserveHome: true }, host: { receiptMode: "verified" } });
  t.after(() => first.stop());
  const response = await first.sidecar.chat({ requestId: "provider-blocked-restart", message: "rename to Hero" });
  await first.settle();
  assert.equal(response.body.outcome, "failed");
  assert.equal(first.host.batches.length, 1);
  const before = await workflowOf(first.sidecar);
  const retained = await verifiedReceipt(first.sidecar, required(first.host.batches[0]).planId);
  const ledger = join(isolatedProfileDirectory(first.sidecar.isolatedHome), "workflow-store.json");
  const bytes = readFileSync(ledger);
  const envelope = jsonObject(parseWire(bytes.toString("utf8")), "durable workflow history");
  const storedReceipts = jsonRows(envelope.events, "durable workflow events").filter((event) => event.type === "batch.receipt");
  assert.equal(storedReceipts.length, 1);
  const storedReceipt = jsonObject(storedReceipts[0]?.receipt, "durable verified receipt");
  assert.ok(jsonOptionalString(storedReceipt.receiptId), "the reducer retains a normalized receipt identity even when the host supplies none");
  assert.equal(storedReceipt.execution, retained.status);
  assert.equal(storedReceipt.verification, "verified");
  await first.stop();
  const restarted = await startSidecar({ kind: "mock" }, { workflowMaxCycles: 3, isolatedHome: first.sidecar.isolatedHome });
  t.after(() => restarted.stop());
  assert.deepEqual(readFileSync(ledger), bytes, "construction must not rewrite blocked historical evidence");
  const after = await workflowOf(restarted);
  assert.deepEqual(after.jobs, before.jobs);
  assert.deepEqual(after.batches, before.batches);
  assert.deepEqual(after.providerFailures, before.providerFailures);
  assert.equal(after.activeJobId, null);
  assert.equal(after.activeDispatchLease, null);
  assert.equal(after.batches[0]?.verification, "verified", "restart preserves verified durable evidence while the legacy per-process plan cache is empty");
  assert.equal(await queuedForHost(restarted), 0, "nothing replayed is queued for the host");
  assert.deepEqual(readFileSync(ledger), bytes, "inspection cannot append workflow history");
});

test("workflow-v1 returns a question answer without demanding a typed batch", async (t) => {
  const rig = await startRig("no-batch", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 3 }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "workflow-no-batch", message: "summarize the selected project" });
  await rig.settle();

  assert.equal(response.body.outcome, "answered", JSON.stringify(response.body).slice(0, 400));
  assert.equal(host.batches.length, 0, "a prose-only model stop must not create or dispatch an empty host batch");
  const projection = await rig.workflow();
  assert.equal(projection.jobs[0]?.status, "cancelled", "an empty provisional job releases its lane without recording a false provider failure");
  assert.equal(projection.jobs[0]?.providerCycle, 1);
  assert.deepEqual(projection.batches, []);
  assert.deepEqual(projection.providerFailures, []);

  const nextResponse = await sidecar.chat({ requestId: "workflow-after-no-batch", message: "rename to Hero" });
  await rig.settle();
  assert.equal(nextResponse.body.outcome, "planned", JSON.stringify(nextResponse.body).slice(0, 400));
  assert.equal(host.batches.length, 2);
  const afterProjection = await rig.workflow();
  assert.equal(afterProjection.jobs.length, 2);
  assert.equal(afterProjection.jobs[0]?.status, "cancelled");
  assert.equal(afterProjection.jobs[1]?.status, "completed");
  assert.equal(afterProjection.activeJobId, null);
});

test("workflow-v1 pauses a job that keeps landing work at its go-ahead ceiling, and a new user message starts fresh work", async (t) => {
  const rig = await startRig("cycle-budget", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 1, workflowCycleCeiling: 4, workflowNeverCompletes: true }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "workflow-cycle-budget", message: "rename to Hero" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const jobId = required((await workflowOf(sidecar)).jobs[0]).jobId;
  const rawStatus = (): Promise<WorkflowProjection> => workflowOf(sidecar);
  const status = await blockedWorkflow(sidecar, jobId);
  const job = status.jobs.find((candidate) => candidate.jobId === jobId);
  assert.equal(job?.status, "blocked", JSON.stringify(status));
  assert.equal(job?.blocker, "workflow:cycle-limit");
  assert.equal(job?.providerCycle, 4, "the job runs exactly its four-cycle go-ahead ceiling before it pauses");
  assert.equal(status.activeJobId, null, "the chat lane is released");
  const failure = status.providerFailures.find((candidate) => candidate.code === "WORKFLOW_CYCLE_LIMIT");
  assert.match(failure?.message ?? "", /Reply 'continue' to keep going/);

  await new Promise((resolve) => setTimeout(resolve, 500));
  const settled = await workflowOf(sidecar);
  assert.equal(settled.batches.length, 4);
  assert.equal(host.batches.length, 4);
  assert.equal(settled.jobs.find((candidate) => candidate.jobId === jobId)?.providerCycle, 4);

  assert.equal((await rawStatus()).jobs.find((candidate) => candidate.jobId === jobId)?.status, "blocked");

  const next = await sidecar.chat({ requestId: "workflow-cycle-budget-continue", message: "rename to Hero again" });
  assert.equal(next.status, 200, `a blocked job must not hold the chat lane: ${JSON.stringify(next.body)}`);
  assert.equal((await rawStatus()).jobs.some((candidate) => candidate.jobId !== jobId), true, "the user's message starts a new workflow job");
});

test("workflow-v1 resumes the same paused job when the user replies continue, with a fresh go-ahead budget", async (t) => {
  const rig = await startRig("cycle-continue", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 1, workflowCycleCeiling: 4, workflowNeverCompletes: true }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar } = rig;
  assert.equal((await sidecar.chat({ requestId: "workflow-cycle-resume", message: "rename to Hero" })).status, 200);
  const jobId = required((await workflowOf(sidecar)).jobs[0]).jobId;
  const rawStatus = (): Promise<WorkflowProjection> => workflowOf(sidecar);
  const untilBlockedAt = async (providerCycle: number): Promise<WorkflowProjection["jobs"][number] | undefined> => {
    const deadline = Date.now() + 10_000;
    const found = async (): Promise<WorkflowProjection["jobs"][number] | undefined> => {
      const job = (await rawStatus()).jobs.find((candidate) => candidate.jobId === jobId);
      const reached = job?.status === "blocked" && job.blocker === "workflow:cycle-limit" && job.providerCycle === providerCycle;
      return reached && await continuePauseOffered(sidecar) ? job : undefined;
    };
    let job = await found();
    while (!job && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      job = await found();
    }
    return job;
  };
  assert.equal((await untilBlockedAt(4))?.providerCycle, 4, "the first request pauses at its go-ahead ceiling");

  const resumed = await sidecar.chat({ requestId: "workflow-cycle-resume-continue", message: "continue" });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const after = await untilBlockedAt(8);
  assert.equal(after?.providerCycle, 8, "continue grants the same job another ceiling, no more");
  const jobs = (await rawStatus()).jobs;
  assert.equal(jobs.length, 1, "the user's continue resumes the limit-blocked job rather than opening a new one");
  assert.equal(jobs[0]?.jobId, jobId);
  assert.equal((await workflowOf(sidecar)).batches.length, 8, "four windows before the limit and four after");

  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await rawStatus()).jobs.find((candidate) => candidate.jobId === jobId)?.providerCycle, 8, "the budget ends the resumed run again until the user asks once more");
});

test("workflow-v1 resumes the same job when continue is typed the moment the job turns blocked, before the run has settled", async (t) => {
  const rig = await startRig("cycle-continue-gap", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 1, workflowCycleCeiling: 4, workflowNeverCompletes: true }, host: { receiptMode: "verified" } });
  t.after(() => rig.stop());
  const { sidecar } = rig;
  assert.equal((await sidecar.chat({ requestId: "workflow-gap-first", message: "rename to Hero" })).status, 200);
  const jobId = required((await workflowOf(sidecar)).jobs[0]).jobId;
  const deadline = Date.now() + 10_000;
  const blocked = async (): Promise<boolean> => {
    const job = (await workflowOf(sidecar)).jobs.find((candidate) => candidate.jobId === jobId);
    return job?.status === "blocked" && job.blocker === "workflow:cycle-limit" && job.providerCycle === 4;
  };
  while (!(await blocked()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await blocked(), true, "the job reached the automatic cycle limit");
  const resumed = await sidecar.chat({ requestId: "workflow-gap-continue", message: "continue" });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  const jobs = (await workflowOf(sidecar)).jobs;
  assert.equal(jobs.length, 1, "the continue resumed the limit-blocked job rather than opening a new one");
  assert.equal(jobs[0]?.jobId, jobId);
});
