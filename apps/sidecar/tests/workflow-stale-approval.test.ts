/** A job whose only pending work is a batch awaiting a panel approval nobody can still give must not hold the engine busy. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ActionPlan } from "@extynt/action-plan";
import { MockProvider } from "@extynt/llm";
import { ReadOnlySidecar } from "../src/server.js";
import { authorization, mutableSnapshot, token } from "./sidecar-fixture.js";
import { readJson, textOf } from "./http-json.js";

const at = new Date("2026-10-13T21:28:46.000Z");
const manualAuthority = {
  hostProfileId: "profile-stale",
  hostBasis: "stale approval fixture host profile",
  hostSupported: true,
  verificationBasis: "stale approval fixture verifier",
  exactVerification: true,
  targetResolved: true,
} as const;

function plan(planId: string): ActionPlan {
  return {
    schemaVersion: "0.2",
    planId,
    snapshotFingerprint: "snapshot-before",
    selectionFingerprint: "selection-1",
    summary: "Rename stale-approval fixture layer",
    requiresApproval: true,
    operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, name: "Stale" }],
  };
}

function directory(t: TestContext): string {
  const value = mkdtempSync(join(tmpdir(), "ae-workflow-stale-"));
  t.after(() => rmSync(value, { recursive: true, force: true }));
  return value;
}

function sidecarAt(root: string, extra: { chatProvider?: MockProvider } = {}): ReadOnlySidecar {
  return new ReadOnlySidecar({ port: 0, token, stateDirectory: root, discoveryPath: join(root, "native.json"), now: () => at, quietAgentLog: true, ...extra });
}

function leaveAwaitingApproval(sidecar: ReadOnlySidecar, value: ActionPlan): { jobId: string; batchId: string } {
  const coordinator = sidecar.workflowCoordinator;
  const admitted = coordinator.admitPlan(value, { jobId: "stale-job", undoGroups: 1, authority: manualAuthority });
  assert.equal(admitted.ok, true);
  coordinator.queue(value.planId);
  const job = coordinator.workflowStore.getState().jobs[coordinator.jobIdForPlan(value.planId) ?? ""];
  assert.ok(job);
  coordinator.closeProviderCycle(job.jobId, job.providerCycle + 1);
  const batch = coordinator.batchForPlan(value.planId);
  assert.ok(batch);
  return { jobId: job.jobId, batchId: batch.batchId };
}

function eventTypes(sidecar: ReadOnlySidecar, jobId: string): string[] {
  return sidecar.workflowCoordinator.workflowStore.listEvents(jobId).map((event) => event.type);
}

async function startedSidecar(t: TestContext, provider: MockProvider): Promise<{ sidecar: ReadOnlySidecar; base: string }> {
  const sidecar = sidecarAt(directory(t), { chatProvider: provider });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const snapshot = await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("stale-approval")) });
  assert.equal(snapshot.status, 201);
  return { sidecar, base };
}

function chat(base: string, requestId: string): Promise<Response> {
  return fetch(`${base}/v1/chat`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ requestId, message: "make the title bigger" }) });
}

test("a new chat message is accepted while the previous job only awaits approval of a plan nobody can still approve", async (t) => {
  const provider = new MockProvider({ answer: "Done." });
  const { sidecar, base } = await startedSidecar(t, provider);
  const value = plan("plan-awaiting");
  const { jobId, batchId } = leaveAwaitingApproval(sidecar, value);
  sidecar.plans.set(value.planId, { plan: value, status: "presented", jobId, createdAt: at.toISOString(), updatedAt: at.toISOString() });
  assert.equal(sidecar.workflowCoordinator.workflowStore.getState().activeJobId, jobId, "the evidence shape holds the engine before the message");
  assert.deepEqual(eventTypes(sidecar, jobId).slice(-3), ["batch.admitted", "batch.queued", "job.providerCycleClosed"]);

  const response = await chat(base, "stale-new-message");
  assert.equal(response.status, 200, "the user's next message must not be refused as WORKFLOW_ENGINE_BUSY");
  assert.equal(textOf(await readJson(response), "answer"), "Done.");

  const state = sidecar.workflowCoordinator.workflowStore.getState();
  assert.equal(state.activeJobId, null);
  assert.equal(state.jobs[jobId]?.status, "cancelled");
  assert.equal(state.batches[batchId]?.lifecycle, "cancelled");
  assert.ok(eventTypes(sidecar, jobId).includes("job.cancelled"), "the abandonment is a recorded event, not deleted state");
  assert.equal(sidecar.plans.get(value.planId)?.status, "cancelled", "the pending plan card is no longer approvable");
});

test("restart abandons a job left awaiting an approval that died with the process", async (t) => {
  const root = directory(t);
  const first = sidecarAt(root);
  const value = plan("plan-before-restart");
  const { jobId, batchId } = leaveAwaitingApproval(first, value);
  await first.stop();

  const restarted = sidecarAt(root);
  t.after(() => restarted.stop());
  const state = restarted.workflowCoordinator.workflowStore.getState();
  assert.equal(state.activeJobId, null, "the dead end clears itself on launch");
  assert.equal(state.jobs[jobId]?.status, "cancelled");
  assert.equal(state.batches[batchId]?.lifecycle, "cancelled");
  assert.ok(eventTypes(restarted, jobId).includes("job.cancelled"));
  assert.equal(restarted.plans.get(value.planId)?.status, "cancelled");
});

test("a batch that is executing keeps the engine busy for a new message and across restart", async (t) => {
  const root = directory(t);
  const provider = new MockProvider({ answer: "Done." });
  const first = sidecarAt(root, { chatProvider: provider });
  const address = await first.start();
  const base = `http://${address.host}:${address.port}`;
  const snapshot = await fetch(`${base}/v1/snapshots`, { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify(mutableSnapshot("stale-executing")) });
  assert.equal(snapshot.status, 201);
  const value = plan("plan-executing");
  const { jobId, batchId } = leaveAwaitingApproval(first, value);
  first.workflowCoordinator.bindApproval(value.planId, "approval-ref:stale", value.snapshotFingerprint);
  first.workflowCoordinator.beginApply(value.planId, "approval-ref:stale", value.snapshotFingerprint);
  assert.equal(first.workflowCoordinator.workflowStore.getState().batches[batchId]?.lifecycle, "executing");

  const refused = await chat(base, "stale-while-executing");
  assert.equal(refused.status, 409);
  assert.equal(textOf(await readJson(refused), "error.code"), "WORKFLOW_ENGINE_BUSY");
  assert.equal(first.workflowCoordinator.workflowStore.getState().jobs[jobId]?.status !== "cancelled", true);
  await first.stop();

  const restarted = sidecarAt(root);
  t.after(() => restarted.stop());
  const state = restarted.workflowCoordinator.workflowStore.getState();
  assert.notEqual(state.jobs[jobId]?.status, "cancelled", "an executing batch is never abandoned by reconciliation");
  assert.equal(eventTypes(restarted, jobId).includes("job.cancelled"), false);
});
