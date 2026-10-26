/** A host whose revision the plugin does not read (`capabilities.revisionGuard: "off"`, the AE 25 fallback): the sidecar guards by content fingerprint alone, end to end. */
import assert from "node:assert/strict";
import test from "node:test";
import { fieldOf } from "./http-json.js";
import { nativeRig, renameApply, type NativeRig } from "./native-rig.js";

const OFF = { aeVersion: "25.6.0 (build 41)", revisionGuard: "off" as const };

function renameWithoutRevision(rig: NativeRig): void {
  const apply = renameApply(rig.plugin);
  rig.plugin.hostCalls.set("aeApplyPlan", (args, request, plugin) => {
    const reply = apply(args, request, plugin);
    plugin.state.watch = { ...plugin.state.watch, revision: null };
    return reply;
  });
}

test("a revision-less host reports the guard off, and its reads and events carry no revision or stamp", async (t) => {
  const rig = await nativeRig(t, { plugin: OFF });
  const host = rig.sidecar.hostLink.status().host;
  assert.equal(host?.capabilities.revisionGuard, "off");
  assert.equal(rig.plugin.state.watch.revision, null);
  assert.equal(rig.sidecar.liveStamp, null);
  assert.equal(JSON.stringify(rig.sidecar.latest?.snapshot.result).includes("hostStamp"), false, "no stamp rides the stored read");
  rig.plugin.change({ projectName: "Other.aep" });
  rig.plugin.still();
  assert.equal(rig.sidecar.liveStamp, null, "change and still events never make a stamp");
  const status = await rig.agent("ae_status");
  assert.equal(fieldOf(status.body, "data.hostIdentity.capabilities.revisionGuard"), "off");
});

test("a plan proposed, approved and applied on a revision-less host is verified, and records no after-stamp", async (t) => {
  const rig = await nativeRig(t, { plugin: OFF });
  renameWithoutRevision(rig);
  const planId = await rig.proposeRename();
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  await rig.waitFor(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  const receipt = rig.sidecar.plans.get(planId)?.receipt;
  assert.equal(receipt?.postcondition, "passed", JSON.stringify(receipt));
  assert.equal(rig.sidecar.hostFacts.afterStamps.has(planId), false, "there is no revision to remember");
  assert.equal(rig.writes().length, 1);
});
