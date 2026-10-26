/**
 * An approved apply runs with the reads the sidecar chose, on the native lane: no read before it when the sidecar already knew the project
 * was as it had read it, one read of the plan's composition after it, and a read of that composition before it when an edit came in between.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { makeLayer } from "@extynt/fake-plugin";
import type { FakePlugin, FixtureProject } from "@extynt/fake-plugin";
import { fieldOf } from "./http-json.js";
import { present } from "./present.js";
import { COMP, nativeProject, nativeRig, renameApply, until, type NativeRig } from "./native-rig.js";
import { batchCount, readOps } from "./owned-reads-native-support.js";

const OTHER = "comp-2";

function twoCompositions(): FixtureProject {
  const project = nativeProject(), main = present(project.compositions[0]);
  project.compositions.push({ ...main, id: OTHER, name: "Other", layers: [makeLayer("layer-9", 1, { name: "Lower third" })] });
  project.items = [...(project.items ?? []), { id: OTHER, name: "Other", type: "composition", parentFolderId: "0", compositionId: OTHER, sourceId: null }];
  project.itemCount += 1;
  return project;
}

function announcedRename(plugin: FakePlugin) {
  const apply = renameApply(plugin);
  return (...args: Parameters<typeof apply>) => {
    const reply = apply(...args);
    plugin.change({ revision: plugin.state.watch.revision ?? 0 });
    return reply;
  };
}

async function confirmLive(rig: NativeRig): Promise<void> {
  rig.plugin.still();
  await until(() => rig.sidecar.liveStamp?.revision === rig.plugin.state.watch.revision);
}

const quiet = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
const layerName = (rig: NativeRig): string | undefined => rig.plugin.state.project.compositions[0]?.layers[0]?.name;

async function setUp(t: TestContext): Promise<{ rig: NativeRig; planId: string }> {
  const rig = await nativeRig(t, { plugin: { project: twoCompositions() } });
  rig.plugin.hostCalls.set("aeApplyPlan", announcedRename(rig.plugin));
  const planId = await rig.proposeRename("Headline");
  return { rig, planId };
}

function expectVerifiedWrite(rig: NativeRig, planId: string, batches: number) {
  const record = rig.sidecar.plans.get(planId);
  assert.equal(layerName(rig), "Headline", "the plugin applied the plan");
  assert.equal(record?.status, "verified", JSON.stringify(record?.receipt?.error ?? record?.status));
  const applied = rig.batches().slice(batches);
  assert.equal(applied.length, 1, "no read before it: the sidecar already knew the project was as it had read it");
  assert.deepEqual(applied[0]?.slice(0, 3), ["watch_state", "host_call:aeApplyPlan", "watch_state"]);
}

function expectReadAfterApply(rig: NativeRig, planId: string, batches: number) {
  expectVerifiedWrite(rig, planId, batches);
  assert.deepEqual(readOps(rig.plugin, batches), [{ op: "read_comp", compId: COMP, detail: "full" }], "one scoped read after it, of the composition the plan names and no other");
  assert.equal(fieldOf(rig.sidecar.plans.get(planId)?.receipt, "afterFingerprint"), rig.sidecar.normalizedLatest()?.fingerprint, "the receipt names the merged project");
}

test("an approved apply is read once, after it, as the plan's composition only, and no read follows it", async (t) => {
  const { rig, planId } = await setUp(t);
  await confirmLive(rig);
  const batches = batchCount(rig.plugin);
  const approved = await rig.agent("ae_approve_plan", { planId, waitSeconds: 10 });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  expectReadAfterApply(rig, planId, batches);
  await quiet(500);
  assert.equal(batchCount(rig.plugin), batches + 1, "and no third read follows the apply");
});

test("an edit made between approval and apply is read first, as the plan's composition only, and the apply still goes through", async (t) => {
  const { rig, planId } = await setUp(t);
  await confirmLive(rig);
  const batches = batchCount(rig.plugin), lane = present(rig.sidecar.nativeHost).lane;
  lane.stop();
  const approved = await rig.agent("ae_approve_plan", { planId });
  assert.equal(approved.body.ok, true, JSON.stringify(approved.body));
  const edited = (rig.plugin.state.watch.revision ?? 0) + 3;
  rig.plugin.change({ revision: edited });
  await until(() => rig.sidecar.liveStamp?.revision === edited);
  lane.start();
  await until(() => rig.sidecar.plans.get(planId)?.receipt !== undefined);
  assert.equal(layerName(rig), "Headline");
  assert.equal(rig.sidecar.plans.get(planId)?.status, "verified");
  const applied = rig.batches().slice(batches);
  const writeAt = applied.findIndex((ops) => ops.includes("host_call:aeApplyPlan"));
  assert.ok(writeAt >= 1 && applied.slice(0, writeAt).every((ops) => ops[0] === "watch_state"), "the read before the apply, then the apply with the one after it");
  assert.deepEqual(fieldOf(rig.hostCallArgs("aeApplyPlan"), "expectedStamp"), { epoch: rig.plugin.state.watch.epoch, revision: edited }, "the write is guarded by the stamp the read before it saw");
  const reads = readOps(rig.plugin, batches);
  assert.ok(reads.length >= 2 && reads.every((read) => read.op === "read_comp" && read.compId === COMP), "only the plan's composition is read, and never the item list");
  await quiet(500);
  const settled = batchCount(rig.plugin);
  await quiet(500);
  assert.equal(batchCount(rig.plugin), settled, "and the sidecar comes to rest");
});
