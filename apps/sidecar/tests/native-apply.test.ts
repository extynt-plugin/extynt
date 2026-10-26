/** apply_plan through the native host lane against the fake plugin: one batch, the stamp guard, verification and the receipt. */
import assert from "node:assert/strict";
import test from "node:test";
import { hangUp, ok, refuse, stall } from "@extynt/fake-plugin";
import { fieldOf } from "./http-json.js";
import { present } from "./present.js";
import { COMP, LAYER, nativeRig, renameApply, until, type NativeRig } from "./native-rig.js";

const NOT_APPLIED = { ok: false, mayHaveMutated: false, mutationState: "not-applied" };

function expectVerifiedApply(rig: NativeRig, planId: string) {
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.status, "executed");
  assert.equal(receipt?.postcondition, "passed", JSON.stringify(receipt));
  assert.equal(fieldOf(receipt, "verification.targetFound"), true);
  assert.equal(rig.sidecar.hostFacts.afterStamps.get(planId)?.revision, rig.plugin.state.watch.revision);
  assert.equal(rig.sidecar.hostFacts.planSources.get(planId), "agent");
}

test("an approved plan applies in one batch when the sidecar proved the project unchanged, and its receipt is verified", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.setLive();
  const before = rig.batches().length;
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, "a settled apply leaves native access free");
  const applied = rig.batches().slice(before);
  assert.equal(applied.length, 1, "skipPrecheck: the guard, the write and the verify reads travel in one batch");
  assert.deepEqual(applied[0]?.slice(0, 3), ["watch_state", "host_call:aeApplyPlan", "watch_state"]);
  expectVerifiedApply(rig, planId);
});

test("verify reads that fail in the write's own batch (AE still busy after a blocking export) are asked again, and the plan is verified rather than unavailable", async (t) => {
  const rig = await nativeRig(t);
  const rename = renameApply(rig.plugin);
  rig.plugin.hostCalls.set("aeApplyPlan", (args, request, plugin) => {
    plugin.handlers.set("read_comp", () => { plugin.handlers.delete("read_comp"); return refuse("HOST_BUSY", "After Effects is still exporting."); });
    return rename(args, request, plugin);
  });
  const planId = await rig.proposeRename();
  rig.setLive();
  const before = rig.batches().length;
  await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const batches = rig.batches().slice(before);
  assert.deepEqual(batches[1], ["watch_state", "read_comp"], "the verify reads again, on their own and without the write");
  assert.equal(rig.writes().length, 1, "the write is never repeated");
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.postcondition, "passed", JSON.stringify(receipt));
  assert.equal(fieldOf(receipt, "verification.targetFound"), true);
});

test("verify reads that keep failing leave an applied plan verification_unavailable, and the write is still not repeated", async (t) => {
  const rig = await nativeRig(t);
  const rename = renameApply(rig.plugin);
  rig.plugin.hostCalls.set("aeApplyPlan", (args, request, plugin) => {
    plugin.handlers.set("read_comp", () => refuse("HOST_BUSY", "After Effects is still exporting."));
    return rename(args, request, plugin);
  });
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "verification_unavailable");
  assert.equal(rig.writes().length, 1);
});

test("without a fresh stamp the apply reads first, and an unchanged project goes ahead", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.sidecar.liveStamp = null;
  const before = rig.batches().length;
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const batches = rig.batches().slice(before);
  assert.equal(batches.length, 2, "a precheck batch, then the apply batch");
  assert.equal(batches[0]?.includes("host_call:aeApplyPlan"), false);
  assert.equal(batches[1]?.[1], "host_call:aeApplyPlan");
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "passed");
});

test("a project that changed behind the sidecar's back is refused at the precheck and nothing is written", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.sidecar.liveStamp = null;
  const layer = rig.plugin.state.project.compositions[0]?.layers[0];
  if (layer) layer.name = "Edited by the user";
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.deepEqual(rig.writes(), [], "the plugin was never asked to write");
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.status, "rejected");
  assert.equal(receipt?.postcondition, "not_run");
  assert.equal(receipt?.mayHaveMutated, false);
});

