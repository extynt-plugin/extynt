/** `ae_propose_plan { apply: true }`: one call proposes, approves (same gates as ae_approve_plan) and returns the receipt. */
import assert from "node:assert/strict";
import test from "node:test";
import { fieldOf } from "./http-json.js";
import { COMP, LAYER, nativeRig, until, type NativeRig } from "./native-rig.js";

const rename = (name: string) => ({ summary: `Rename to ${name}`, operations: [{ type: "set_layer_name", target: { compositionId: COMP, layerId: LAYER }, name }] });

function regressRename(rig: NativeRig): void {
  rig.sidecar.runtimeEvidence.hosts["25.0 (?) macOS/arm64"] = { set_layer_name: { count: 0, lastVerifiedAt: "", hostVersion: "test", lastFailedAt: "2026-01-01T00:00:00.000Z", failures: 1, lastFailureBasis: "read-back-mismatch" } };
}

test("propose with apply approves in the same call and returns the receipt", async (t) => {
  const rig = await nativeRig(t);
  const applied = await rig.agent("ae_propose_plan", { ...rename("Once"), apply: true, waitSeconds: 10 });
  assert.equal(applied.body.ok, true, JSON.stringify(applied.body));
  const planId = String(fieldOf(applied.body, "data.planId"));
  assert.equal(fieldOf(applied.body, "data.apply.approved"), true);
  assert.equal(fieldOf(applied.body, "data.status"), "verified");
  assert.equal(fieldOf(applied.body, "data.apply.status"), "verified");
  assert.ok(fieldOf(applied.body, "data.apply.receipt"), "the receipt rides on the one result");
  assert.equal(rig.sidecar.plans.get(planId)?.status, "verified");
  assert.equal(rig.writes().filter((entry) => entry === "aeApplyPlan").length, 1);
});

test("an unacknowledged unverified plan is proposed, not applied, and the refusal names the planId to approve", async (t) => {
  const rig = await nativeRig(t);
  regressRename(rig);
  const refused = await rig.agent("ae_propose_plan", { ...rename("Held"), apply: true });
  assert.equal(refused.body.ok, true, JSON.stringify(refused.body));
  const planId = String(fieldOf(refused.body, "data.planId"));
  assert.equal(fieldOf(refused.body, "data.apply.approved"), false);
  assert.equal(fieldOf(refused.body, "data.apply.refusal.code"), "UNVERIFIED_OPERATIONS");
  assert.equal(rig.sidecar.plans.get(planId)?.status, "prepared");
  assert.equal(rig.writes().length, 0, "nothing was applied");
  assert.equal(rig.sidecar.agentMailbox.length, 0, "nothing was queued");
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.body.ok, true, "the client can still approve it by id");
});

test("acknowledgeUnverified:true on a propose with apply applies the unverified plan", async (t) => {
  const rig = await nativeRig(t);
  regressRename(rig);
  const applied = await rig.agent("ae_propose_plan", { ...rename("Acked"), apply: true, acknowledgeUnverified: true, waitSeconds: 10 });
  assert.equal(applied.body.ok, true, JSON.stringify(applied.body));
  assert.equal(fieldOf(applied.body, "data.apply.approved"), true);
  assert.ok(fieldOf(applied.body, "data.apply.receipt"));
});

test("with After Effects offline a propose with apply queues nothing and proposes nothing", async (t) => {
  const rig = await nativeRig(t);
  rig.plugin.hostClosing();
  await until(() => rig.sidecar.hostLink.status().state === "offline");
  const refused = await rig.agent("ae_propose_plan", { ...rename("Offline"), apply: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error?.code, "HOST_OFFLINE");
  assert.equal(rig.sidecar.agentMailbox.length, 0);
  assert.equal([...rig.sidecar.plans.values()].length, 0);
});

test("a plain propose is unchanged: it proposes and waits for approval", async (t) => {
  const rig = await nativeRig(t);
  const proposed = await rig.agent("ae_propose_plan", rename("Plain"));
  assert.equal(proposed.body.ok, true);
  assert.equal(fieldOf(proposed.body, "data.status"), "prepared");
  assert.equal(fieldOf(proposed.body, "data.apply"), undefined);
  assert.equal(rig.writes().length, 0);
});

test("a plan refused as stale inside a propose with apply is withdrawn, never left as a pending Apply", async (t) => {
  const rig = await nativeRig(t);
  rig.sidecar.hostFacts.capturePlan = (planId) => {
    const record = rig.sidecar.plans.get(planId);
    if (record) record.plan = { ...record.plan, snapshotFingerprint: "moved-on" };
    return false;
  };
  const refused = await rig.agent("ae_propose_plan", { ...rename("Stale"), apply: true });
  assert.equal(refused.body.ok, true, JSON.stringify(refused.body));
  const planId = String(fieldOf(refused.body, "data.planId"));
  assert.equal(fieldOf(refused.body, "data.apply.approved"), false);
  assert.equal(fieldOf(refused.body, "data.apply.refusal.code"), "STALE_SNAPSHOT");
  assert.equal(fieldOf(refused.body, "data.apply.cancelled"), true);
  assert.equal(fieldOf(refused.body, "data.status"), "cancelled");
  assert.equal(rig.sidecar.plans.get(planId)?.status, "cancelled");
  assert.equal(rig.writes().length, 0, "nothing was applied");
});

test("an acknowledgement refusal still leaves the proposal standing to approve by id", async (t) => {
  const rig = await nativeRig(t);
  regressRename(rig);
  const refused = await rig.agent("ae_propose_plan", { ...rename("Kept"), apply: true });
  assert.equal(fieldOf(refused.body, "data.apply.cancelled"), undefined);
  assert.equal(rig.sidecar.plans.get(String(fieldOf(refused.body, "data.planId")))?.status, "prepared");
});
