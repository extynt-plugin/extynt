// Tests that the workflow store survives a sidecar restart: queued, executing and settled batches, observations, provider failures and corrupt journals.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ActionPlan } from "@extynt/action-plan";
import { createPersistentWorkflowStore, WORKFLOW_SCHEMA_VERSION } from "@extynt/workflow";
import { ReadOnlySidecar } from "../src/server.js";
import { WorkflowCoordinator } from "../src/workflow-coordinator.js";
import { fieldOf, listOf, readJson } from "./http-json.js";
import { claimOver } from "./sidecar-fixture.js";
import { batchOf, jobIdOf, verifiedReceipt } from "./workflow-coordinator-fixture.js";
import { present } from "./agent-test-support.js";

const at = new Date("2026-09-21T12:00:00.000Z");
const authority = {
  hostProfileId: "profile-durable",
  hostBasis: "durability fixture host profile",
  hostSupported: true,
  verificationBasis: "durability fixture verifier",
  exactVerification: true,
  targetResolved: true,
  policyApprovalId: "approval-ref:durable",
} as const;

function plan(planId: string): ActionPlan {
  return {
    schemaVersion: "0.2",
    planId,
    snapshotFingerprint: "snapshot-before",
    selectionFingerprint: "selection-1",
    summary: "Rename durable fixture layer",
    requiresApproval: true,
    operations: [{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1", snapshotFingerprint: "snapshot-before", selectionFingerprint: "selection-1" }, name: "Durable" }],
  };
}

function directory(t: TestContext): string {
  const value = mkdtempSync(join(tmpdir(), "ae-workflow-durable-"));
  t.after(() => rmSync(value, { recursive: true, force: true }));
  return value;
}

function coordinatorAt(filePath: string): WorkflowCoordinator {
  return new WorkflowCoordinator({ now: () => at, store: createPersistentWorkflowStore({ filePath }) });
}

function admitAndQueue(coordinator: WorkflowCoordinator, value: ActionPlan): void {
  assert.equal(coordinator.admitPlan(value, { jobId: "durable-job", undoGroups: 1, authority }).ok, true);
  coordinator.queue(value.planId);
}

test("sidecar restart restores durable plan identity but never recreates a host handoff", async (t) => {
  const root = directory(t);
  const first = new ReadOnlySidecar({ token: "durable-token", stateDirectory: root, now: () => at });
  const value = plan("queued-before-restart");
  admitAndQueue(first.workflowCoordinator, value);
  await first.stop();

  const restarted = new ReadOnlySidecar({ token: "durable-token", stateDirectory: root, now: () => at });
  t.after(() => restarted.stop());
  assert.equal(restarted.workflowCoordinator?.hasPlan(value.planId), true);
  assert.equal(restarted.workflowCoordinator?.batchForPlan(value.planId)?.lifecycle, "queued");
  assert.equal(restarted.workflowCoordinator?.projection().resumeSupported, true);
  assert.equal(restarted.workflowCoordinator?.projection().automaticDispatchResumeSupported, false);
  assert.equal(restarted.workflowCoordinator?.projection().resumeBoundary, "durable_state_and_explicit_receipts");
  assert.equal(restarted.agentMailbox.length, 0);
  assert.equal(restarted.readyPlans.length, 0);
  assert.equal(restarted.inFlight, undefined);
});

test("executing recovery blocks duplicate dispatch, mailbox retry, and accepts only receipt evidence", async (t) => {
  const filePath = join(directory(t), "workflow-store.json");
  const value = plan("executing-before-restart");
  const first = coordinatorAt(filePath);
  admitAndQueue(first, value);
  first.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.beginApply(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.close();

  const root = join(filePath, "..");
  const sidecar = new ReadOnlySidecar({ port: 0, token: "durable-token", stateDirectory: root, now: () => at });
  await sidecar.start();
  const restarted = sidecar.workflowCoordinator;
  assert.equal(restarted.batchForPlan(value.planId)?.lifecycle, "executing");
  assert.equal(restarted.canAcceptLateExecutionReceipt(value.planId), true);
  const claim = claimOver(sidecar);
  assert.equal(claim.status, 200);
  assert.equal(fieldOf(claim.body, "item"), null, "restart must not reconstruct or retry the consumed mailbox command");
  assert.throws(
    () => restarted.beginApply(value.planId, authority.policyApprovalId, value.snapshotFingerprint),
    { code: "DUPLICATE_DISPATCH" },
  );
  restarted.receipt(value.planId, {
    receiptId: "late-unknown",
    planId: value.planId,
    status: "unknown",
    postcondition: "unknown",
    mayHaveMutated: true,
    mutationState: "mutation-unknown",
  });
  assert.equal(restarted.batchForPlan(value.planId)?.execution.state, "unknown");
  assert.equal(restarted.canReconcileLateReceipt(value.planId), true);
  await sidecar.stop();
});

test("persisted uncertain settlement permits distinct explicit reconciliation after replay", (t) => {
  const filePath = join(directory(t), "workflow-store.json");
  const value = plan("reconcile-after-restart");
  const first = coordinatorAt(filePath);
  admitAndQueue(first, value);
  first.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.beginApply(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.receipt(value.planId, { receiptId: "lost-receipt", status: "unknown", postcondition: "unknown", mayHaveMutated: true, mutationState: "mutation-unknown" });
  first.close();

  const restarted = coordinatorAt(filePath);
  restarted.reconcile(value.planId, {
    receiptId: "late-authoritative-receipt",
    status: "executed",
    postcondition: "passed",
    mayHaveMutated: true,
    mutationState: "applied",
    afterFingerprint: "snapshot-after",
    verification: { state: "exact", steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis: "durability fixture readback" }] },
  });
  assert.equal(restarted.batchForPlan(value.planId)?.verification.state, "verified");
  restarted.close();

  const replayed = coordinatorAt(filePath);
  assert.equal(replayed.batchForPlan(value.planId)?.verification.state, "verified");
  assert.equal(replayed.batchForPlan(value.planId)?.execution.receiptId, "late-authoritative-receipt");
  replayed.close();
});

test("verified receipt observations survive durable workflow replay", (t) => {
  const filePath = join(directory(t), "workflow-store.json");
  const value = plan("durable-observations");
  const first = coordinatorAt(filePath);
  admitAndQueue(first, value);
  first.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.beginApply(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.receipt(value.planId, verifiedReceipt("durable-observations-receipt"));
  const batch = batchOf(first, value.planId);
  first.recordObservation(batch.jobId, { evidenceId: "durable-visual-observation", jobId: batch.jobId, stageId: batch.stageId, kind: "visual", basis: "durable fixture visual measurement", observedFingerprint: "snapshot-after-durable-observations-receipt", recordedAt: at.toISOString() });
  assert.equal(Object.values(first.workflowStore.getState().observations)[0]?.kind, "visual");
  first.close();

  const restarted = coordinatorAt(filePath);
  const observations = Object.values(restarted.workflowStore.getState().observations);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.basis, "durable fixture visual measurement");
  assert.equal(restarted.batchForPlan(value.planId)?.verification.state, "verified");
  restarted.close();
});

test("cancellation during durable dispatch preserves the executing batch for a late receipt", (t) => {
  const filePath = join(directory(t), "workflow-store.json");
  const value = plan("cancelled-during-restart");
  const first = coordinatorAt(filePath);
  admitAndQueue(first, value);
  first.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.beginApply(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  first.cancelJob(jobIdOf(first, value.planId));
  first.close();

  const restarted = coordinatorAt(filePath);
  assert.equal(restarted.batchForPlan(value.planId)?.lifecycle, "executing");
  assert.equal(restarted.batchForPlan(value.planId)?.cancelRequested, true);
  restarted.receipt(value.planId, {
    receiptId: "cancelled-late-receipt",
    status: "executed",
    postcondition: "passed",
    mayHaveMutated: true,
    mutationState: "applied",
    afterFingerprint: "snapshot-after-cancelled",
    verification: { state: "exact", steps: [{ operation: "set_layer_name", verificationState: "exact", observed: true, basis: "late fixture readback" }] },
  });
  assert.equal(restarted.batchForPlan(value.planId)?.verification.state, "verified");
  assert.equal(restarted.workflowStore.getState().jobs[jobIdOf(restarted, value.planId)]?.status, "cancelled");
  assert.equal(restarted.workflowStore.getState().activeDispatchLease, null);
  restarted.close();
});

test("stale snapshots and receipt identity conflicts stay guarded after replay", (t) => {
  const filePath = join(directory(t), "workflow-store.json");
  const stale = plan("stale-after-restart");
  const first = coordinatorAt(filePath);
  admitAndQueue(first, stale);
  first.close();

  const restarted = coordinatorAt(filePath);
  assert.throws(
    () => restarted.beginApply(stale.planId, authority.policyApprovalId, "different-snapshot", restarted.batchForPlan(stale.planId)?.admission?.sourcePlanDigest),
    { code: "STALE_SNAPSHOT" },
  );
  restarted.bindApproval(stale.planId, authority.policyApprovalId, stale.snapshotFingerprint, restarted.batchForPlan(stale.planId)?.admission?.sourcePlanDigest);
  restarted.beginApply(stale.planId, authority.policyApprovalId, stale.snapshotFingerprint, restarted.batchForPlan(stale.planId)?.admission?.sourcePlanDigest);
  restarted.receipt(stale.planId, { receiptId: "durable-receipt-identity", status: "unknown", postcondition: "unknown", mayHaveMutated: true, mutationState: "mutation-unknown" });
  restarted.close();

  const replayed = coordinatorAt(filePath);
  assert.throws(
    () => replayed.receipt(stale.planId, { receiptId: "durable-receipt-identity", status: "executed", postcondition: "passed", mayHaveMutated: true, mutationState: "applied", afterFingerprint: "conflicting-snapshot" }),
    { code: "DUPLICATE_EVENT_CONFLICT" },
  );
  assert.equal(replayed.batchForPlan(stale.planId)?.execution.receiptId, "durable-receipt-identity");
  assert.equal(replayed.batchForPlan(stale.planId)?.execution.state, "unknown");
  replayed.close();
});

test("provider-cycle boundaries and terminal blockers survive exact replay", (t) => {
  const root = directory(t);

  const providerPath = join(root, "provider-failure.json");
  const providerPlan = plan("provider-failure-plan");
  const provider = coordinatorAt(providerPath);
  admitAndQueue(provider, providerPlan);
  provider.closeProviderCycle(jobIdOf(provider, providerPlan.planId), 1);
  provider.bindApproval(providerPlan.planId, authority.policyApprovalId, providerPlan.snapshotFingerprint);
  provider.beginApply(providerPlan.planId, authority.policyApprovalId, providerPlan.snapshotFingerprint);
  provider.receipt(providerPlan.planId, verifiedReceipt("provider-cycle-receipt"));
  provider.completeStageForContinuation(jobIdOf(provider, providerPlan.planId));
  provider.closeProviderCycle(jobIdOf(provider, providerPlan.planId), 2);
  provider.blockJob(jobIdOf(provider, providerPlan.planId), "workflow:provider_error");
  provider.close();

  const providerReplay = coordinatorAt(providerPath);
  const providerJob = providerReplay.workflowStore.getState().jobs[jobIdOf(providerReplay, providerPlan.planId)];
  assert.ok(providerJob);
  assert.equal(providerJob.providerCycle, 2);
  assert.equal(providerJob.blocker, "workflow:provider_error");
  assert.equal(providerReplay.batchForPlan(providerPlan.planId)?.verification.state, "verified");
  assert.equal(providerReplay.projection().jobs[0]?.providerCycle, 2);
  assert.equal(providerReplay.continuation(providerJob.jobId, { fingerprint: "snapshot-after-provider", revision: "2" }).cycle, 2);
  providerReplay.close();

  for (const terminal of [
    { file: "no-batch.json", seed: "no-batch", blocker: "workflow:workflow_no_batch" },
    { file: "cycle-limit.json", seed: "cycle-limit", blocker: "workflow:cycle-limit" },
  ]) {
    const current = coordinatorAt(join(root, terminal.file));
    const jobId = current.openJob(terminal.seed, terminal.seed);
    current.closeProviderCycle(jobId, 1);
    current.blockJob(jobId, terminal.blocker);
    current.close();
    const replayed = coordinatorAt(join(root, terminal.file));
    assert.equal(replayed.workflowStore.getState().jobs[jobId]?.providerCycle, 1, terminal.seed);
    assert.equal(replayed.workflowStore.getState().jobs[jobId]?.blocker, terminal.blocker, terminal.seed);
    assert.equal(replayed.workflowStore.getState().jobs[jobId]?.status, "blocked", terminal.seed);
    replayed.close();
  }
});

test("a blocked recoverable brief reopens from durable identity without replaying a batch", (t) => {
  const filePath = join(directory(t), "resume-brief.json");
  const first = coordinatorAt(filePath);
  const jobId = first.openJob("resume-midnight-tram", "Animate the seven-second Midnight Tram brief", { requestId: "prompt-midnight-tram", autoApply: true });
  first.recordProviderFailure(jobId, "WORKFLOW_ADMISSION_REFUSED", "STALE_TARGET: fresh project context is required", false);
  first.blockJob(jobId, "workflow:workflow_admission_refused");
  first.close();

  const restarted = coordinatorAt(filePath);
  assert.deepEqual(restarted.resumeContext(jobId), { requestId: "prompt-midnight-tram", autoApply: true });
  assert.equal(restarted.workflowStore.getState().jobs[jobId]?.status, "blocked");
  assert.equal(restarted.workflowStore.getState().jobs[jobId]?.batchIds.length, 0);
  restarted.reopenForContinuation(jobId);
  const resumed = restarted.workflowStore.getState();
  assert.equal(resumed.jobs[jobId]?.status, "active");
  assert.equal(resumed.activeJobId, jobId);
  assert.equal(resumed.jobs[jobId]?.batchIds.length, 0, "resume changes durable job state only; it does not replay or create a host batch");
  restarted.reopenForContinuation(jobId);
  assert.equal(restarted.workflowStore.listEvents(jobId).filter((event) => event.type === "job.reopenedForContinuation").length, 1, "repeated recovery scans are idempotent and do not append a second resume transition");
  restarted.close();
});

async function healthNoticesOf(response: Response): Promise<string[]> {
  const body = await readJson(response);
  return listOf(body, "workflow.startupNotices").filter((notice): notice is string => typeof notice === "string");
}

test("an unreadable workflow journal is set aside and the sidecar starts with an empty store", async (t) => {
  const root = directory(t);
  const journal = join(root, "workflow-store.json");
  const bytes = JSON.stringify({ format: "extynt.workflow.event-log", storageVersion: 1, workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION, generation: 3, events: [{ type: "job.fromTheFuture", eventId: "future-1", jobId: "future-job", at: "2026-09-21T12:00:00.000Z" }], checksum: "0".repeat(64) });
  writeFileSync(journal, bytes);

  const sidecar = new ReadOnlySidecar({ token: "durable-token", stateDirectory: root, now: () => at, port: 0 });
  t.after(() => sidecar.stop());
  const aside = readdirSync(root).filter((name) => name.startsWith("workflow-store.json.corrupt-"));
  assert.equal(aside.length, 1, "the unreadable journal is renamed aside, not deleted");
  assert.equal(readFileSync(join(root, present(aside[0], "set-aside journal")), "utf8"), bytes, "its bytes are preserved untouched");
  assert.equal(existsSync(journal), true, "a fresh empty journal replaces it");
  assert.deepEqual(sidecar.workflowCoordinator.workflowStore.getState().jobs, {});
  assert.equal(sidecar.workflowCoordinator.projection().startupNotices?.length, 1);

  const address = await sidecar.start();
  const response = await fetch(`http://${address.host}:${address.port}/v1/workflow/status`, { headers: { Authorization: "Bearer durable-token" } });
  assert.equal(response.status, 200);
  const status = await readJson(response);
  assert.equal(fieldOf(status, "projection.activeJobId"), null);
  assert.deepEqual(fieldOf(status, "projection.jobs"), []);
  assert.match(String(fieldOf(status, "projection.startupNotices.0") ?? ""), /set aside/);

  const health = await fetch(`http://${address.host}:${address.port}/health`, { headers: { Authorization: "Bearer durable-token" } });
  assert.equal(health.status, 200);
  const healthNotices = await healthNoticesOf(health);
  assert.equal(healthNotices.length, 1);
  assert.match(healthNotices[0] ?? "", /set aside as workflow-store\.json\.corrupt-/);
  assert.equal(healthNotices[0]?.includes(root), false, "the notice names the preserved file, never a directory path");
});

test("/health reports no workflow startup notices on a clean start and bounds any it does report", async (t) => {
  const root = directory(t);
  const sidecar = new ReadOnlySidecar({ token: "durable-token", stateDirectory: root, now: () => at, port: 0 });
  t.after(() => sidecar.stop());
  const address = await sidecar.start();
  const read = async (): Promise<string[]> => healthNoticesOf(await fetch(`http://${address.host}:${address.port}/health`, { headers: { Authorization: "Bearer durable-token" } }));
  assert.deepEqual(await read(), []);
  for (let index = 0; index < 8; index += 1) sidecar.workflowCoordinator.addStartupNotice(`notice ${index} ${"x".repeat(500)}`);
  const notices = await read();
  assert.equal(notices.length, 5, "at most five notices are exposed");
  assert.ok(notices.every((notice) => notice.length <= 300), "each notice is truncated to 300 characters");
});

test("a restart blocks an active job with no in-flight host batch, but never one with live or unsettled work", async (t) => {
  const idleRoot = directory(t);
  const idle = coordinatorAt(join(idleRoot, "workflow-store.json"));
  const idleJob = idle.openJob("idle-seed", "Idle goal");
  idle.close();
  const settledRoot = directory(t);
  const settled = coordinatorAt(join(settledRoot, "workflow-store.json"));
  const settledPlan = plan("settled-before-restart");
  admitAndQueue(settled, settledPlan);
  settled.bindApproval(settledPlan.planId, authority.policyApprovalId, settledPlan.snapshotFingerprint);
  settled.beginApply(settledPlan.planId, authority.policyApprovalId, settledPlan.snapshotFingerprint);
  settled.receipt(settledPlan.planId, verifiedReceipt("settled-receipt"));
  const settledJob = jobIdOf(settled, settledPlan.planId);
  assert.equal(settled.workflowStore.getState().activeJobId, settledJob, "a settled batch alone does not complete or release the job");
  settled.close();
  const executingRoot = directory(t);
  const executing = coordinatorAt(join(executingRoot, "workflow-store.json"));
  const executingPlan = plan("executing-before-restart");
  admitAndQueue(executing, executingPlan);
  executing.bindApproval(executingPlan.planId, authority.policyApprovalId, executingPlan.snapshotFingerprint);
  executing.beginApply(executingPlan.planId, authority.policyApprovalId, executingPlan.snapshotFingerprint);
  const executingJob = jobIdOf(executing, executingPlan.planId);
  executing.close();

  for (const [root, jobId, blocked] of [[idleRoot, idleJob, true], [settledRoot, settledJob, true], [executingRoot, executingJob, false]] as const) {
    const sidecar = new ReadOnlySidecar({ token: "durable-token", stateDirectory: root, now: () => at });
    const state = sidecar.workflowCoordinator.workflowStore.getState();
    assert.equal(state.jobs[jobId]?.status, blocked ? "blocked" : "active", jobId);
    assert.equal(state.jobs[jobId]?.blocker ?? null, blocked ? "workflow:interrupted-before-completion" : null, jobId);
    assert.equal(state.activeJobId, blocked ? null : jobId, "only a job with nothing in flight releases the chat lane");
    await sidecar.stop();
  }
});

test("repeated identical provider failures append one durable record until the failure changes or clears", (t) => {
  const filePath = join(directory(t), "failure-dedupe.json");
  const coordinator = coordinatorAt(filePath);
  const jobId = coordinator.openJob("dedupe-seed", "Dedupe goal");
  const recorded = (): number => coordinator.workflowStore.listEvents(jobId).filter((event) => event.type === "job.providerFailureRecorded").length;
  for (let attempt = 0; attempt < 5; attempt += 1) coordinator.recordProviderFailure(jobId, "PROVIDER_ERROR", "synthetic outage", true);
  assert.equal(recorded(), 1);
  coordinator.recordProviderFailure(jobId, "PROVIDER_ERROR", "synthetic outage", false);
  assert.equal(recorded(), 2, "a different afterSeal is a different failure");
  coordinator.recordProviderFailure(jobId, "PROVIDER_ERROR", "a different message", false);
  assert.equal(recorded(), 3);
  coordinator.clearProviderFailure(jobId);
  coordinator.recordProviderFailure(jobId, "PROVIDER_ERROR", "a different message", false);
  assert.equal(recorded(), 4, "the same failure after a clear is new information");
  coordinator.close();
  const replayed = coordinatorAt(filePath);
  assert.equal(replayed.projection(jobId).providerFailures.length, 1);
  replayed.close();
});

test("a stale provider blocker is cleared when a job reopens for continuation and when a batch seals", (t) => {
  const coordinator = coordinatorAt(join(directory(t), "failure-clear.json"));
  const reopened = coordinator.openJob("reopen-seed", "Reopen goal");
  coordinator.recordProviderFailure(reopened, "WORKFLOW_NO_BATCH", "no batch was proposed", false);
  coordinator.blockJob(reopened, "workflow:workflow_no_batch");
  assert.ok(coordinator.continuation(reopened, { fingerprint: "snapshot-before", revision: "1" }).blockers.some((blocker) => blocker.startsWith("provider:WORKFLOW_NO_BATCH")));
  coordinator.reopenForContinuation(reopened);
  assert.equal(coordinator.continuation(reopened, { fingerprint: "snapshot-before", revision: "1" }).blockers.some((blocker) => blocker.startsWith("provider:")), false);
  coordinator.reopenForContinuation(reopened);
  assert.equal(coordinator.workflowStore.listEvents(reopened).filter((event) => event.type === "job.reopenedForContinuation").length, 1, "the cleared marker does not hide the completed reopen from its idempotency check");
  coordinator.cancelJob(reopened);

  const value = plan("seal-clears-failure");
  assert.equal(coordinator.admitPlan(value, { jobId: "seal-logical-job", undoGroups: 1, authority }).ok, true);
  const sealedJob = jobIdOf(coordinator, value.planId);
  coordinator.recordProviderFailure(sealedJob, "WORKFLOW_ADMISSION_REFUSED", "STALE_TARGET", false);
  const second = plan("seal-clears-failure-2");
  assert.equal(coordinator.continuation(sealedJob, { fingerprint: "snapshot-before", revision: "1" }).blockers.some((blocker) => blocker.startsWith("provider:")), true);
  coordinator.queue(value.planId);
  coordinator.bindApproval(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.beginApply(value.planId, authority.policyApprovalId, value.snapshotFingerprint);
  coordinator.receipt(value.planId, verifiedReceipt("seal-receipt"));
  coordinator.completeStageForContinuation(sealedJob);
  const admitted = coordinator.admitPlan(second, { jobId: "seal-logical-job", undoGroups: 1, authority });
  assert.equal(admitted.ok, true, JSON.stringify(admitted));
  assert.equal(coordinator.continuation(sealedJob, { fingerprint: "snapshot-after-seal-receipt", revision: "2" }).blockers.some((blocker) => blocker.startsWith("provider:")), false, "admitting the next sealed batch clears the stale provider blocker");
  coordinator.close();
});
