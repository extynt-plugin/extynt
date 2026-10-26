/** An apply that ran must leave its plan in a terminal state with a plain message, whatever the sidecar thought of the receipt. */
import assert from "node:assert/strict";
import test from "node:test";
import { fieldOf } from "./http-json.js";
import { COMP, LAYER, nativeRig, renameApply, until, type NativeRig } from "./native-rig.js";

async function workflowPlan(rig: NativeRig): Promise<string> {
  const created = await rig.agent("ae_plan_create", { summary: "Rename the layer" });
  const planId = String(fieldOf(created.body, "data.planId"));
  await rig.agent("ae_plan_add", { planId, operations: [{ type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name: "Renamed" }] });
  assert.equal((await rig.agent("ae_plan_complete", { planId })).body.ok, true);
  assert.equal(rig.sidecar.queueReadyPlan({ planId, operationCount: 1 }, { requestId: "turn-1", autoApply: false }).queued, true);
  return planId;
}

function expectAppliedUnverified(rig: NativeRig, planId: string) {
  const record = rig.sidecar.plans.get(planId);
  assert.equal(rig.plugin.state.project.compositions[0]?.layers[0]?.name, "Renamed", "the write ran");
  assert.equal(fieldOf(record?.receipt, "error.code") === "RECEIPT_LOST", false, JSON.stringify(record?.receipt));
  assert.equal(record?.status, "applied_unverified", "applied, and honest that its evidence was not accepted");
  assert.equal(record?.receipt?.postcondition, "verification_unavailable");
}

function expectSettledDespiteReceipt(rig: NativeRig, planId: string) {
  expectAppliedUnverified(rig, planId);
  assert.equal(rig.sidecar.inFlight, undefined, "the lane is free");
  const batch = rig.sidecar.workflowCoordinator.batchForPlan(planId);
  assert.equal(batch?.lifecycle, "settled");
  assert.equal(batch?.execution.state, "executed");
}

test("a host that reports several undo groups for an applied workflow plan still settles it, not RECEIPT_LOST", async (t) => {
  const rig = await nativeRig(t);
  rig.plugin.hostCalls.set("aeApplyPlan", renameApply(rig.plugin, { undoGroups: 2 }));
  const planId = await workflowPlan(rig);
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined && rig.sidecar.inFlight === undefined, 6000);
  expectSettledDespiteReceipt(rig, planId);
});
