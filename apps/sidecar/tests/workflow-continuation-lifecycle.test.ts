/** The workflow engine's lifecycle: projection, refused legacy receipts, completion mutation, and cancellation. */
import type { JsonObject } from "@extynt/decode";
import { MockProvider, splitTransient, type AgentStepInput, type AgentStepResult } from "@extynt/llm";
import { createInMemoryWorkflowStore, type WorkflowEvent, type WorkflowStore } from "@extynt/workflow";
import assert from "node:assert/strict";
import test from "node:test";
import { uiEventsFor } from "../src/ui-events.js";
import { present } from "./agent-test-support.js";
import { fieldOf, flagOf, listOf, maybeFlagOf, maybeListOf, maybeTextOf, parseJson, readJson, recordOf, textOf, type JsonObject as Reading } from "./http-json.js";
import { chatTurn, claimResponse, mutableSnapshot, queueFinishStep, queueRename, queueScript, sidecarFor, token, workflowStageStep } from "./sidecar-fixture.js";
import { approvePlan, askBeforeApplying, beginApply, claimedRename, startLifecycle, verifiedApply, type Lifecycle } from "./workflow-lifecycle-fixtures.js";

const MARKER = "WORKFLOW CONTINUATION INPUT (sidecar-owned structured evidence; do not infer beyond these fields):\n";

const batchField = (status: Reading, field: string) => maybeTextOf(status, `projection.batches.0.${field}`);

async function plannedRename(life: Lifecycle, tag: string, message: string): Promise<string> {
  await askBeforeApplying(life);
  await life.post("/v1/snapshots", mutableSnapshot(`${tag}-before`));
  const response = await chatTurn(life.address, message);
  assert.equal(response.outcome, "planned");
  return present(response.plans[0]).planId;
}

async function approveAndClaim(life: Lifecycle, planId: string): Promise<string> {
  const approved = await approvePlan(life, planId);
  assert.equal(approved.status, 200);
  return approved.approvalId;
}

async function projectQueuedPlan(life: Lifecycle, planId: string): Promise<string> {
  const ready = await readJson(await life.get("/v1/chat/plans/ready"));
  assert.deepEqual(listOf(ready, "plans").map((entry) => textOf(entry, "planId")), [planId]);
  const claimed = await life.status();
  assert.equal(textOf(claimed, "projection.engine"), "workflow-v1");
  assert.equal(flagOf(claimed, "projection.resumeSupported"), true);
  assert.equal(batchField(claimed, "lifecycle"), "queued");
  const approvalId = await approveAndClaim(life, planId);
  const approvedProjection = await life.status();
  assert.equal(batchField(approvedProjection, "lifecycle"), "queued");
  assert.equal(maybeFlagOf(approvedProjection, "projection.batches.0.approvalBound"), true);
  assert.equal((await claimResponse(life.sidecar)).status, 200);
  return approvalId;
}

