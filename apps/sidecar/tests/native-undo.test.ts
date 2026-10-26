/** undo_plan through the native host lane: one batch when the stamp is standing, a guard read first when it is not, and the host's own refusal. */
import assert from "node:assert/strict";
import test from "node:test";
import { ok } from "@extynt/fake-plugin";
import { fieldOf } from "./http-json.js";
import { nativeRig, until, type NativeRig } from "./native-rig.js";

async function applied(rig: NativeRig): Promise<string> {
  const planId = await rig.proposeRename();
  rig.setLive();
  await rig.agent("ae_approve_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(rig.sidecar.plans.get(planId)?.receipt?.postcondition, "passed");
  return planId;
}

test("an undo whose stamp still stands is one batch guarded by that stamp, and the plan reads as undone", async (t) => {
  const rig = await nativeRig(t);
  const planId = await applied(rig);
  rig.setLive();
  const before = rig.batches().length;
  const requested = await rig.agent("ae_undo_plan", { planId });
  assert.equal(requested.body.ok, true, JSON.stringify(requested.body));
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  const batches = rig.batches().slice(before);
  assert.equal(batches.length, 1, "no guard read: the host checks the stamp in the same turn");
  assert.deepEqual(batches[0]?.slice(0, 3), ["watch_state", "host_call:aeUndoPlan", "watch_state"]);
  assert.deepEqual(fieldOf(rig.hostCallArgs("aeUndoPlan"), "expectedStamp"), { epoch: rig.plugin.state.watch.epoch, revision: (rig.plugin.state.watch.revision ?? 0) - 1 });
  assert.equal(rig.sidecar.plans.get(planId)?.status, "undone", JSON.stringify(rig.sidecar.plans.get(planId)?.undoReceipt));
});

test("an undo without a standing stamp reads the project first and guards the undo with the stamp it read", async (t) => {
  const rig = await nativeRig(t);
  const planId = await applied(rig);
  rig.sidecar.liveStamp = null;
  const before = rig.batches().length;
  await rig.agent("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  const batches = rig.batches().slice(before);
  assert.equal(batches.length, 2, "a guard read, then the undo");
  assert.equal(batches[0]?.includes("host_call:aeUndoPlan"), false);
  assert.equal(fieldOf(rig.hostCallArgs("aeUndoPlan"), "expectedStamp.revision"), rig.plugin.state.watch.revision === null ? undefined : (rig.plugin.state.watch.revision ?? 0) - 1);
  assert.equal(rig.sidecar.plans.get(planId)?.status, "undone");
});

test("a project edited since the apply is refused at the guard, and nothing is undone", async (t) => {
  const rig = await nativeRig(t);
  const planId = await applied(rig);
  rig.sidecar.liveStamp = null;
  const layer = rig.plugin.state.project.compositions[0]?.layers[0];
  if (layer) layer.name = "Edited since";
  await rig.agent("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  assert.equal(fieldOf(rig.sidecar.plans.get(planId)?.undoReceipt, "hostError.code"), "UNDO_PROJECT_CHANGED");
  assert.deepEqual(rig.writes(), ["aeApplyPlan"], "the undo was never sent");
});

test("the host refusing a stale undo stamp is a rejected receipt that points to Edit > Undo", async (t) => {
  const rig = await nativeRig(t);
  const planId = await applied(rig);
  rig.plugin.hostCalls.set("aeUndoPlan", () => ok(JSON.stringify({ ok: false, mayHaveMutated: false, mutationState: "not-applied", error: { code: "UNDO_PROJECT_CHANGED", message: "The project changed since the stamp was taken." } })));
  rig.setLive();
  await rig.agent("ae_undo_plan", { planId });
  await until(() => rig.sidecar.plans.get(planId)?.undoReceipt !== undefined);
  const receipt = rig.sidecar.plans.get(planId)?.undoReceipt;
  assert.equal(receipt?.status, "rejected");
  assert.match(String(fieldOf(receipt, "hostError.message")), /Edit > Undo/);
  assert.equal(rig.sidecar.plans.get(planId)?.status, "verified");
});
