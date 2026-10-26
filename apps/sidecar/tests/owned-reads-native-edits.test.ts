/**
 * The reads the sidecar owns, on the native lane: what it asks the plugin to read after pairing and after an edit settles, how little,
 * and when it asks for nothing. Plugin `change` and `still` events drive it, and the project the fake plugin serves is edited as a user would.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ok, refuse, toWire } from "@extynt/fake-plugin";
import { queueSnapshotRefresh } from "../src/read-queue.js";
import { startHostRig, type HostRig } from "./host-rig.js";
import { addComposition, batchCount, landFirstRead, ownedProject, readOps, renameLayer, snapshotList, snapshotMember, storedCompositions } from "./owned-reads-native-support.js";
import { censusAnswer } from "./sidecar-fixture.js";

const queued = (rig: HostRig) => rig.sidecar.agentMailbox.map((item) => item.approvedData);
const fingerprintOf = (rig: HostRig): string | undefined => rig.sidecar.normalizedLatest()?.fingerprint;

async function start(): Promise<HostRig> {
  return startHostRig({ plugin: { project: ownedProject(), hostCalls: { aeHostCensus: (args) => ok(toWire(censusAnswer(args, 3))) } } });
}

async function quiesce(rig: HostRig): Promise<string[]> {
  await rig.settle();
  rig.timers.fire();
  return rig.drain();
}

test("the first read after pairing is the whole project, with the census because the sidecar knows no inventory", async () => {
  const rig = await start();
  try {
    rig.pair();
    assert.deepEqual(queued(rig).map((item) => [item.kind, item.reason, item.read, item.includeEffects]), [["refresh_snapshot", "pair", { scope: "full" }, true]]);
    await rig.settle();
    rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["refresh_snapshot", "host_census", "host_census"]);
    assert.deepEqual(readOps(rig.plugin), [{ op: "read_project", detail: "full" }], "the one read so far is the whole-project read after pairing");
    assert.deepEqual(storedCompositions(rig).map((composition) => composition.id), ["2", "3"]);
  } finally { await rig.close(); }
});

test("an edit is read once, after its window closes, and only the composition After Effects has open", async () => {
  const rig = await start();
  try {
    await landFirstRead(rig);
    const before = fingerprintOf(rig), batches = batchCount(rig.plugin);
    for (let beat = 0; beat < 3; beat += 1) { rig.plugin.still(); assert.deepEqual(await quiesce(rig), [], "an idle project is not read"); }
    rig.plugin.change({ selection: ["201"], selectedLayers: [{ id: "201", index: 1, name: "Title" }] });
    assert.deepEqual(await quiesce(rig), [], "selecting a layer is reported, never read");
    assert.equal(batchCount(rig.plugin), batches);
    assert.deepEqual(rig.sidecar.normalizedLatest()?.selection.layerIds, ["201"], "the sidecar still knows the selection: it laid the focus over its read");

    renameLayer(rig.plugin.state.project, "2", 2, "Backdrop (edited)");
    rig.plugin.change({ revision: 101 });
    rig.plugin.still();
    await rig.settle();
    assert.deepEqual(queued(rig), [], "an edit just made is not read yet, nor a still later");
    assert.equal(batchCount(rig.plugin), batches);
    rig.timers.fire();
    assert.deepEqual(queued(rig).map((item) => [item.reason, item.read, item.includeEffects]), [["edit", { scope: "compositions", compositionIds: ["2"], includeItems: false }, undefined]]);
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.deepEqual(readOps(rig.plugin, batches), [{ op: "read_comp", compId: "2", detail: "full" }], "the other composition was not touched and the item list was not walked");

    assert.deepEqual(storedCompositions(rig), [{ id: "2", layerNames: ["Title", "Backdrop (edited)"] }, { id: "3", layerNames: ["Lower third"] }]);
    assert.equal(snapshotMember(rig, "coverage"), undefined);
    assert.notEqual(fingerprintOf(rig), before, "the edit moved the project fingerprint");
    for (let beat = 0; beat < 4; beat += 1) { rig.plugin.still(); assert.deepEqual(await quiesce(rig), []); }
    assert.equal(batchCount(rig.plugin), batches + 1, "and the same revision is never read again");
  } finally { await rig.close(); }
});

test("a bare revision change with nothing different to read costs one small read, then none: the identical read keeps the fingerprint", async () => {
  const rig = await start();
  try {
    await landFirstRead(rig);
    const before = fingerprintOf(rig), batches = batchCount(rig.plugin);
    rig.plugin.change({ revision: 107 });
    assert.deepEqual(await quiesce(rig), ["refresh_snapshot"]);
    assert.deepEqual(readOps(rig.plugin, batches), [{ op: "read_comp", compId: "2", detail: "full" }]);
    assert.equal(fingerprintOf(rig), before, "the host's revision counter is not an edit");
    for (let beat = 0; beat < 3; beat += 1) { rig.plugin.still(); assert.deepEqual(await quiesce(rig), []); }
    assert.equal(batchCount(rig.plugin), batches + 1);
  } finally { await rig.close(); }
});

test("a composition added is read with the item list, and the others are left alone", async () => {
  const rig = await start();
  try {
    await landFirstRead(rig);
    const batches = batchCount(rig.plugin);
    addComposition(rig.plugin, "4", ["New layer"]);
    rig.plugin.change({ revision: 101, items: 4, activeCompId: "4", activeCompName: "Comp 4" });
    await rig.settle();
    rig.timers.fire();
    assert.deepEqual(queued(rig).map((item) => item.read), [{ scope: "compositions", compositionIds: ["4"], includeItems: true }], "the count moved, so the item list rides along");
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"], "a composition AE shows that the snapshot lacks is read at once");
    assert.deepEqual(readOps(rig.plugin, batches), [{ op: "read_project", detail: "structure" }, { op: "read_comp", compId: "4", detail: "full" }]);
    assert.deepEqual(storedCompositions(rig).map((composition) => composition.id), ["2", "3", "4"]);
    assert.equal(snapshotList(rig, "items").length, 4);
  } finally { await rig.close(); }
});

test("a read the host refuses for its budget is not retried on its own: the error stays, the lane is free, and an explicit refresh asks again", async () => {
  const rig = await start();
  try {
    await landFirstRead(rig);
    rig.plugin.handlers.set("read_comp", () => refuse("READ_BUDGET_EXCEEDED", "Read stopped at its cooperative budget."));
    rig.plugin.change({ revision: 101 });
    assert.deepEqual(await quiesce(rig), ["refresh_snapshot"]);
    assert.equal(rig.sidecar.panel.lastError?.code, "READ_BUDGET_EXCEEDED");
    assert.equal(rig.sidecar.inFlight, undefined, "the explicit refresh stays possible");
    const asked = batchCount(rig.plugin);
    for (let beat = 0; beat < 3; beat += 1) { rig.plugin.still(); assert.deepEqual(await quiesce(rig), [], "no automatic retry"); }
    assert.equal(batchCount(rig.plugin), asked);
    queueSnapshotRefresh(rig.sidecar, { reason: "explicit", read: { scope: "full" } });
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.equal(rig.sidecar.latest?.observed?.compositions["2"], 101, "an explicit full read answers");
    assert.equal(rig.sidecar.panel.lastError, null);
  } finally { await rig.close(); }
});

test("with no project open the first read is refused with NO_PROJECT, is not retried on its own, and an explicit refresh reads once a project is open", async () => {
  const rig = await start();
  try {
    rig.plugin.handlers.set("read_project", () => refuse("NO_PROJECT", "No project is open."));
    rig.pair();
    assert.deepEqual(await quiesce(rig), ["refresh_snapshot"]);
    assert.equal(rig.sidecar.panel.lastError, null, "no project open is a state, not a fault");
    assert.ok(rig.logs.some((entry) => entry.event === "host.read-failed" && entry.fields.code === "NO_PROJECT"));
    assert.equal(rig.sidecar.latest, undefined);
    rig.plugin.still();
    assert.deepEqual(await quiesce(rig), [], "the first read is asked for again only after a long wait, never in a loop");
    rig.plugin.handlers.delete("read_project");
    queueSnapshotRefresh(rig.sidecar, { reason: "explicit", read: { scope: "full" } });
    assert.deepEqual(await rig.drain(), ["refresh_snapshot", "host_census", "host_census"], "the first read that lands after a pairing is followed by the census, and its fonts");
    assert.deepEqual(storedCompositions(rig).map((composition) => composition.id), ["2", "3"]);
  } finally { await rig.close(); }
});