async function settleProjectedPlan(life: Lifecycle, planId: string, approvalId: string): Promise<void> {
  await life.post("/v1/snapshots", mutableSnapshot("workflow-before-mailbox-apply"));
  assert.equal((await beginApply(life, planId)).status, 200);
  const duplicateBegin = await beginApply(life, planId);
  const duplicateBeginBody = await readJson(duplicateBegin);
  assert.equal(duplicateBegin.status, 200);
  assert.deepEqual(duplicateBeginBody, { ok: true, idempotent: true, alreadyExecuting: true }, "a duplicate host-boundary notification must not authorize a second mutation");
  assert.equal(batchField(await life.status(), "lifecycle"), "executing");
  const receiptBody = { planId, approvalId, receiptId: "apply-retry-1", operation: "apply_plan", status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", appliedOperations: ["set_layer_name"] };
  assert.equal((await life.post("/v1/receipts", receiptBody)).status, 201);
  assert.equal((await life.post("/v1/receipts", receiptBody)).status, 200);
  assert.equal((await life.post("/v1/receipts", { ...receiptBody, postcondition: "passed" })).status, 409);
}

async function assertSettledProjection(life: Lifecycle): Promise<void> {
  const afterConflict = await life.status();
  assert.equal(batchField(afterConflict, "lifecycle"), "settled");
  assert.equal(batchField(afterConflict, "execution"), "executed");
  const settled = await life.status();
  assert.equal(batchField(settled, "lifecycle"), "settled");
  assert.equal(batchField(settled, "verification"), "applied_unverified");
  assert.equal(maybeTextOf(settled, "projection.operations.0.outcome"), "applied_unconfirmed");
}

test("workflow-v1 projects the in-panel lifecycle, and every sidecar serves its status", async (t) => {
  const life = await startLifecycle(t, { chatProvider: new MockProvider({ script: queueScript("workflow", "Workflow") }) });
  const planId = await plannedRename(life, "workflow", "rename this to Workflow");
  const approvalId = await projectQueuedPlan(life, planId);
  await settleProjectedPlan(life, planId, approvalId);
  await assertSettledProjection(life);
  const plain = sidecarFor({ port: 0, token });
  const plainAddress = await plain.start();
  t.after(() => plain.stop());
  const served = await fetch(`http://${plainAddress.host}:${plainAddress.port}/v1/workflow/status`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(served.status, 200, "workflow-v1 is the only engine, so no configuration turns its status off");
  assert.equal(textOf(await readJson(served), "projection.engine"), "workflow-v1");
});

function faultingStore(fail: { settlement: boolean }): WorkflowStore {
  const baseStore = createInMemoryWorkflowStore();
  const refuse = () => { throw new Error("synthetic workflow transition failure"); };
  return {
    ...baseStore,
    append: (event: WorkflowEvent) => {
      if (fail.settlement && event.type === "batch.receipt") refuse();
      return baseStore.append(event);
    },
    appendBatch: (events: readonly WorkflowEvent[]) => {
      if (fail.settlement && events.some((event) => event.type === "batch.receipt")) refuse();
      return baseStore.appendBatch(events);
    },
  };
}

async function planStatusOf(life: Lifecycle, planId: string): Promise<string | undefined> {
  const listed = await life.call("ae_list_plans");
  return maybeTextOf(maybeListOf(listed, "data")?.find((entry) => textOf(entry, "planId") === planId), "status");
}

async function assertFaultRefused(life: Lifecycle, receiptBody: JsonObject, planId: string): Promise<void> {
  const refused = await life.post("/v1/receipts", receiptBody);
  assert.equal(refused.status, 409);
  assert.equal(maybeTextOf(await readJson(refused), "error.code"), "WORKFLOW_SETTLEMENT_REFUSED");
  assert.equal(await planStatusOf(life, planId), "applying", "a failed reducer transition cannot publish a legacy receipt or settle the plan");
  const workflowAfterFault = await life.status();
  assert.equal(batchField(workflowAfterFault, "lifecycle"), "executing");
  assert.equal(batchField(workflowAfterFault, "execution"), "applying");
  assert.deepEqual(listOf(workflowAfterFault, "projection.divergences").map((entry) => textOf(entry, "planId")), [planId]);
}

test("workflow-v1 refuses a legacy-only receipt when the authoritative transition faults", async (t) => {
  const fail = { settlement: true };
  const life = await startLifecycle(t, { chatProvider: new MockProvider({ script: queueScript("workflow-atomicity", "Atomicity") }), workflowStore: faultingStore(fail) });
  const planId = await plannedRename(life, "workflow-atomicity", "rename this to Atomicity");
  const approvalId = await approveAndClaim(life, planId);
  assert.equal(fieldOf(await readJson(await claimResponse(life.sidecar)), "item") !== null, true);
  await life.post("/v1/snapshots", mutableSnapshot("workflow-atomicity-apply"));
  assert.equal((await beginApply(life, planId)).status, 200);
  const receiptBody = { planId, approvalId, receiptId: "atomicity-receipt-1", operation: "apply_plan", status: "executed", postcondition: "applied_unverified", mayHaveMutated: true, mutationState: "applied", appliedOperations: ["set_layer_name"] };
  await assertFaultRefused(life, receiptBody, planId);
  fail.settlement = false;
  assert.equal((await life.post("/v1/receipts", receiptBody)).status, 201);
  assert.equal(await planStatusOf(life, planId), "applied_unverified");
  const workflowAfterRecovery = await life.status();
  assert.equal(batchField(workflowAfterRecovery, "lifecycle"), "settled");
  assert.equal(batchField(workflowAfterRecovery, "verification"), "applied_unverified");
  assert.deepEqual(listOf(workflowAfterRecovery, "projection.divergences"), []);
});

function continuationOf(input: AgentStepInput): Reading | undefined {
  if (!input.system.includes(MARKER)) return undefined;
  const text = input.system.slice(input.system.lastIndexOf(MARKER) + MARKER.length).trim();
  return recordOf(parseJson(text.slice(0, text.lastIndexOf("}") + 1)), "");
}

function completeCall(continuation: Reading, id: string): AgentStepResult {
  const settled = recordOf(continuation, "settledBatches.0");
  const reference = { kind: "batch_receipt", batchId: textOf(settled, "batchId"), receiptId: textOf(recordOf(settled, "receipt"), "receiptId") };
  return { text: "", toolCalls: [{ id, name: "ae_workflow_complete", arguments: { goalDigest: textOf(continuation, "goalDigest"), criterionIds: ["goal-observed"], evidence: [{ criterionId: "goal-observed", reference }] } }] };
}

function buildRename(input: AgentStepInput, id: string): AgentStepResult {
  const called = input.messages.filter((message) => message.role === "tool").map((message) => message.name);
  if (!called.includes("ae_select_workflow_stage")) return workflowStageStep(id);
  if (!called.includes("ae_queue_add")) return queueRename(id, "Hero");
  if (!called.includes("ae_queue_finish")) return queueFinishStep(id);
  return { text: "", toolCalls: [] };
}

async function settleVerifiedRename(life: Lifecycle, tag: string, planId: string): Promise<void> {
  const approvalId = await approveAndClaim(life, planId);
  assert.equal((await claimResponse(life.sidecar)).status, 200);
  assert.equal((await beginApply(life, planId)).status, 200);
  await life.post("/v1/snapshots", mutableSnapshot(`${tag}-after-apply`, ["layer-1"], "Hero"));
  const receipt = await life.post("/v1/receipts", verifiedApply(planId, approvalId, `${tag}-verified`));
  assert.equal(receipt.status, 201);
}

async function awaitWorkflowSettled(life: Lifecycle): Promise<Reading> {
  let status = await life.status();
  for (let attempt = 0; attempt < 40 && maybeTextOf(status, "projection.jobs.0.status") === "active"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = await life.status();
  }
  return status;
}

test("workflow completion refuses a snapshot mutation that occurs in the provider cycle before completion", async (t) => {
  let life: Lifecycle | undefined;
  let continuationCalls = 0;
  const provider = new MockProvider({ script: async (input: AgentStepInput) => {
    const continuation = continuationOf(input);
    if (!continuation) return buildRename(input, "completion");
    continuationCalls += 1;
    const continuationPrompt = [...splitTransient(input.messages).persisted].reverse().find((message) => message.role === "user");
    assert.match(String(fieldOf(continuationPrompt, "content") ?? ""), /call ae_workflow_complete/, "continuations request typed completion instead of a prose answer that the reducer cannot accept");
    await present(life).post("/v1/snapshots", mutableSnapshot("completion-provider-mutation", ["layer-1"], "Changed during completion"));
    return completeCall(continuation, "completion-after-mutation");
  } });
  life = await startLifecycle(t, { chatProvider: provider });
  const planId = await plannedRename(life, "completion", "rename this to Hero");
  const ready = await readJson(await life.get("/v1/chat/plans/ready"));
  assert.deepEqual(listOf(ready, "plans").map((entry) => textOf(entry, "planId")), [planId]);
  await settleVerifiedRename(life, "completion", planId);
  const status = await awaitWorkflowSettled(life);
  assert.equal(continuationCalls, 2, "one malformed completion gets a bounded correction attempt before the identical refusal closes the cycle");
  assert.equal(maybeTextOf(status, "projection.jobs.0.status"), "blocked");
  assert.equal(maybeTextOf(status, "projection.providerFailures.0.code"), "COMPLETION_SNAPSHOT_UNPAIRED", JSON.stringify(status));
  const events = life.sidecar.workflowCoordinator.workflowStore.listEvents(textOf(recordOf(status, "projection.jobs.0"), "jobId"));
  assert.equal(events.some((event) => event.type === "job.completed"), false);
});

test("an accepted completion in a continuation cycle leaves the job completed, not blocked at the cycle limit", async (t) => {
  const provider = new MockProvider({ script: (input: AgentStepInput) => {
    const continuation = continuationOf(input);
    return continuation ? completeCall(continuation, "completion") : buildRename(input, "complete");
  } });
  const life = await startLifecycle(t, { chatProvider: provider });
  const pushed: string[] = [];
  uiEventsFor(life.sidecar).subscribe((event) => { if (event.type === "closing") pushed.push(event.text); });
  await settleVerifiedRename(life, "complete", await plannedRename(life, "complete", "rename this to Hero"));
  const status = await awaitWorkflowSettled(life);
  assert.equal(maybeTextOf(status, "projection.jobs.0.status"), "completed", JSON.stringify(status));
  assert.deepEqual(maybeListOf(status, "projection.providerFailures") ?? [], []);
  const jobId = textOf(recordOf(status, "projection.jobs.0"), "jobId");
  assert.doesNotThrow(() => life.sidecar.workflowCoordinator.closeProviderCycle(jobId, 9), "the cycle that completed the job has nothing left to close");
  const requestId = [...life.sidecar.closingReplies.keys()][0] ?? "";
  const closing = await readJson(await life.get(`/v1/chat/closing?requestId=${encodeURIComponent(requestId)}`));
  assert.deepEqual(pushed, [textOf(closing, "closing")], "the reply is pushed on the event stream when it is stored");
  assert.match(textOf(closing, "closing"), /^Done: /, "a continuation that finished the job with no prose still closes with a reply the panel can show");
});

test("workflow-v1 cancellation before an undo claim closes recovery without leaving a mailbox lease", async (t) => {
  const life = await startLifecycle(t, { chatProvider: new MockProvider({ script: queueScript("undo-cancel-pending", "Hero") }) });
  await askBeforeApplying(life);
  const { planId, approvalId } = await claimedRename(life, "undo-cancel-pending");
  const applied = await life.post("/v1/receipts", verifiedApply(planId, approvalId, "undo-cancel-pending-apply"));
  assert.equal(applied.status, 201);
  const undo = await life.call("ae_undo_plan", { planId });
  assert.equal(undo.ok, true, JSON.stringify(undo));
  assert.equal(maybeTextOf(undo, "data.status"), "undo_requested");
  const cancelled = await life.call("ae_cancel_plan", { planId });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  const afterCancel = await life.status();
  assert.equal(maybeTextOf(afterCancel, "projection.jobs.0.status"), "cancelled");
  assert.equal(batchField(afterCancel, "lifecycle"), "settled");
  assert.equal(batchField(afterCancel, "recovery"), "blocked");
  assert.equal(fieldOf(afterCancel, "projection.activeDispatchLease"), null);
  assert.equal(fieldOf(afterCancel, "projection.activeJobId"), null);
  const mailbox = await readJson(await claimResponse(life.sidecar));
  assert.equal(fieldOf(mailbox, "item"), null, "cancellation before undo claim removes the queued recovery command");
});

async function assertLostRecoveryUnknown(life: Lifecycle): Promise<void> {
  const status = await life.status();
  assert.equal(maybeTextOf(status, "projection.jobs.0.status"), "cancelled");
  assert.equal(batchField(status, "lifecycle"), "settled");
  assert.equal(batchField(status, "recovery"), "unknown");
  assert.equal(fieldOf(status, "projection.activeDispatchLease"), null);
  assert.equal(fieldOf(status, "projection.activeJobId"), null);
}

async function assertGuardedLateUndo(life: Lifecycle, planId: string): Promise<void> {
  await life.post("/v1/snapshots", mutableSnapshot("undo-cancel-executing-restored"));
  const undone = { planId, receiptId: "undo-cancel-executing-late", operation: "undo_plan", status: "executed", executed: true, method: "headless-undo", times: 1 };
  const late = await life.post("/v1/receipts", undone);
  assert.equal(late.status, 201, await late.text());
  const status = await life.status();
  assert.equal(maybeTextOf(status, "projection.jobs.0.status"), "cancelled", "late recovery evidence cannot reopen a cancelled workflow");
  assert.equal(batchField(status, "recovery"), "undone");
  assert.equal(fieldOf(status, "projection.activeDispatchLease"), null);
  assert.equal((await life.post("/v1/receipts", undone)).status, 200);
  assert.equal((await life.post("/v1/receipts", { ...undone, method: "different-undo" })).status, 409);
}

test("workflow-v1 cancellation during undo settles lost recovery as unknown and accepts only guarded late evidence", async (t) => {
  const life = await startLifecycle(t, { chatProvider: new MockProvider({ script: queueScript("undo-cancel-executing", "Hero") }) });
  await askBeforeApplying(life);
  const { planId, approvalId, initialFingerprint } = await claimedRename(life, "undo-cancel-executing");
  const applied = await life.post("/v1/receipts", verifiedApply(planId, approvalId, "undo-cancel-executing-apply", { beforeFingerprint: initialFingerprint }));
  assert.equal(applied.status, 201);
  const undo = await life.call("ae_undo_plan", { planId });
  assert.equal(undo.ok, true, JSON.stringify(undo));
  const undoClaim = await readJson(await claimResponse(life.sidecar));
  assert.equal(maybeTextOf(undoClaim, "item.kind"), "undo_plan");
  assert.equal(maybeTextOf(undoClaim, "item.planId"), planId);
  assert.equal((await life.call("ae_cancel_plan", { planId })).ok, true);
  assert.equal(life.sidecar.settleHostFlight(), false, "the idle host settles the executing recovery instead of retaining its lease");
  await assertLostRecoveryUnknown(life);
  await assertGuardedLateUndo(life, planId);
});
