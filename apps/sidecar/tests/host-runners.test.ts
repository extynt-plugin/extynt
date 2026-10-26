/** Collection pages, the catalogue, the census and variant previews: the leases around each host call, and the order the lane takes background work in. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { array, boolean, decodeJson, decodeOrThrow, nullable, number, object, optional, string, type Decoder, type Infer } from "@extynt/decode";
import { hangUp, ok, refuse, toWire, type HostCallHandler } from "@extynt/fake-plugin";
import { enqueueHostWork } from "../src/host/work-queue.js";
import { linkHandleOf, offlineHostLink } from "../src/host/lane-types.js";
import { nativeMutationQuarantine, recordUnknownNativeAccess } from "../src/native-mutation-lease.js";
import { queueSnapshotRefresh } from "../src/read-queue.js";
import { rowDecoder } from "../src/verify/json-fields.js";
import { present } from "./present.js";
import { startHostRig, type HostRig } from "./host-rig.js";
import { censusAnswer } from "./sidecar-fixture.js";
import { frameDirectory, solidPng } from "./png-fixture.js";

const frames = frameDirectory();

const layerRow = (index: number) => ({ id: String(index), index, layerIndex: index, name: `Layer ${index}`, locked: false, selected: false, detail: "layer-index", properties: "unknown", values: "not-read" });
const layersPage = (requestId: string) => ({ ok: true, requestId, sessionId: "detail-1", stamp: { epoch: 1, revision: 100 }, kind: "layers", rows: [layerRow(1)], nextCursor: null, deepComplete: false, metadata: { activeCompositionId: "comp", runtime: { application: "After Effects" }, project: { name: "Test.aep", filePath: null }, composition: { id: "comp", itemIndex: 1, name: "Composition", width: 1920, height: 1080, duration: 10, frameRate: 30 }, layerCount: 1 } });

const demandShape = object({ ticket: string(), hostFunction: string(), hostRequest: rowDecoder, generation: number() });
type Demand = Infer<typeof demandShape>;
const settleShape = object({ outcome: string() });
const kindShape = object({ kind: string() });
const completionShape = object({ ticket: string(), page: rowDecoder });
const controlsShape = object({ results: array(object({ controls: array(object({ isDropdown: boolean(), items: nullable(array(string())) })) })) });
const errorShape = object({ error: object({ code: string() }) });
const limitsShape = object({ limits: optional(object({ maxEffects: number(), maxFonts: number() })) });

function bodyOf<T>(rig: HostRig, call: string, shape: Decoder<T>): T {
  return decodeOrThrow(shape, present(rig.bodies.find((entry) => entry.call === call), call).args[1]);
}

const settleOutcome = (rig: HostRig): string => bodyOf(rig, "bridge:settle", settleShape).outcome;

function demandPage(rig: HostRig): Demand {
  const dispatch = decodeOrThrow(demandShape, rig.sidecar.collection.demand({ begin: true, target: { kind: "layers", compositionId: "comp", itemIndex: 1 }, maxRows: 25 }, false));
  enqueueHostWork(rig.sidecar, { approvedData: { kind: "collection_page", dispatch } });
  return dispatch;
}

test("a collection page is admitted, run under a read lease bound to its ticket, settled, and completed with the page", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCollectDetailPage: (args) => {
    assert.equal(rig.sidecar.nativeBridge.activeLogicalMatches("collection_page", String(args.requestId)), true, "the lease was reserved for this ticket before the call ran");
    return ok(layersPage(String(args.requestId)));
  } } } });
  try {
    const dispatch = demandPage(rig);
    assert.deepEqual(await rig.drain(), ["collection_page"]);
    assert.deepEqual(rig.calls, ["collection:dispatch", "bridge:reserve", "bridge:settle", "collection:complete"], "the panel's order");
    assert.equal(rig.sidecar.collection.demandResult(dispatch.ticket).state, "observed");
    assert.equal(rig.sidecar.collection.hasUnsettled(dispatch.ticket), false);
    assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null);
    assert.equal(rig.sidecar.inFlight, undefined);
    assert.equal(settleOutcome(rig), "callback-received");
  } finally { await rig.close(); }
});

test("a collection page the host never started is completed as not started, and the lease says so", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCollectDetailPage: () => refuse("SHUTTING_DOWN", "quitting") } } });
  try {
    const dispatch = demandPage(rig);
    await rig.drain();
    assert.deepEqual(rig.calls, ["collection:dispatch", "bridge:reserve", "bridge:settle", "collection:complete"]);
    assert.equal(settleOutcome(rig), "native-not-started");
    assert.equal(rig.sidecar.collection.hasUnsettled(dispatch.ticket), false, "the ticket is released");
  } finally { await rig.close(); }
});

test("a collection call whose answer never came back fails its demand and leaves the lease for the next reservation", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCollectDetailPage: () => hangUp() } } });
  try {
    const dispatch = demandPage(rig);
    await rig.drain();
    assert.deepEqual(rig.calls, ["collection:dispatch", "bridge:reserve", "collection:complete"], "no settlement was claimed for a call that may still be running");
    assert.equal(rig.sidecar.collection.demandResult(dispatch.ticket).state, "unknown");
    assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, "an unsettled read is replaced by the next reservation");
  } finally { await rig.close(); }
});

test("with the link down a collection ticket is cancelled before it is dispatched, and a malformed envelope is reported and cancelled", async () => {
  const rig = await startHostRig();
  try {
    const dispatch = demandPage(rig);
    rig.sidecar.hostLink = offlineHostLink(0);
    rig.context.link = linkHandleOf(rig.sidecar.hostLink);
    await rig.drain();
    assert.deepEqual(rig.calls, ["collection:cancel"]);
    assert.equal(rig.plugin.requestsFor("host_call").length, 0, "nothing was sent to a plugin that is not there");
    assert.equal(rig.sidecar.collection.hasUnsettled(dispatch.ticket), false);
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "collection_page", dispatch: { ticket: "t-bad", hostFunction: "aeApplyPlan", hostRequest: { requestId: "t-bad" } } } });
    rig.calls.length = 0;
    const claim = rig.readers.claimAhead(rig.context.now());
    assert.equal(claim, undefined, "a ticket the collection service does not hold is dropped at the claim");
  } finally { await rig.close(); }
});

function afterReserve(rig: HostRig, act: () => void): void {
  const original = rig.context.receivers;
  let done = false;
  const nativeBridge: typeof original.nativeBridge = (action, body) => {
    const answer = original.nativeBridge(action, body);
    if (done || action !== "reserve") return answer;
    done = true;
    return answer.then((value) => { act(); return value; });
  };
  rig.context.receivers = { ...original, nativeBridge };
}

test("a collection ticket cancelled between its admission and the plugin call makes no host read", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCollectDetailPage: () => ok(layersPage("never")) } } });
  try {
    const dispatch = demandPage(rig);
    afterReserve(rig, () => rig.sidecar.collection.cancelDemand(dispatch.ticket));
    await rig.drain();
    assert.equal(rig.plugin.requestsFor("host_call").length, 0, "the cancelled ticket was never read");
    assert.equal(settleOutcome(rig), "native-not-started");
    assert.equal(rig.sidecar.collection.hasUnsettled(dispatch.ticket), false, "the ticket is released");
    assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null);
  } finally { await rig.close(); }
});

test("a ticket whose admission is refused is released at once, so a new demand is not busy until the retirement", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCollectDetailPage: () => ok(layersPage("never")) } } });
  try {
    const dispatch = demandPage(rig);
    const original = rig.context.receivers;
    rig.context.receivers = { ...original, collection: (action, body) => { if (action === "dispatch") rig.sidecar.collection.cancel(); return original.collection(action, body); } };
    await rig.drain();
    assert.equal(rig.plugin.requestsFor("host_call").length, 0);
    assert.equal(rig.sidecar.collection.hasUnsettled(dispatch.ticket), false, "the refused ticket is not held for 60 s");
    assert.ok(rig.sidecar.collection.prepare({ begin: true, target: { kind: "index" } }, false).ticket, "a new demand is not COLLECTION_BUSY");
  } finally { await rig.close(); }
});

test("the rig's drain runs nothing while native access is quarantined, as the lane does", async () => {
  const rig = await startHostRig();
  try {
    queueSnapshotRefresh(rig.sidecar, { reason: "edit", read: { scope: "full" } });
    recordUnknownNativeAccess(rig.sidecar, { kind: "mutation", code: "HOST_TIMEOUT" }, rig.context.now());
    assert.notEqual(rig.sidecar.nativeBridge.accessQuarantine() ?? nativeMutationQuarantine(rig.sidecar.inFlight), null, "the quarantine is in force");
    assert.deepEqual(await rig.drain(), [], "queued work waits for the write to settle");
    assert.equal(rig.sidecar.agentMailbox.length, 1, "and stays queued");
    assert.equal(rig.plugin.requestsFor("batch").length, 0);
  } finally { await rig.close(); }
});

test("a catalogue page runs its whitelisted host function as a read and is completed with whatever came back", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCatalogueProbePage: () => ok({ ok: true, requestId: "cat-1", effects: [] }) } } });
  try {
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "catalogue_page", ticket: "cat-1", hostFunction: "aeCatalogueProbePage", hostRequest: { schemaVersion: "0.1", requestId: "cat-1", matchNames: ["ADBE Blur"], budgetMs: 1000 } } });
    assert.deepEqual(await rig.drain(), ["catalogue_page"]);
    assert.equal(rig.plugin.requestsFor("host_call").length, 1);
    const complete = bodyOf(rig, "catalogue:complete", completionShape);
    assert.deepEqual([complete.ticket, complete.page.ok], ["cat-1", true]);
    assert.deepEqual(rig.calls.slice(0, 3), ["bridge:reserve", "bridge:settle", "catalogue:complete"]);
  } finally { await rig.close(); }
});

test("a catalogue page that holds effects gets their popup labels from the plugin and a cleanup page follows", async () => {
  const seen: Array<Parameters<HostCallHandler>[0]> = [];
  const glow = { matchName: "ADBE Glo2", displayName: "Glow", truncated: false, applyMs: 1, createdItems: 0, controls: [
    { matchName: "ADBE Glo2-0006", name: "Glow Operation", index: 6, kind: "property", valueType: "OneD", defaultValue: 3, hasMin: true, min: 1, hasMax: true, max: 3, isDropdown: false, items: null },
    { matchName: "ADBE Glo2-0001", name: "Odd", index: 1, kind: "property", valueType: "OneD", defaultValue: 1, hasMin: true, min: 1, hasMax: true, max: 9, isDropdown: false, items: null } ] };
  const page = { ok: true, requestId: "cat-4", results: [glow], failures: [], remaining: [], held: { compId: "9", layerId: "7", matchNames: ["ADBE Glo2"] } };
  const rig = await startHostRig({ plugin: { hostCalls: { aeCatalogueProbePage: (args) => { seen.push(args); return ok(args.cleanup === true ? { ok: true, requestId: "cat-4", cleanedUp: true } : page); } } } });
  try {
    rig.plugin.state.effectMenus = [{ matchName: "ADBE Glo2", popups: [{ matchName: "ADBE Glo2-0006", choices: 3, consistent: true, items: ["None", "Add", "Screen"] }, { matchName: "ADBE Glo2-0001", choices: 9, consistent: false, items: ["x"] }] }];
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "catalogue_page", ticket: "cat-4", hostFunction: "aeCatalogueProbePage", hostRequest: { schemaVersion: "0.1", requestId: "cat-4", matchNames: ["ADBE Glo2"], budgetMs: 1000 } } });
    assert.deepEqual(await rig.drain(), ["catalogue_page"]);
    assert.deepEqual(seen.map((args) => [args.hold ?? null, args.cleanup ?? null]), [[true, null], [null, true]]);
    assert.deepEqual(rig.plugin.requestsFor("effect_menus").map((request) => [request.body.compId, request.body.layerId]), [["9", "7"]]);
    const complete = bodyOf(rig, "catalogue:complete", completionShape);
    const [first] = decodeOrThrow(controlsShape, complete.page).results;
    assert.deepEqual(present(first, "the first result").controls.map((row) => [row.isDropdown, row.items]), [[true, ["None", "Add", "Screen"]], [false, null]]);
    assert.equal(complete.page.held, undefined);
  } finally { await rig.close(); }
});

test("a catalogue envelope naming a function outside the whitelist runs nothing and is completed as failed", async () => {
  const rig = await startHostRig();
  try {
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "catalogue_page", ticket: "cat-2", hostFunction: "aeApplyPlan", hostRequest: { requestId: "cat-2" } } });
    await rig.drain();
    assert.equal(rig.plugin.requestsFor("host_call").length, 0);
    assert.equal(rig.sidecar.panel.lastError?.code, "INVALID_CATALOGUE_DISPATCH");
    const complete = bodyOf(rig, "catalogue:complete", completionShape);
    assert.equal(decodeOrThrow(errorShape, complete.page).error.code, "INVALID_CATALOGUE_DISPATCH");
  } finally { await rig.close(); }
});

test("background work goes last: a waiting mailbox holds it back, thumbnails come before the catalogue, and a turn in progress holds the catalogue back", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeCaptureFrame: (args) => ok(toWire({ ok: true, captureId: args.captureId, width: 480, height: 270, localPath: frames.write(`${String(args.captureId)}.png`, solidPng(480, 270)) })) } } });
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    const asked: boolean[] = [];
    Object.assign(rig.sidecar, { catalogue: { nextInstanceRead: (idle: boolean) => { asked.push(idle); return idle ? { kind: "catalogue_page", ticket: "cat-3", hostFunction: "aeCatalogueReadInstance", hostRequest: { requestId: "cat-3" } } : undefined; } } });
    rig.readers.thumbs.queue({ planId: "plan-1", side: "after", operations: [{ type: "set_layer_property", compositionId: "5", layerId: "11" }] });
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "host_census" } });
    assert.equal(rig.readers.claimBackground(rig.context.now()), undefined, "the mailbox is not empty");
    assert.deepEqual(asked, []);
    rig.sidecar.agentMailbox.length = 0;
    assert.equal(rig.readers.claimBackground(rig.context.now())?.kind, "capture_frame", "a thumbnail first");
    rig.sidecar.inFlight = undefined;
    assert.equal(rig.readers.claimBackground(rig.context.now())?.kind, "catalogue_page", "then the catalogue");
    rig.sidecar.inFlight = undefined;
    Object.assign(rig.sidecar, { activeChatTurn: { requestId: "r", controller: new AbortController(), startedAt: 0, settled: Promise.resolve() } });
    assert.equal(rig.readers.claimBackground(rig.context.now()), undefined);
    assert.equal(asked.at(-1), false, "the collector is told the agent is mid-turn");
  } finally { await rig.close(); }
});

function limitsOf(args: string): Infer<typeof limitsShape>["limits"] {
  const parsed = decodeJson(args, limitsShape);
  return parsed.ok ? parsed.value.limits : undefined;
}

const inventoryCount = (rig: HostRig): number | undefined => rig.sidecar.inventory?.items.length;

test("a census that comes back unreadable or not ok leaves the inventory alone", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aeHostCensus: () => ok({ ok: false, error: { code: "CENSUS_FAILED" } }) } } });
  try {
    assert.equal(rig.readers.queueCensus(), true);
    assert.equal(rig.readers.queueCensus(), false, "one census at a time");
    assert.deepEqual(await rig.drain(), ["host_census"]);
    assert.equal(inventoryCount(rig), undefined);
    rig.plugin.hostCalls.set("aeHostCensus", (args) => ok(toWire(censusAnswer(args, 2))));
    rig.readers.queueCensus();
    await rig.drain();
    assert.equal(inventoryCount(rig), 2);
    assert.deepEqual(rig.plugin.requestsFor("host_call").map((request) => limitsOf(String(request.body.args))), [{ maxEffects: 10000, maxFonts: 8192 }, { maxEffects: 10000, maxFonts: 8192 }, { maxEffects: 10000, maxFonts: 8192 }], "the failed census, the retried effects census, and the fonts that follow it");
  } finally { await rig.close(); }
});

const previewItem = (setId: string) => ({ kind: "preview_controls", setId, command: { operation: "preview_control_values", compositionId: "5", layerId: "11", effectMatchName: "ADBE Blur", effectPath: "e", propertyPath: "p", candidates: [{ id: "c0", value: 1 }, { id: "c1", value: 2 }], capture: { idPrefix: "variant-x", time: 0, width: 480, height: 270 }, undoGroup: "extynt preview" } });

function previewHost(rig: HostRig) {
  return () => {
    assert.notEqual(nativeMutationQuarantine(rig.sidecar.inFlight) ?? rig.sidecar.nativeBridge.accessQuarantine(), null, "a mutation lease is held while the control is being changed");
    const framesOut = ["c0", "c1"].map((id) => ({ id, ok: true, captureId: `variant-x-${id}`, localPath: frames.write(`variant-x-${id}.png`, solidPng(480, 270, id === "c0" ? [200, 0, 0] : [0, 200, 0])) }));
    return ok({ ok: true, restored: true, mutationState: "restored", frames: framesOut });
  };
}

test("a variant preview runs under the mutation lease, pictures every option, removes the frames and publishes the pictures", async () => {
  const rig = await startHostRig();
  try {
    rig.plugin.hostCalls.set("aePreviewControlValues", previewHost(rig));
    enqueueHostWork(rig.sidecar, { approvedData: previewItem("set-1") });
    assert.deepEqual(await rig.drain(), ["preview_controls"]);
    const result = rig.readers.frames.previewFor("set-1");
    assert.equal(result?.status, "ready");
    assert.deepEqual(result?.status === "ready" ? Object.keys(result.pictures) : [], ["0", "1"]);
    assert.deepEqual(rig.calls, ["bridge:reserve", "bridge:settle"]);
    assert.equal(decodeOrThrow(kindShape, present(rig.bodies[0], "the reserve call").args[1]).kind, "mutation", "an unconfirmed restore would hold native access exactly as an apply does");
    assert.equal(existsSync(`${frames.path}/variant-x-c0.png`), false);
    assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, "settled");
    assert.deepEqual(rig.ui.filter((event) => event.type === "preview"), [{ type: "preview", setId: "set-1" }]);
  } finally { await rig.close(); }
});

test("a restore the host cannot confirm holds the project: native access is quarantined, the snapshot is retired, and the options have no pictures", async () => {
  const rig = await startHostRig();
  try {
    rig.pair(); await rig.settle(); rig.timers.fire(); await rig.drain();
    rig.plugin.hostCalls.set("aePreviewControlValues", () => ok({ ok: false, restored: false, mayHaveMutated: true, mutationState: "unknown", error: { code: "RESTORE_MISMATCH" } }));
    enqueueHostWork(rig.sidecar, { approvedData: previewItem("set-2") });
    await rig.drain();
    assert.deepEqual(rig.readers.frames.previewFor("set-2"), { status: "unresolved", code: "RESTORE_MISMATCH" });
    assert.ok(nativeMutationQuarantine(rig.sidecar.inFlight), "the held mutation");
    assert.equal(rig.sidecar.latest, undefined, "what was observed before cannot be trusted");
    assert.equal(rig.sidecar.panel.lastError?.code, "PREVIEW_RESTORE_UNCONFIRMED");
  } finally { await rig.close(); }
});

test("a preview whose call never answered leaves the mutation lease open, and one the host never started is settled as not started", async () => {
  const hung = await startHostRig({ plugin: { hostCalls: { aePreviewControlValues: () => hangUp() } } });
  try {
    enqueueHostWork(hung.sidecar, { approvedData: previewItem("set-3") });
    await hung.drain();
    assert.equal(hung.readers.frames.previewFor("set-3")?.status, "unresolved");
    assert.notEqual(hung.sidecar.nativeBridge.accessQuarantine(), null, "the lease is held until its callback settles it");
    assert.deepEqual(hung.calls.filter((call) => call.startsWith("bridge")), ["bridge:reserve"]);
  } finally { await hung.close(); }
  const refused = await startHostRig({ plugin: { hostCalls: { aePreviewControlValues: () => refuse("SHUTTING_DOWN", "quitting") } } });
  try {
    enqueueHostWork(refused.sidecar, { approvedData: previewItem("set-4") });
    await refused.drain();
    assert.deepEqual(refused.readers.frames.previewFor("set-4"), { status: "none" });
    assert.equal(settleOutcome(refused), "native-not-started");
    assert.equal(refused.sidecar.nativeBridge.accessQuarantine(), null);
  } finally { await refused.close(); }
});

test("a host with nothing to picture, an answer that cannot be read, and a malformed item are each handled without touching the lease wrongly", async () => {
  const rig = await startHostRig({ plugin: { hostCalls: { aePreviewControlValues: () => ok({ ok: false, restored: false, mayHaveMutated: false, error: { code: "CONTROL_NOT_FOUND" } }) } } });
  try {
    enqueueHostWork(rig.sidecar, { approvedData: previewItem("set-5") });
    await rig.drain();
    assert.deepEqual(rig.readers.frames.previewFor("set-5"), { status: "none" });
    rig.plugin.hostCalls.set("aePreviewControlValues", () => ok("not json"));
    enqueueHostWork(rig.sidecar, { approvedData: previewItem("set-6") });
    await rig.drain();
    assert.equal(rig.readers.frames.previewFor("set-6")?.status, "unresolved", "an answer that cannot be read leaves open whether the control is back");
    enqueueHostWork(rig.sidecar, { approvedData: { kind: "preview_controls", setId: "set-7", command: { operation: "something else" } } });
    await rig.drain();
    assert.equal(rig.readers.frames.previewFor("set-7"), undefined, "a malformed item is ignored");
  } finally { await rig.close(); }
});
