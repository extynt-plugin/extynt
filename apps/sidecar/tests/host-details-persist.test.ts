/** A pair after a restart against the fake plugin: details come from the persisted store only when the store can vouch for them, and the project reads as it would cold. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { array, decode, decodeOrThrow, jsonValue, object, optional, string } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { entry, makeLayer, makeProject, ok, toWire } from "@extynt/fake-plugin";
import type { FixtureProject, HostCallHandler } from "@extynt/fake-plugin";
import { createDetailsStore, DETAILS_STORE_FILE } from "../src/host/details-store.js";
import { freshSchedulerMemory } from "../src/read-scheduler.js";
import { present } from "./present.js";
import { hostCensus } from "./sidecar-fixture.js";
import { startHostRig, type HostRig } from "./host-rig.js";

const TEXT = "ADBE Text Properties/ADBE Text Document";
const scopeRows = object({ scopes: array(object({ compId: string(), layerIds: optional(array(string())) })) });
type Scopes = Array<Infer<typeof scopeRows>["scopes"]>;
const snapshotText = array(object({ layers: array(object({ id: string(), propertyPaths: array(object({ path: string(), value: optional(jsonValue) })) })) }));
const textLayer = (id: string, index: number, hash: string, name: string) => makeLayer(id, index, { hash, name, propertyPaths: [entry(TEXT, { matchName: "ADBE Text Document", valueType: "text-document", value: { unsupported: "text-document" } }), entry("ADBE Transform Group/ADBE Opacity", { value: 100 })] });

const POSITION = "ADBE Transform Group/ADBE Position";
const keyedLayer = (id: string, index: number, hash: string, name: string) => makeLayer(id, index, { hash, name, propertyPaths: [entry(POSITION, { valueType: "vector", value: [1, 1], keyframeCount: 2 }), entry("ADBE Transform Group/ADBE Opacity", { value: 100 })] });

const firstComposition = (project: FixtureProject) => present(project.compositions[0], "a composition");

function keyedProject(): FixtureProject {
  const project = makeProject();
  firstComposition(project).layers = [keyedLayer("11", 1, "h11-a", "Title"), keyedLayer("12", 2, "h12-a", "Back")];
  return project;
}

function textProject(filePath?: string): FixtureProject {
  const project = makeProject();
  firstComposition(project).layers = [textLayer("11", 1, "h11-a", "Title"), textLayer("12", 2, "h12-a", "Back")];
  if (filePath) project.project.filePath = filePath;
  return project;
}

function start(project: FixtureProject, asked: Scopes): Promise<HostRig> {
  const details: HostCallHandler = (args) => {
    const decoded = decode(scopeRows, args), scopes = decoded.ok ? decoded.value.scopes : [];
    asked.push(scopes);
    return ok(toWire({ ok: true, layers: scopes.flatMap((scope) => (scope.layerIds ?? []).map((layerId) => ({ compId: scope.compId, layerId, properties: [{ path: TEXT, value: { text: `text of ${layerId}` } }, { path: POSITION, keyDigest: `2:2:${layerId}`, keyframeCount: 2 }] }))) }));
  };
  return startHostRig({ plugin: { project, hostCalls: { aeReadPropertyDetails: details, aeHostCensus: () => ok(toWire(hostCensus(3))) } } });
}

const stateDirectory = (rig: HostRig): string => present(rig.sidecar.options.stateDirectory, "a state directory");
const persistedOf = (rig: HostRig) => present(rig.readers.hashes.persisted, "the persisted details store");
const fingerprintOf = (rig: HostRig): string | undefined => rig.sidecar.normalizedLatest()?.fingerprint;
const textOf = (rig: HostRig, layerId: string) => {
  const compositions = decodeOrThrow(snapshotText, present(rig.sidecar.latest, "a stored snapshot").snapshot.result.compositions);
  const layer = present(present(compositions[0], "a composition").layers.find((candidate) => candidate.id === layerId), `layer ${layerId}`);
  return present(layer.propertyPaths.find((property) => property.path === TEXT), "the text property").value;
};

async function pairAndRead(rig: HostRig): Promise<void> {
  rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
}

async function restart(rig: HostRig): Promise<void> {
  await persistedOf(rig).flush();
  rig.readers.hashes.persisted = createDetailsStore({ directory: stateDirectory(rig) });
  rig.sidecar.latest = undefined;
  rig.sidecar.readScheduler = freshSchedulerMemory();
}

test("a pair after a restart with a warm store asks the host for no details, and the project reads exactly as it did cold", async () => {
  const asked: Scopes = [], rig = await start(textProject(), asked);
  try {
    await pairAndRead(rig);
    assert.deepEqual(asked, [[{ compId: "5", layerIds: ["11", "12"] }]], "cold: both layers are asked for");
    const cold = fingerprintOf(rig), coldText = textOf(rig, "11");
    await restart(rig);
    asked.length = 0;
    await pairAndRead(rig);
    assert.deepEqual(asked, [], "warm: the store vouches for both layers");
    const reads = rig.logs.filter((line) => line.event === "host.read").map((line) => [line.fields.detailsFromStore, line.fields.detailsAsked]);
    assert.deepEqual(reads.at(0), [0, true], "the cold read asked the host");
    assert.deepEqual(reads.at(-1), [2, false], "the warm read took both layers from the store and asked nothing");
    assert.equal(fingerprintOf(rig), cold, "the fingerprint after a warm pair equals the one after a cold pair");
    assert.deepEqual(textOf(rig, "11"), coldText);
    assert.deepEqual(textOf(rig, "12"), { text: "text of 12" });
  } finally { await rig.close(); }
});

test("a layer whose hash moved is fetched again, and the layer that did not move is not", async () => {
  const asked: Scopes = [], project = textProject(), rig = await start(project, asked);
  try {
    await pairAndRead(rig);
    await restart(rig);
    asked.length = 0;
    firstComposition(project).layers[1] = textLayer("12", 2, "h12-b", "Back renamed");
    await pairAndRead(rig);
    assert.deepEqual(asked, [[{ compId: "5", layerIds: ["12"] }]]);
    assert.deepEqual(textOf(rig, "11"), { text: "text of 11" });
  } finally { await rig.close(); }
});

test("the same hashes after an edit are not trusted: the revision moved, so nothing the store holds is reused", async () => {
  const asked: Scopes = [], rig = await start(textProject(), asked);
  try {
    await pairAndRead(rig);
    await restart(rig);
    asked.length = 0;
    rig.plugin.change({ revision: 101 });
    await rig.settle(); rig.timers.fire();
    await pairAndRead(rig);
    assert.deepEqual(asked, [[{ compId: "5", layerIds: ["11", "12"] }]], "a text edit does not move a layer hash, so the hash alone could not tell");
  } finally { await rig.close(); }
});

async function savedProject(): Promise<{ asked: Scopes; project: FixtureProject; rig: HostRig; file: string; done(): Promise<void> }> {
  const directory = mkdtempSync(join(tmpdir(), "extynt-details-file-")), file = join(directory, "Test.aep");
  writeFileSync(file, "project bytes");
  const asked: Scopes = [], project = textProject(file), rig = await start(project, asked);
  await pairAndRead(rig);
  await restart(rig);
  asked.length = 0;
  return { asked, project, rig, file, done: async () => { await rig.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("a saved, clean project whose file is unchanged is reused after the revision counter restarted", async () => {
  const { asked, rig, done } = await savedProject();
  try {
    rig.plugin.change({ revision: 7 });
    await rig.settle(); rig.timers.fire();
    await pairAndRead(rig);
    assert.deepEqual(asked, [], "another revision of the same unedited saved file");
  } finally { await done(); }
});

test("a saved project whose file changed since the details were read is read again", async () => {
  const { asked, rig, file, done } = await savedProject();
  try {
    utimesSync(file, new Date(1_000_000), new Date(2_000_000));
    rig.plugin.change({ revision: 7 });
    await rig.settle(); rig.timers.fire();
    await pairAndRead(rig);
    assert.equal(asked.length, 1);
  } finally { await done(); }
});

test("a project with unsaved edits is read again even when its file is as it was", async () => {
  const { asked, project, rig, done } = await savedProject();
  try {
    project.project.dirty = true;
    rig.plugin.change({ revision: 8 });
    await rig.settle(); rig.timers.fire();
    await pairAndRead(rig);
    assert.equal(asked.length, 1, "a dirty project holds edits the file does not");
  } finally { await done(); }
});

test("details fetched while the project was being edited are not stored", async () => {
  const asked: Scopes = [], rig = await start(keyedProject(), asked);
  try {
    const answer = present(rig.plugin.hostCalls.get("aeReadPropertyDetails"), "the details handler");
    rig.plugin.hostCalls.set("aeReadPropertyDetails", (args, request, plugin) => { plugin.change({ revision: 101 }); return answer(args, request, plugin); });
    await pairAndRead(rig);
    await restart(rig);
    await persistedOf(rig).lookup([], { session: null, file: null });
    assert.equal(persistedOf(rig).size(), 0);
    rig.plugin.hostCalls.set("aeReadPropertyDetails", answer);
    asked.length = 0;
    await pairAndRead(rig);
    assert.equal(asked.length, 1, "nothing was stored by the read that raced an edit");
  } finally { await rig.close(); }
});

test("a corrupt store file is ignored: the pair reads cold and the file is rewritten", async () => {
  const asked: Scopes = [], rig = await start(textProject(), asked);
  try {
    await pairAndRead(rig);
    await persistedOf(rig).flush();
    writeFileSync(join(stateDirectory(rig), DETAILS_STORE_FILE), "{ not json");
    rig.readers.hashes.persisted = createDetailsStore({ directory: stateDirectory(rig) });
    rig.sidecar.latest = undefined;
    rig.sidecar.readScheduler = freshSchedulerMemory();
    asked.length = 0;
    await pairAndRead(rig);
    assert.equal(asked.length, 1);
    await restart(rig);
    asked.length = 0;
    await pairAndRead(rig);
    assert.deepEqual(asked, [], "the rewritten file works");
  } finally { await rig.close(); }
});
