/** Plugin events in, the live view and the reads they call for out: the fake plugin pushes `change`, `still` and `overflow` to the real sidecar. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, decode, object, string } from "@extynt/decode";
import { isRecord } from "@extynt/host-native";
import { usableStamp } from "../src/read-scheduler.js";
import { focusFresh, FOCUS_FRESH_MS } from "../src/live-focus.js";
import { offlineHostLink } from "../src/host/lane-types.js";
import { READ_COALESCE_MS } from "../src/host/events.js";
import { hashedProject, startHostRig, until, type HostRig } from "./host-rig.js";
import { present } from "./present.js";

const T0 = Date.parse("2026-10-04T12:00:00.000Z");
const named = (count: number) => Array.from({ length: count }, (_, index) => ({ id: String(100 + index), index: index + 1, name: `Layer ${index + 1}` }));

async function paired(clock = { ms: T0 }): Promise<{ rig: HostRig; clock: { ms: number } }> {
  const rig = await startHostRig({ sidecar: { now: () => new Date(clock.ms) } });
  try {
    rig.pair();
    await until(() => rig.sidecar.agentMailbox.length > 0 || rig.plugin.watcherCount > 0);
    await rig.settle();
    rig.timers.fire();
    await rig.drain();
    assert.ok(rig.sidecar.latest, "the first read landed");
  } catch (error) {
    await rig.close();
    throw error;
  }
  return { rig, clock };
}

test("the rig's sidecar looks for native.json in its own state directory, never in the per-user one After Effects writes", async () => {
  const rig = await startHostRig();
  try {
    const discoveryPath = rig.sidecar.options.discoveryPath ?? "";
    assert.ok(discoveryPath.startsWith(rig.sidecar.options.stateDirectory ?? "\0"), discoveryPath);
  } finally {
    await rig.close();
  }
});

const kinds = (rig: HostRig) => rig.sidecar.agentMailbox.map((item) => item.approvedData);
const opsBody = object({ ops: array(object({ op: string() })) });
const opNames = (request: { body: Parameters<typeof decode>[1] }): string[] => {
  const body = decode(opsBody, request.body);
  return body.ok ? body.value.ops.map((op) => op.op) : [];
};

test("a change event becomes the live stamp and the live focus, with the time and the epoch", async () => {
  const { rig } = await paired();
  try {
    const layers = named(12);
    rig.plugin.change({ revision: 101, selection: layers.map((layer) => layer.id), selectedLayers: layers, time: 2.5 });
    await rig.settle();
    assert.deepEqual([rig.sidecar.liveStamp?.epoch, rig.sidecar.liveStamp?.revision, rig.sidecar.liveStamp?.items], [1, 101, 3]);
    assert.equal(rig.sidecar.liveStamp?.ttlMs, 2500, "an event stamp carries its own freshness");
    const focus = present(rig.sidecar.liveFocus);
    assert.deepEqual([focus.activeCompositionId, focus.activeCompositionName, focus.selected.length, focus.time, focus.epoch, focus.revision], ["5", "Main", 12, 2.5, 1, 101]);
  } finally { await rig.close(); }
});

test("the UI is told the focus with up to eight layer names, and the change when the revision moved", async () => {
  const { rig } = await paired();
  try {
    rig.ui.length = 0;
    const layers = named(12);
    rig.plugin.change({ revision: 101, selection: layers.map((layer) => layer.id), selectedLayers: layers, time: 2.5 });
    await rig.settle();
    const published = rig.ui.flatMap((event) => (event.type === "focus" ? [event.focus] : []));
    assert.equal(published.length, 1);
    const chip = present(published[0]);
    assert.equal(chip.selected, 12, "the count is the whole selection");
    assert.deepEqual(chip.selectedLayers.map((layer) => layer.name), layers.slice(0, 8).map((layer) => layer.name), "the chip names the first eight");
    assert.deepEqual([chip.compositionName, chip.time, chip.projectName], ["Main", 2.5, "Test.aep"]);
    assert.equal(rig.ui.filter((event) => event.type === "change").length, 1, "the revision moved: the UI is told");
  } finally { await rig.close(); }
});

test("an identical change is published once, and a selection or active change is a focus event and never a read", async () => {
  const { rig } = await paired();
  try {
    rig.ui.length = 0;
    rig.plugin.change({ selection: ["11"], selectedLayers: [{ id: "11", index: 1, name: "Title" }] });
    await rig.settle();
    rig.plugin.change({ selection: ["11"], selectedLayers: [{ id: "11", index: 1, name: "Title" }] }, ["selection"]);
    await rig.settle();
    assert.equal(rig.ui.filter((event) => event.type === "focus").length, 1, "the same view is not published twice");
    assert.equal(rig.timers.waiting(), 0, "a selection asks for no read");
    assert.deepEqual(kinds(rig), []);
    rig.plugin.change({ time: 4 }, ["time"]);
    await rig.settle();
    assert.equal(rig.ui.filter((event) => event.type === "focus").length, 2, "the current time is part of the chip's context");
    assert.equal(rig.timers.waiting(), 0);
  } finally { await rig.close(); }
});

test("edits within the window are one scoped read of the open composition; the item list only when the count moved", async () => {
  const { rig } = await paired();
  try {
    const before = rig.plugin.requestsFor("batch").length;
    rig.plugin.change({ revision: 101 });
    rig.plugin.change({ revision: 102 });
    rig.plugin.change({ revision: 103 });
    await rig.settle();
    assert.equal(rig.timers.waiting(), 1, "three changes share one window");
    assert.deepEqual(kinds(rig), [], "nothing is queued until the window closes");
    rig.timers.fire();
    assert.deepEqual(kinds(rig).map((item) => [item.kind, item.reason, item.read]), [["refresh_snapshot", "edit", { scope: "compositions", compositionIds: ["5"], includeItems: false }]]);
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    const batches = rig.plugin.requestsFor("batch").slice(before);
    assert.equal(batches.length, 1, "one batch: the stamp and the composition");
    assert.deepEqual(opNames(present(batches[0])), ["watch_state", "read_comp"]);
    assert.equal(rig.sidecar.latest?.observed?.compositions["5"], 103, "the read carries the stamp taken in its own batch");
    rig.plugin.change({ revision: 104, items: 4 });
    await rig.settle(); rig.timers.fire();
    const read = present(kinds(rig)[0]).read;
    assert.ok(isRecord(read) && read.includeItems === true, "an item added or removed reads the item list too");
  } finally { await rig.close(); }
});

test("another project is a full read at once, with no window", async () => {
  const { rig } = await paired();
  try {
    rig.plugin.state.project = { ...rig.plugin.state.project, project: { name: "Other.aep", filePath: "/tmp/Other.aep", dirty: false } };
    rig.plugin.change({ projectName: "Other.aep", projectPath: "/tmp/Other.aep", epoch: 2, revision: 7 }, ["project", "revision"]);
    await rig.settle();
    assert.deepEqual(kinds(rig).map((item) => [item.reason, item.read]), [["project", { scope: "full" }]]);
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.deepEqual(opNames(present(rig.plugin.requestsFor("batch").at(-1))), ["watch_state", "read_project"]);
  } finally { await rig.close(); }
});

test("an overflow is a full read, whatever the scheduler thinks it knows", async () => {
  const { rig } = await paired();
  try {
    rig.plugin.overflow(12);
    await rig.settle();
    assert.deepEqual(kinds(rig).map((item) => [item.reason, item.read]), [["overflow", { scope: "full" }]]);
    assert.ok(rig.logs.some((entry) => entry.event === "host.events-overflow" && entry.fields.dropped === 12));
  } finally { await rig.close(); }
});

test("a still keeps the stamp and the focus fresh; without it they age out", async () => {
  const clock = { ms: T0 };
  const { rig } = await paired(clock);
  try {
    rig.plugin.change({ revision: 101 });
    await rig.settle();
    const at = clock.ms;
    clock.ms = at + 2000;
    assert.equal(usableStamp(rig.sidecar)?.revision, 101, "within its 2.5 s");
    clock.ms = at + 2600;
    assert.equal(usableStamp(rig.sidecar), null, "a stamp nobody confirmed is not AE's current state");
    rig.plugin.still();
    await rig.settle();
    assert.equal(usableStamp(rig.sidecar)?.revision, 101, "the still confirms it as of now");
    clock.ms += 2000;
    assert.equal(usableStamp(rig.sidecar)?.revision, 101);
    clock.ms += FOCUS_FRESH_MS + 1;
    assert.equal(focusFresh(present(rig.sidecar.liveFocus), clock.ms), false, "the focus ages like any report");
    rig.plugin.still();
    await rig.settle();
    assert.equal(focusFresh(present(rig.sidecar.liveFocus), clock.ms), true, "and a still renews it");
  } finally { await rig.close(); }
});

test("a still for a revision the stamp does not hold replaces the stamp (a missed change), and host-closing forgets it", async () => {
  const { rig } = await paired();
  try {
    rig.plugin.state.watch = { ...rig.plugin.state.watch, revision: 150 };
    rig.plugin.still();
    await rig.settle();
    assert.equal(rig.sidecar.liveStamp?.revision, 150);
    rig.plugin.hostClosing();
    await until(() => rig.sidecar.liveStamp === null);
  } finally { await rig.close(); }
});

test("with real timers an edit burst is read once, about 150 ms after the first change", async () => {
  const rig = await startHostRig({ realTimers: true, plugin: { project: hashedProject() } });
  try {
    rig.pair();
    await until(() => rig.sidecar.agentMailbox.length > 0 && rig.plugin.watcherCount > 0);
    await new Promise((resolve) => { setTimeout(resolve, READ_COALESCE_MS + 50); });
    await rig.drain();
    const start = Date.now();
    rig.plugin.change({ revision: 101 }); rig.plugin.change({ revision: 102 });
    await until(() => rig.sidecar.agentMailbox.length > 0);
    assert.ok(Date.now() - start >= 100, "not before the window closed");
    assert.equal(rig.sidecar.agentMailbox.length, 1);
  } finally { await rig.close(); }
});

test("on the native lane the agent's turn waits for a composition the events show is behind, and only while the link is up", async () => {
  const { rig } = await paired();
  try {
    rig.plugin.change({ revision: 101 });
    await rig.settle();
    const turn = rig.sidecar.beforeTurn({});
    await until(() => rig.sidecar.agentMailbox.length === 1);
    assert.deepEqual([present(kinds(rig)[0]).reason, present(kinds(rig)[0]).read], ["gate", { scope: "compositions", compositionIds: ["5"], includeItems: false }]);
    assert.deepEqual(await rig.drain(), ["refresh_snapshot"]);
    assert.equal(await turn, undefined, "the read landed in time, so there is nothing to report");
    rig.plugin.change({ revision: 102 });
    await rig.settle();
    rig.sidecar.hostLink = offlineHostLink(0);
    const started = Date.now();
    assert.equal(await rig.sidecar.beforeTurn({}), undefined);
    assert.ok(Date.now() - started < 500, "with no plugin there is nothing to wait for");
    assert.equal(rig.sidecar.agentMailbox.length, 0);
  } finally { await rig.close(); }
});

test("a listener hears every change with its reasons, which is how the live undo state follows the revision", async () => {
  const { rig } = await paired();
  try {
    const heard: Array<[number | null, string[]]> = [];
    rig.readers.events.onChange((state, reasons) => heard.push([state.revision, reasons]));
    rig.plugin.change({ revision: 101 });
    rig.plugin.change({ selection: ["11"], selectedLayers: [{ id: "11", index: 1, name: "Title" }] });
    await rig.settle();
    assert.deepEqual(heard, [[101, ["revision"]], [101, ["selection"]]]);
  } finally { await rig.close(); }
});

test("an event is the host's heartbeat for the code that still reads panel liveness", async () => {
  const clock = { ms: T0 };
  const { rig } = await paired(clock);
  try {
    clock.ms = T0 + 5000;
    rig.plugin.still();
    await rig.settle();
    assert.equal(rig.sidecar.panel.lastSeenAt, T0 + 5000);
  } finally { await rig.close(); }
});
