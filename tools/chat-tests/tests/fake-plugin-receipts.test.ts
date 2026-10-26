/*
 * The host's receipt and cancellation surfaces through the fake plugin: what happens to the host lease when a write is refused,
 * lost, answered with something unreadable, or races a cancellation or an edit made in After Effects.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readEnvelope, receiptEnvelope, rowsEnvelope } from "../src/envelopes.js";
import { jsonObject } from "../src/wire-reads.js";
import { startRig, type PluginRig } from "./fake-plugin-rig.js";
import { required } from "./test-support.js";
import type { WireObject } from "../src/wire-types.js";

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function whenPlanInFlight(holder: { rig?: PluginRig; done?: boolean }, act: (rig: PluginRig, planId: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const { rig } = holder;
    if (!rig || holder.done) return;
    const plans = await rig.sidecar.callTool("ae_list_plans", {});
    const inFlight = readEnvelope(rowsEnvelope, plans, "the ae_list_plans envelope").data.find((row) => row.status === "approved" || row.status === "applying");
    if (!inFlight) return;
    holder.done = true;
    await act(rig, String(inFlight.planId));
  };
}

function cancelOnce(holder: { rig?: PluginRig; result?: WireObject; done?: boolean }): () => Promise<void> {
  return whenPlanInFlight(holder, async (rig, planId) => { holder.result = await rig.sidecar.callTool("ae_cancel_plan", { planId }); });
}

async function untilBatchSettled(rig: PluginRig): Promise<Awaited<ReturnType<PluginRig["workflow"]>>> {
  for (const deadline = Date.now() + 5_000; ; await pause(25)) {
    const projection = await rig.workflow();
    if (projection.batches[0]?.lifecycle === "settled" || Date.now() > deadline) return projection;
  }
}

async function untilCensusOut(rig: PluginRig): Promise<void> {
  const asked = (): boolean => rig.host.plugin.requestsFor("host_call").some((request) => String(request.body.entry) === "aeHostCensus");
  for (const deadline = Date.now() + 5_000; !asked() && Date.now() < deadline; await pause(5));
  assert.equal(asked(), true, "the host was asked for the census");
}

async function cancelFirstPlan(rig: PluginRig): Promise<WireObject> {
  for (const deadline = Date.now() + 5_000; Date.now() < deadline; await pause(10)) {
    const rows = readEnvelope(rowsEnvelope, await rig.sidecar.callTool("ae_list_plans", {}), "the ae_list_plans envelope").data;
    if (rows[0]) return rig.sidecar.callTool("ae_cancel_plan", { planId: String(rows[0].planId) });
  }
  throw new Error("the turn never sealed a plan");
}

test("workflow-v1 cancellation before and during dispatch preserves the one host lease", async (t) => {
  const early = await startRig("cancel-before", { sidecar: { workflowMaxCycles: 2 }, host: { censusDelayMs: 1_500 } });
  t.after(() => early.stop());
  await untilCensusOut(early);
  const turn = early.sidecar.chat({ requestId: "workflow-cancel-before", message: "rename to Hero" });
  const cancel = await cancelFirstPlan(early);
  const response = await turn;
  await early.settle();
  assert.equal(cancel.ok, true, JSON.stringify(cancel));
  assert.equal(response.status, 200);
  assert.equal(early.host.batches.length, 0, "cancellation before apply-begin must refuse before the host is asked to write");
  const cancelled = await early.workflow();
  assert.equal(cancelled.jobs[0]?.status, "cancelled");
  assert.equal(cancelled.batches[0]?.lifecycle, "cancelled");
  assert.equal(cancelled.activeJobId, null);

  const during: { rig?: PluginRig; result?: WireObject; done?: boolean } = {};
  const late = await startRig("cancel-during", { sidecar: { workflowMaxCycles: 2 }, host: { beforeMutation: async () => { await cancelOnce(during)(); } } });
  t.after(() => late.stop());
  during.rig = late;
  const lateResponse = await late.sidecar.chat({ requestId: "workflow-cancel-during", message: "rename to Hero" });
  await late.settle();
  assert.equal(during.result?.ok, true, JSON.stringify(during.result));
  assert.equal(lateResponse.status, 200);
  assert.equal(late.host.batches.length, 1);
  assert.equal(late.host.batches[0]?.applied, 1, "a cancellation after apply-begin cannot stop the already-authorized host hop");
  const receipt = readEnvelope(receiptEnvelope, await late.sidecar.callTool("ae_get_receipt", { planId: late.host.batches[0].planId }), "the ae_get_receipt envelope").data.receipt;
  assert.equal(receipt.cancelledDuringApply, true);
  const settled = await late.workflow();
  assert.equal(settled.jobs[0]?.status, "cancelled");
  assert.equal(settled.batches[0]?.lifecycle, "settled");
  assert.equal(settled.batches[0]?.execution, "executed");
  assert.equal(settled.activeJobId, null, "the receipt settles and releases the cancelled host lease");
});

test("workflow-v1 cancellation after apply-begin with a lost answer releases the lease and keeps the outcome unknown", async (t) => {
  const during: { rig?: PluginRig; result?: WireObject; done?: boolean } = {};
  const rig = await startRig("cancel-lost", { sidecar: { workflowMaxCycles: 3 }, host: { receiptMode: "lost", beforeMutation: async () => { await cancelOnce(during)(); } } });
  t.after(() => rig.stop());
  during.rig = rig;
  const response = await rig.sidecar.chat({ requestId: "workflow-cancel-lost", message: "rename to Hero" });
  assert.equal(response.status, 200);
  assert.equal(during.result?.ok, true);
  assert.equal(rig.host.batches.length, 1, "a lost answer must never redispatch the already-claimed host batch");
  const projection = await untilBatchSettled(rig);
  assert.equal(projection.jobs[0]?.status, "cancelled");
  assert.equal(projection.batches[0]?.lifecycle, "settled");
  assert.equal(projection.batches[0]?.mutation, "may_have_mutated", "the dropped answer settles as explicit uncertainty");
  assert.notEqual(projection.batches[0]?.execution, "executed");
  assert.equal(projection.activeDispatchLease, null, "unknown settlement releases the host lease");
  assert.equal(projection.activeJobId, null, "cancellation plus a lost answer releases the host lane");
});

test("workflow-v1 refuses a project that changed behind the sidecar's back before the host is asked to write", async (t) => {
  const holder: { rig?: PluginRig; done?: boolean } = {};
  const edit = whenPlanInFlight(holder, (rig) => { rig.host.editExternally((snapshot) => { const layer = snapshot.compositions[0]?.layers[0]; if (layer) layer.name = `${layer.name} (edited)`; }); });
  const rig = await startRig("stale-claim", { sidecar: { workflowMaxCycles: 2 }, host: { beforeRead: edit } });
  t.after(() => rig.stop());
  holder.rig = rig;
  const response = await rig.sidecar.chat({ requestId: "workflow-stale-claim", message: "rename to Hero" });
  await rig.settle();

  assert.equal(response.body.outcome, "failed");
  assert.equal(jsonObject(response.body.failure, "the chat failure").code, "WORKFLOW_BATCH_BLOCKED");
  assert.equal(rig.host.batches.filter((batch) => batch.applied > 0).length, 0, "a stale project must be refused before the host mutates it");
  const projection = await untilBatchSettled(rig);
  assert.equal(projection.batches[0]?.lifecycle, "settled");
  assert.equal(projection.jobs[0]?.status, "blocked");
  assert.equal(projection.batches[0]?.execution, "rejected_before_apply", "a plan refused at the precheck never ran, so it settles as a refusal and not as a lost receipt");
  assert.equal(projection.batches[0]?.mutation, "none");
  assert.deepEqual(projection.divergences, []);
});

test("workflow-v1 sends work whose read-back is unavailable through the workflow without replaying the host batch", async (t) => {
  const rig = await startRig("unreadable", { sidecar: { workflowMaxCycles: 3 }, host: { receiptMode: "unreadable" } });
  t.after(() => rig.stop());
  const response = await rig.sidecar.chat({ requestId: "workflow-unreadable", message: "rename to Hero" });
  await rig.settle();
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 400));
  assert.equal(rig.host.batches.length, 1, "the applied host batch is never replayed");
  const projection = await rig.workflow();
  assert.deepEqual(projection.batches[0], { ...projection.batches[0], lifecycle: "settled", execution: "executed", mutation: "applied" });
  assert.notEqual(projection.batches[0]?.verification, "verified");
  assert.notEqual(projection.jobs[0]?.status, "completed", JSON.stringify(projection.jobs));
});

const SETTLEMENT = {
  partial: { execution: "failed_during_apply", mutation: "may_have_mutated", verification: "failed" },
  rejected: { execution: "rejected_before_apply", mutation: "none", verification: "not_requested" },
  unknown: { execution: "unknown", mutation: "may_have_mutated", verification: "unknown" },
} as const;

test("workflow-v1 blocks continuation for partial, rejected, unknown, and lost host answers", async (t) => {
  for (const mode of ["partial", "rejected", "unknown"] as const) {
    const rig = await startRig(`blocked-${mode}`, { sidecar: { workflowMaxCycles: 3 }, host: { receiptMode: mode } });
    t.after(() => rig.stop());
    const response = await rig.sidecar.chat({ requestId: `workflow-${mode}`, message: "rename to Hero" });
    await rig.settle();
    assert.equal(response.body.outcome, "failed", mode);
    assert.equal(jsonObject(response.body.failure, "the chat failure").code, "WORKFLOW_BATCH_BLOCKED", mode);
    assert.equal(rig.host.batches.length, 1, `uncertain ${mode} evidence must not trigger a second batch`);
    const projection = await rig.workflow();
    assert.equal(projection.jobs[0]?.status, "blocked", mode);
    assert.equal(projection.batches.length, 1, mode);
    assert.equal(projection.batches[0]?.lifecycle, "settled", mode);
    assert.deepEqual(projection.batches[0], { ...projection.batches[0], lifecycle: "settled", ...SETTLEMENT[mode] }, mode);
  }

  const lost = await startRig("blocked-lost", { sidecar: { workflowMaxCycles: 3 }, host: { receiptMode: "lost" } });
  t.after(() => lost.stop());
  const lostResponse = await lost.sidecar.chat({ requestId: "workflow-lost", message: "rename to Hero" });
  await lost.settle();
  assert.equal(lostResponse.body.outcome, "failed");
  assert.equal(jsonObject(lostResponse.body.failure, "the chat failure").code, "WORKFLOW_BATCH_BLOCKED");
  const projection = await lost.workflow();
  assert.deepEqual(projection.batches[0], { ...projection.batches[0], lifecycle: "settled", execution: "unknown", mutation: "may_have_mutated", verification: "unknown" }, "a lost write is unknown, not a failure the host reported");
});

test("workflow-v1 keeps a lost write unresolved: no continuation replays the host batch", async (t) => {
  const rig = await startRig("late-receipt", { sidecar: { workflowMaxCycles: 3 }, host: { receiptMode: "lost" } });
  t.after(() => rig.stop());
  const { sidecar, host } = rig;
  const response = await sidecar.chat({ requestId: "workflow-late-receipt", message: "rename to Hero" });
  assert.equal(response.body.outcome, "failed", JSON.stringify(response.body).slice(0, 400));
  assert.equal(host.batches.length, 1);
  const planId = required(host.batches[0]).planId;
  const lost = readEnvelope(receiptEnvelope, await sidecar.callTool("ae_get_receipt", { planId }), "the lost-write receipt").data.receipt;
  assert.equal(lost.mutationState, "unknown");
  assert.equal(jsonObject(lost.hostError, "the lost-write host error").code, "HOST_DISPATCH_UNKNOWN");

  await pause(300);
  assert.equal(host.batches.length, 1, "nothing replays the already-dispatched host batch");
  const projection = await rig.workflow();
  assert.equal(projection.jobs[0]?.status, "blocked");
  assert.equal(projection.batches.length, 1);
  assert.equal(projection.batches[0]?.mutation, "may_have_mutated");
  assert.equal(projection.batches[0]?.verification, "unknown");
  assert.deepEqual(projection.divergences, []);
});

test("workflow-v1 does not write again when the project was edited between a verified receipt and the next batch", { timeout: 15_000 }, async (t) => {
  const holder: { rig?: PluginRig; done?: boolean } = {};
  const afterMutation = (): void => {
    if (holder.done) return;
    holder.done = true;
    setTimeout(() => holder.rig?.host.editExternally((snapshot) => { const layer = snapshot.compositions[0]?.layers[1]; if (layer) layer.name = `${layer.name} (deferred edit)`; }), 0);
  };
  const rig = await startRig("deferred-edit", { sidecar: { workflowStagedCycles: true, workflowMaxCycles: 3 }, host: { afterMutation } });
  t.after(() => rig.stop());
  holder.rig = rig;
  const response = await rig.sidecar.chat({ requestId: "workflow-deferred-pairing", message: "rename to Hero" });
  assert.equal(response.status, 200);
  await rig.settle();
  const projection = await rig.workflow();
  assert.equal(projection.jobs[0]?.status, "blocked");
  assert.equal(rig.host.batches.length, 1, "the next batch was authored against a project that has since changed, so it never reaches the host");
  assert.equal(projection.batches[0]?.verification, "verified", "the first receipt stays verified against what it read back");
  assert.equal(projection.batches.length, 2, "the continuation authored one more batch and no further one");
  assert.equal(projection.batches[1]?.execution, "rejected_before_apply");
  assert.equal(projection.batches[1]?.mutation, "none");
  assert.equal(projection.jobs[0]?.blocker?.endsWith("rejected_before_apply:not_requested"), true, String(projection.jobs[0]?.blocker));
  assert.deepEqual(projection.divergences, []);
});