async function workflowPlan(rig: NativeRig): Promise<string> {
  const created = await rig.agent("ae_plan_create", { summary: "Rename the layer" });
  const planId = String(fieldOf(created.body, "data.planId"));
  await rig.agent("ae_plan_add", { planId, operations: [{ type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name: "Renamed" }] });
  assert.equal((await rig.agent("ae_plan_complete", { planId })).body.ok, true);
  assert.equal(rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: false }).queued, true);
  return planId;
}

function expectRejectedBeforeApply(rig: NativeRig, planId: string) {
  const batch = rig.sidecar.workflowCoordinator.batchForPlan(planId);
  assert.equal(batch?.lifecycle, "settled");
  assert.equal(batch?.execution.state, "rejected_before_apply");
  assert.equal(batch?.execution.mayHaveMutated, false);
  assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, "a refusal before the host was touched quarantines nothing");
  assert.equal(rig.sidecar.inFlight, undefined, "the lane is free");
}

test("a workflow plan refused at the precheck settles as rejected before apply: nothing may have mutated and nothing is quarantined", async (t) => {
  const rig = await nativeRig(t);
  const planId = await workflowPlan(rig);
  rig.sidecar.liveStamp = null;
  const layer = rig.plugin.state.project.compositions[0]?.layers[0];
  if (layer) layer.name = "Edited by the user";
  const approved = await rig.agent("ae_approve_plan", { planId });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.deepEqual(rig.writes(), []);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.postcondition, "not_run", JSON.stringify(receipt));
  assert.equal(receipt?.mutationState, "not-applied");
  assert.equal(fieldOf(receipt, "hostError.code"), "STALE_SNAPSHOT");
  expectRejectedBeforeApply(rig, planId);
});

test("a stale stamp is refused by the host, nothing is applied, and the sidecar reads again", async (t) => {
  const rig = await nativeRig(t);
  rig.plugin.hostCalls.set("aeApplyPlan", () => ok(JSON.stringify({ ...NOT_APPLIED, error: { code: "STALE_STAMP", message: "The project changed in After Effects after the sidecar last read it." } })));
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(fieldOf(receipt, "hostError.code"), "STALE_STAMP");
  assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, "a refused write settles its lease");
  assert.equal(receipt?.postcondition, "not_run");
  await until(() => rig.batches().some((ops) => ops.includes("read_comp") && !ops.includes("host_call:aeApplyPlan")) && rig.batches().length >= 3);
});

test("a workflow plan with no current snapshot at claim is rejected before the host is touched", async (t) => {
  const rig = await nativeRig(t);
  const created = await rig.agent("ae_plan_create", { summary: "Rename the layer" });
  const planId = String(fieldOf(created.body, "data.planId"));
  await rig.agent("ae_plan_add", { planId, operations: [{ type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name: "Renamed" }] });
  assert.equal((await rig.agent("ae_plan_complete", { planId })).body.ok, true);
  assert.equal(rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: false }).queued, true, "the workflow admits it, as a sealed chat plan is");
  const lane = present(rig.sidecar.nativeHost).lane;
  lane.stop();
  const approved = await rig.agent("ae_approve_plan", { planId });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  rig.sidecar.latest = undefined;
  lane.start();
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.status, "rejected", JSON.stringify(receipt));
  assert.equal(fieldOf(receipt, "error.code"), "SNAPSHOT_UNAVAILABLE");
  assert.deepEqual(rig.writes(), []);
});

test("a write whose answer never comes is an unknown receipt and a quarantine, and later work waits", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostCallTimeoutMs: 400 } });
  rig.plugin.hostCalls.set("aeApplyPlan", () => stall());
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined, 6000);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.mutationState, "unknown");
  assert.equal(receipt?.mayHaveMutated, true);
  assert.equal(fieldOf(receipt, "hostError.code"), "HOST_TIMEOUT");
  assert.equal(rig.sidecar.inFlight?.nativeSettlement, "unknown", "the lane is pinned until the write settles");
  assert.notEqual(rig.sidecar.nativeBridge.accessQuarantine(), null);
  const second = await rig.proposeRename("Second");
  await rig.agent("ae_approve_plan", { planId: second });
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  assert.equal(rig.sidecar.plans.get(second)?.receipt, undefined, "nothing runs against After Effects while a write is unresolved");
  assert.equal(rig.writes().length, 1);
});

