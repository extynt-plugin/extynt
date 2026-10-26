/** The native lane of the read scheduler: pushed by plugin events, so there is no settle wait, and a stamp is current while it is recent. */
import { baseViewOf, type BaseView } from "../src/read-base-view.js";
import { freshStamp, type LiveStamp } from "../src/read-currency.js";
import { decideRead, freshSchedulerMemory, type ReadInput } from "../src/read-rules.js";
import type { LiveFocus } from "../src/live-focus.js";
import type { StoredSnapshot } from "../src/server-types.js";
import { validSnapshot } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

const T0 = Date.parse("2026-10-04T12:00:00.000Z");
const base = (over: Partial<BaseView> = {}): BaseView => ({ project: { name: "Fixture", filePath: "/p/a.aep" }, hostStamp: { epoch: 3, revision: 10 }, epoch: 3, coverage: false, itemCount: 40, newest: 10, observed: { A: 10, B: 10 }, held: new Set(["A", "B"]), gaps: new Set(), cheapest: "B", missing: [], ...over });
const focus = (over: Partial<LiveFocus> = {}): LiveFocus => ({ projectPath: "/p/a.aep", projectName: "a.aep", epoch: 3, revision: 10, activeCompositionId: "A", activeCompositionName: "A", selected: [], selectedLayers: [], receivedAt: T0, observedAt: T0, ...over });
const stamp = (revision: number, at: number, items: number | null = 40): LiveStamp => ({ epoch: 3, revision, items, at, ttlMs: 2500 });
const input = (over: Partial<ReadInput> = {}): ReadInput => ({ now: T0, source: "event", awaitingFirstRead: false, inventoryKnown: true, pending: false, base: base(), focus: focus(), stamp: stamp(10, T0), memory: freshSchedulerMemory(), ...over });

test("an edit is read the moment its event arrives: the open composition alone, with no settle wait", () => {
  const first = decideRead(input({ stamp: stamp(11, T0) }));
  assert.deepEqual(first.spec, { reason: "edit", read: { scope: "compositions", compositionIds: ["A"], includeItems: false } });
  assert.equal(decideRead(input({ stamp: stamp(11, T0), source: "focus" })).spec, null, "a focus report only answers the view: the edit is read when its own event arrives");
});

test("a changed item count adds the item list to the read, and a read already at this revision is not asked for again", () => {
  assert.deepEqual(decideRead(input({ stamp: stamp(11, T0, 41) })).spec?.read, { scope: "compositions", compositionIds: ["A"], includeItems: true });
  assert.equal(decideRead(input({ stamp: stamp(11, T0), base: base({ observed: { A: 11, B: 10 } }) })).spec, null);
  const memory = decideRead(input({ stamp: stamp(11, T0) })).memory;
  assert.equal(decideRead(input({ stamp: stamp(11, T0), memory })).spec, null, "the same revision is never asked twice");
  assert.equal(decideRead(input({ stamp: stamp(12, T0), pending: true })).spec, null, "nothing is stacked on a read in flight");
});

test("another project is a full read at once", () => {
  assert.deepEqual(decideRead(input({ focus: focus({ projectPath: "/p/b.aep", projectName: "b.aep", epoch: 4 }), stamp: { ...stamp(1, T0), epoch: 4 } })).spec, { reason: "project", read: { scope: "full" } });
});

test("the first event after a pair asks for the first read, with the census only while no inventory is known", () => {
  const awaiting = { base: undefined, awaitingFirstRead: true, stamp: null, focus: null };
  assert.deepEqual(decideRead(input({ ...awaiting, inventoryKnown: false })).spec, { reason: "pair", read: { scope: "full" }, includeEffects: true });
  assert.equal(decideRead(input({ ...awaiting, source: "focus" })).spec, null, "a focus report never starts it");
});

function liveState(latest: StoredSnapshot | undefined, liveStamp: LiveStamp, now: number) {
  return { latest, liveStamp, now: () => new Date(now) };
}

test("an event stamp is current while it is recent, even if a read landed after it; a legacy stamp older than the read is not", () => {
  const read: StoredSnapshot = { snapshot: validSnapshot, receivedAt: new Date(T0 + 500).toISOString(), bytes: 1 };
  assert.equal(freshStamp(liveState(read, stamp(10, T0), T0 + 600), 5000)?.revision, 10);
  assert.equal(freshStamp(liveState(read, stamp(10, T0), T0 + 2600), 5000), null, "its own bound is 2.5 s");
  assert.equal(freshStamp(liveState(read, stamp(10, T0), T0 + 2200), 2000), null, "a caller's tighter bound still applies");
  const { ttlMs: _ttl, ...legacy } = stamp(10, T0);
  assert.equal(freshStamp(liveState(read, legacy, T0 + 600), 5000), null);
});

test("baseViewOf still reads a stored snapshot the native lane produced", () => {
  const stored: StoredSnapshot = { snapshot: { ...validSnapshot, result: { ...validSnapshot.result, compositions: [] } }, receivedAt: new Date(T0).toISOString(), bytes: 1 };
  assert.equal(baseViewOf(stored).held.size, 0);
});
