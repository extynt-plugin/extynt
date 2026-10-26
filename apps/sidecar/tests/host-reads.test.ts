/** The refresh runner against the fake plugin: the first read after a pair, incremental reads by layer hash, details for changed layers only, and what a failed read leaves behind. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, boolean, decode, decodeOrThrow, jsonValue, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { entry, makeLayer, makeProject, ok, refuse, toWire } from "@extynt/fake-plugin";
import type { FixtureProject, HostCallHandler } from "@extynt/fake-plugin";
import { queueSnapshotRefresh } from "../src/read-queue.js";
import { stampOf } from "../src/snapshot-merge.js";
import { present } from "./present.js";
import { censusAnswer } from "./sidecar-fixture.js";
import { hashedProject, startHostRig, type HostRig } from "./host-rig.js";

const TEXT = "ADBE Text Properties/ADBE Text Document";
const scopeRows = object({ scopes: array(object({ compId: string(), layerIds: optional(array(string())) })) });
type Scopes = Array<Infer<typeof scopeRows>["scopes"]>;
const batchOps = array(object({ op: string(), detail: optional(string()), hashes: optional(boolean()) }));
const snapshotLayers = array(object({ layers: array(object({ id: string(), name: string(), propertyPaths: array(object({ path: string(), value: optional(jsonValue), keyDigest: optional(string()) })) })) }));
const firstComposition = (project: FixtureProject) => present(project.compositions[0], "a composition");
const scopesOf = (args: Parameters<HostCallHandler>[0]) => {
  const decoded = decode(scopeRows, args);
  return decoded.ok ? decoded.value.scopes : [];
};
const textLayer = (id: string, index: number, hash: string, name: string) => makeLayer(id, index, { hash, name, propertyPaths: [entry(TEXT, { matchName: "ADBE Text Document", valueType: "text-document", value: { unsupported: "text-document" } }), entry("ADBE Transform Group/ADBE Opacity", { value: 100 })] });

const POSITION = "ADBE Transform Group/ADBE Position";
const keyedLayer = (id: string, index: number, hash: string, name: string) => makeLayer(id, index, { hash, name, propertyPaths: [entry(POSITION, { valueType: "vector", value: [1, 1], keyframeCount: 2 }), entry("ADBE Transform Group/ADBE Opacity", { value: 100 })] });

function keyedProject(): FixtureProject {
  const project = makeProject();
  firstComposition(project).layers = [keyedLayer("11", 1, "h11-a", "Title"), keyedLayer("12", 2, "h12-a", "Back")];
  return project;
}

function textProject(): FixtureProject {
  const project = makeProject();
  firstComposition(project).layers = [textLayer("11", 1, "h11-a", "Title"), textLayer("12", 2, "h12-a", "Back")];
  return project;
}

function detailsHost(asked: Scopes): HostCallHandler {
  return (args) => {
    const scopes = scopesOf(args);
    asked.push(scopes);
    return ok(toWire({ ok: true, layers: scopes.flatMap((scope) => (scope.layerIds ?? []).map((layerId) => ({ compId: scope.compId, layerId, properties: [{ path: TEXT, value: { text: `text of ${layerId}` } }, { path: POSITION, keyDigest: `2:2:${layerId}`, keyframeCount: 2 }] }))) }));
  };
}

async function start(project: FixtureProject, asked: Scopes = []): Promise<HostRig> {
  return startHostRig({ plugin: { project, hostCalls: { aeReadPropertyDetails: detailsHost(asked), aeHostCensus: (args) => ok(toWire(censusAnswer(args, 3))) } } });
}

const layerRows = (rig: HostRig) => present(decodeOrThrow(snapshotLayers, present(rig.sidecar.latest, "a stored snapshot").snapshot.result.compositions)[0], "a composition").layers;
const layerOf = (rig: HostRig, layerId: string) => present(layerRows(rig).find((layer) => layer.id === layerId), `layer ${layerId}`);
const propertyOf = (rig: HostRig, layerId: string, path: string) => present(layerOf(rig, layerId).propertyPaths.find((property) => property.path === path), path);
const textOf = (rig: HostRig, layerId: string) => propertyOf(rig, layerId, TEXT).value;

test("the first read after a pair is one full hashed read, with details, and the census follows it", async () => {
  const asked: Scopes = [];
  const rig = await start(textProject(), asked);
  try {
    rig.pair();
    await rig.settle(); rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["refresh_snapshot", "host_census", "host_census"], "the effects census comes after the first read, the fonts when the lane is idle");
    assert.equal(rig.sidecar.hostFacts.fonts.phase, "ready");
    const batch = decodeOrThrow(batchOps, present(rig.plugin.requestsFor("batch")[0], "a batch request").body.ops);
    assert.deepEqual(batch.map((op) => [op.op, op.detail, op.hashes]), [["watch_state", undefined, undefined], ["read_project", "full", true]]);
    assert.equal(rig.sidecar.awaitingFreshSnapshotAfterPair, false);
    assert.deepEqual(asked, [[{ compId: "5", layerIds: ["11", "12"] }]], "every layer is new, so every layer that needs details is asked for");
    assert.deepEqual(textOf(rig, "11"), { text: "text of 11" }, "the text document comes from the details call, not the plugin");
    assert.equal(rig.sidecar.inventory?.items.length, 3, "the census landed");
    assert.deepEqual(stampOf(present(rig.sidecar.latest, "a stored snapshot").snapshot), { epoch: 1, revision: 100 });
  } finally { await rig.close(); }
});

const keyDigestOf = (rig: HostRig, layerId: string) => propertyOf(rig, layerId, POSITION).keyDigest;

test("a scoped read asks for details only for the layers whose hash changed, and keeps the other layer's row", async () => {
  const asked: Scopes = [];
  const project = keyedProject(), rig = await start(project, asked);
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    asked.length = 0;
    const layers = firstComposition(project).layers;
    layers[1] = keyedLayer("12", 2, "h12-b", "Back renamed");
    rig.plugin.change({ revision: 101 });
    await rig.settle(); rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.deepEqual(asked, [[{ compId: "5", layerIds: ["12"] }]], "layer 11 did not change: its details are not fetched again");
    assert.equal(layerOf(rig, "12").name, "Back renamed");
    assert.equal(keyDigestOf(rig, "11"), "2:2:11", "the unchanged layer keeps the row it had, details included");
    assert.equal(keyDigestOf(rig, "12"), "2:2:12");
    assert.equal(rig.sidecar.latest?.observed?.compositions["5"], 101);
  } finally { await rig.close(); }
});

test("when nothing in the composition changed, no details are fetched at all", async () => {
  const asked: Scopes = [];
  const rig = await start(keyedProject(), asked);
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    asked.length = 0;
    rig.plugin.change({ revision: 101 });
    await rig.settle(); rig.timers.fire(); await rig.drain();
    assert.deepEqual(asked, []);
    assert.equal(rig.sidecar.latest?.observed?.compositions["5"], 101, "the revision is still recorded");
  } finally { await rig.close(); }
});

test("a text layer is asked again after any edit even when its hash is unchanged, because the hash cannot see text styling", async () => {
  const asked: Scopes = [];
  const rig = await start(textProject(), asked);
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    asked.length = 0;
    rig.plugin.change({ revision: 101 });
    await rig.settle(); rig.timers.fire(); await rig.drain();
    assert.deepEqual(asked, [[{ compId: "5", layerIds: ["11", "12"] }]]);
  } finally { await rig.close(); }
});

test("a read the host refuses is the host's last error, releases the lane, and the scheduler looks again", async () => {
  const rig = await start(hashedProject());
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    rig.plugin.handlers.set("read_comp", () => refuse("HOST_ERROR", "AEGP failed", 5027));
    rig.plugin.change({ revision: 101 });
    await rig.settle(); rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.equal(rig.sidecar.panel.lastError?.code, "HOST_ERROR");
    assert.equal(rig.sidecar.inFlight, undefined);
    assert.ok(rig.logs.some((entry) => entry.event === "host.read-failed"));
    assert.equal(rig.sidecar.latest?.observed?.compositions["5"], 100, "the snapshot was not replaced by a failed read");
  } finally { await rig.close(); }
});

test("a composition deleted since the snapshot is dropped by the read that no longer finds it", async () => {
  const project = hashedProject(), rig = await start(project);
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    project.compositions = []; project.items = (project.items ?? []).filter((item) => item.type !== "composition"); project.itemCount = 2;
    rig.plugin.handlers.set("read_comp", () => refuse("COMP_NOT_FOUND", "gone"));
    rig.plugin.change({ revision: 101, items: 2, activeCompId: null, activeCompName: null });
    await rig.settle(); rig.timers.fire();
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.equal(rig.sidecar.panel.lastError, null, "a missing composition is not a failure");
    assert.equal(layerCount(rig), 0);
  } finally { await rig.close(); }
});

const layerCount = (rig: HostRig) => present(rig.sidecar.latest, "a stored snapshot").snapshot.result.compositions.length;

test("details that cannot be had do not fail the read, and the next read asks again because nothing was remembered", async () => {
  const project = textProject(), rig = await start(project);
  try {
    const asked: Scopes = [];
    rig.plugin.hostCalls.set("aeReadPropertyDetails", (args) => { asked.push(scopesOf(args)); return refuse("LIBRARY_LOAD_FAILED", "no library"); });
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    assert.ok(rig.sidecar.latest, "the read landed without the text documents");
    assert.equal(textOf(rig, "11"), null, "unknown, not invented");
    assert.ok(rig.logs.some((entry) => entry.event === "host.details-failed"));
    rig.plugin.change({ revision: 101 });
    await rig.settle(); rig.timers.fire(); await rig.drain();
    assert.equal(asked.length, 2, "an incomplete read leaves no hash index behind, so every layer is asked about again");
  } finally { await rig.close(); }
});

test("a scoped read that cannot be placed on the stored snapshot is answered by the full read the receiver queued", async () => {
  const rig = await start(hashedProject());
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    rig.sidecar.latest = undefined;
    queueSnapshotRefresh(rig.sidecar, { reason: "gate", read: { scope: "compositions", compositionIds: ["5"], includeItems: false } });
    assert.deepEqual(await rig.drain(), ["refresh_snapshot", "refresh_snapshot"], "the scoped read, then the full read it asked for");
    assert.ok(rig.logs.some((entry) => entry.event === "host.read-refused" && entry.fields.code === "READ_NEEDS_FULL"));
    assert.equal(rig.sidecar.panel.lastError, null, "that is the protocol working, not a fault");
    assert.ok(rig.sidecar.latest, "the full read that followed landed");
  } finally { await rig.close(); }
});