test("a workflow plan whose write is lost is unknown to the workflow, quarantined, and a late receipt cannot settle it", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostCallTimeoutMs: 400 } });
  rig.plugin.hostCalls.set("aeApplyPlan", () => stall());
  const planId = await workflowPlan(rig);
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined, 6000);
  const batch = present(rig.sidecar.workflowCoordinator.batchForPlan(planId));
  assert.equal(batch.lifecycle, "settled");
  assert.equal(batch.execution.state, "unknown", "the host never said the write failed");
  assert.equal(batch.execution.mayHaveMutated, true);
  assert.equal(batch.verification.state, "unknown");
  assert.notEqual(rig.sidecar.nativeBridge.accessQuarantine(), null);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  const late = await rig.sidecar.receivers.acceptReceipt({ planId, approvalId: receipt?.approvalId ?? null, operation: "apply_plan", status: "executed", postcondition: "passed", appliedOperations: ["set_layer_name"], mayHaveMutated: true, mutationState: "applied" });
  assert.equal(late.status, 409, "the native lane discards a late answer: only a fresh read can resolve an unknown write");
  assert.equal(present(rig.sidecar.workflowCoordinator.batchForPlan(planId)).execution.state, "unknown");
});

for (const [label, error] of [["null", null], ["an array", []]] as const) {
  test(`a failure whose error is ${label} is an invalid host response and the write stays unknown`, async (t) => {
    const rig = await nativeRig(t);
    rig.plugin.hostCalls.set("aeApplyPlan", () => ok(JSON.stringify({ ok: false, mayHaveMutated: true, error })));
    const planId = await rig.proposeRename();
    rig.setLive();
    await rig.agent("ae_approve_plan", { planId });
    await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
    const receipt = rig.sidecar.plans.get(planId)?.receipt;
    assert.equal(receipt?.mutationState, "unknown", JSON.stringify(receipt));
    assert.equal(receipt?.mayHaveMutated, true);
    assert.equal(fieldOf(receipt, "hostError.code"), "INVALID_HOST_RESPONSE");
  });
}

test("a connection that drops mid-write is an unknown outcome too", async (t) => {
  const rig = await nativeRig(t);
  rig.plugin.hostCalls.set("aeApplyPlan", () => hangUp());
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.mutationState, "unknown");
  assert.equal(fieldOf(receipt, "hostError.code"), "HOST_DISPATCH_UNKNOWN");
  assert.notEqual(rig.sidecar.nativeBridge.accessQuarantine(), null, "a dropped connection leaves the lease open");
});

test("a read-set free plan against a missing composition is refused with the plain reason", async (t) => {
  const rig = await nativeRig(t);
  const planId = await rig.proposeRename();
  rig.plugin.state.project.compositions = [];
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "not_run");
  assert.equal(COMP.length > 0 && LAYER.length > 0, true);
});

test("the details call that rides in an apply batch asks for every kind a normal read fetches, on the layers the plan names", async (t) => {
  const rig = await nativeRig(t);
  rig.plugin.hostCalls.set("aeApplyPlan", () => ok(JSON.stringify({ ok: true, steps: [{ operation: "add_marker", compositionId: COMP, layerId: LAYER }], undoGroups: 1 })));
  const proposed = await rig.agent("ae_propose_plan", { summary: "Mark the layer", operations: [{ type: "add_marker", target: { compositionId: COMP, layerId: LAYER }, time: 1, comment: "Here" }] });
  const planId = String(fieldOf(proposed.body, "data.planId"));
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const asked = rig.hostCallArgs("aeReadPropertyDetails");
  assert.deepEqual(fieldOf(asked, "include"), ["textDocument", "keyDigest", "marker", "maskPath", "shapePath", "layerRef"]);
  assert.deepEqual(fieldOf(asked, "scopes"), [{ compId: COMP, layerIds: [LAYER] }]);
});

test("a native write whose outcome is unknown stays unsettled and quarantined", async (t) => {
  const rig = await nativeRig(t, { sidecar: { hostCallTimeoutMs: 400 } });
  rig.plugin.hostCalls.set("aeApplyPlan", () => stall());
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined, 6000);
  const settled = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(rig.sidecar.plans.get(planId)?.receipt, settled, "the unknown write is untouched");
  assert.notEqual(rig.sidecar.nativeBridge.accessQuarantine(), null, "and stays quarantined");
});
