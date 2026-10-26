/** Folding a scoped project read into the stored snapshot: replace by id, drop what is gone, keep what was not read, refuse what cannot be placed. */
import { type JsonObject, decodeOrThrow } from "@extynt/decode";
import { mergeRead, observedOfWhole, type MergeResult } from "../src/snapshot-merge.js";
import { normalizeProbeSnapshot } from "../src/server-normalize.js";
import type { ProbeSnapshot, StoredSnapshot } from "../src/server-types.js";
import { objectOf, rowDecoder, rowList } from "../src/verify/json-fields.js";
import { validSnapshot } from "./sidecar-fixture.js";
import assert from "node:assert/strict";
import test from "node:test";

type Over = Readonly<Record<string, JsonObject[string] | undefined>>;
const layer = (id: string, name: string): JsonObject => ({ id, index: 1, name, type: "solid", selected: false, propertyPaths: [] });
const comp = (id: string, layers: JsonObject[] = [layer(`${id}-l1`, `${id} layer`)]): JsonObject => ({ id, name: `Comp ${id}`, width: 1920, height: 1080, duration: 10, frameRate: 24, layers });
const item = (id: string, type: string): JsonObject => ({ id, name: `Item ${id}`, type, parentFolderId: null, compositionId: type === "composition" ? id : null, sourceId: type === "footage" ? id : null });
const ITEMS = [item("1", "footage"), item("2", "composition"), item("3", "composition"), item("4", "footage")];
const SOURCES: JsonObject[] = [{ id: "1", name: "Item 1", type: "footage", filePath: "/media/1.mov", missing: false, width: 1, height: 1, duration: 1 }];

function readScopeOf(scope: { items: "read" | "skipped" } | "absent" | undefined): Over {
  if (scope === "absent") return {};
  return { readScope: scope ? { compositions: "listed", items: scope.items } : { compositions: "all", items: "read" } };
}

function probe(requestId: string, revision: number, over: Over = {}, scope?: { items: "read" | "skipped" } | "absent"): ProbeSnapshot {
  const result = { ...validSnapshot.result, project: { name: "Fixture", filePath: "/p/fixture.aep" }, hostStamp: { epoch: 3, revision }, itemCount: 4, revision: "4:2", activeCompositionId: "2", currentTime: 0, selectedLayerIds: [],
    items: ITEMS, sources: SOURCES, compositions: [comp("2"), comp("3")], installedEffects: [], capabilityEnumeration: { effects: "unknown" }, compositionPages: { unread: [], oversized: [], capped: false }, truncation: { truncated: false, limits: { maxReadMs: 3000 } },
    ...readScopeOf(scope), ...over };
  return { ...validSnapshot, requestId, result, warnings: Array.isArray(over.warnings) ? over.warnings.map(String) : [] };
}
const stored = (snapshot: ProbeSnapshot): StoredSnapshot => ({ snapshot, receivedAt: "2026-10-03T12:00:00.000Z", bytes: 1, observed: observedOfWhole(snapshot) });
const raw = (snapshot: ProbeSnapshot): JsonObject => decodeOrThrow(rowDecoder, snapshot.result);
const compositionsOf = (snapshot: ProbeSnapshot): readonly JsonObject[] => decodeOrThrow(rowList, snapshot.result.compositions);
function accepted(result: MergeResult): Extract<MergeResult, { ok: true }> { if (!result.ok) throw new Error(`refused: ${result.reason}`); return result; }
const merged = (result: MergeResult): ProbeSnapshot => accepted(result).snapshot;
const idsOf = (snapshot: ProbeSnapshot): string[] => compositionsOf(snapshot).map((composition) => String(composition.id));
const fingerprintOf = (snapshot: ProbeSnapshot): string => normalizeProbeSnapshot(snapshot, "2026-10-03T12:00:01.000Z").fingerprint;

test("a full read replaces everything and records the revision each composition was read at", () => {
  const read = probe("full", 10), result = mergeRead(undefined, read);
  assert.strictEqual(accepted(result).snapshot, read);
  assert.deepEqual(accepted(result).observed, { epoch: 3, itemsRevision: 10, itemCount: 4, compositions: { "2": 10, "3": 10 } });
  const replaced = mergeRead(stored(probe("old", 5, { compositions: [comp("9")] })), read);
  assert.equal(replaced.ok, true); assert.deepEqual(idsOf(merged(replaced)), ["2", "3"], "nothing of the old snapshot survives a full read");
});

test("a read without a readScope is a whole read: older panels and collection snapshots are stored as they come", () => {
  const legacy = probe("legacy", 10, {}, "absent");
  assert.strictEqual(merged(mergeRead(stored(probe("old", 5)), legacy)), legacy);
  const collection = probe("collect", 11, { coverage: { kind: "composition-metadata", compositionId: "2", properties: "unknown", otherCompositions: "unknown" }, compositions: [comp("2")], items: undefined, sources: undefined }, "absent");
  const result = mergeRead(stored(probe("old", 5)), collection);
  assert.deepEqual(accepted(result).observed, { epoch: 3, itemsRevision: null, itemCount: null, compositions: { "2": 11 } }, "it holds one composition and never the item list");
});

test("a scoped read replaces its compositions by id, keeps the rest, and updates the revision of only what it returned", () => {
  const base = stored(probe("base", 10)), edited = comp("2", [layer("2-l1", "renamed")]);
  const result = mergeRead(base, probe("scoped", 12, { compositions: [edited] }, { items: "skipped" }), ["2"]);
  const snapshot = merged(result);
  assert.deepEqual(idsOf(snapshot), ["2", "3"], "project order is kept");
  assert.strictEqual(compositionsOf(snapshot)[0], edited); assert.strictEqual(compositionsOf(snapshot)[1], compositionsOf(base.snapshot)[1], "what was not read is the base's own");
  assert.strictEqual(raw(snapshot).items, raw(base.snapshot).items, "the item list is kept"); assert.strictEqual(raw(snapshot).sources, raw(base.snapshot).sources);
  assert.deepEqual(accepted(result).observed, { epoch: 3, itemsRevision: 10, itemCount: 4, compositions: { "2": 12, "3": 10 } });
  assert.equal(snapshot.requestId, "scoped", "the read names the merged snapshot"); assert.deepEqual(raw(snapshot).hostStamp, { epoch: 3, revision: 12 });
});

test("a merged snapshot looks exactly like a full one: no coverage, the full read's scope, and the fingerprint of the same project read whole", () => {
  const base = stored(probe("base", 10)), edited = comp("2", [layer("2-l1", "renamed")]);
  const snapshot = merged(mergeRead(base, probe("scoped", 12, { compositions: [edited] }, { items: "skipped" }), ["2"]));
  assert.equal("coverage" in raw(snapshot), false); assert.deepEqual(raw(snapshot).readScope, { compositions: "all", items: "read" });
  const whole = probe("whole", 12, { compositions: [edited, comp("3")] });
  assert.equal(fingerprintOf(snapshot), fingerprintOf(whole));
  assert.equal(normalizeProbeSnapshot(snapshot).coverage, undefined);
});

test("an identical re-read keeps the fingerprint, whatever the host stamp says", () => {
  const base = stored(probe("base", 10)), again = merged(mergeRead(base, probe("again", 25, { compositions: [comp("2")] }, { items: "skipped" }), ["2"]));
  assert.equal(fingerprintOf(again), fingerprintOf(base.snapshot), "AE's revision counter moves on clicks and is not part of the project");
});

test("a read that includes the items replaces them, drops compositions the list no longer names, and orders by the list", () => {
  const base = stored(probe("base", 10));
  const items = [item("3", "composition"), item("7", "composition"), item("1", "footage")], sources = SOURCES.slice(0, 1);
  const read = probe("items", 12, { items, sources, itemCount: 3, compositions: [comp("7")], revision: "3:7" }, { items: "read" });
  const result = mergeRead(base, read, ["7"]), snapshot = merged(result);
  assert.deepEqual(idsOf(snapshot), ["3", "7"], "2 left the project; the list's order puts 3 before 7");
  assert.strictEqual(raw(snapshot).items, items);
  assert.deepEqual(accepted(result).observed, { epoch: 3, itemsRevision: 12, itemCount: 3, compositions: { "3": 10, "7": 12 } });
});

test("a requested composition the host no longer has is dropped, unless it was left unread or oversized", () => {
  const base = stored(probe("base", 10));
  assert.deepEqual(idsOf(merged(mergeRead(base, probe("gone", 11, { compositions: [] }, { items: "skipped" }), ["3"]))), ["2"], "asked for, not returned, not a gap: deleted");
  const oversized = merged(mergeRead(base, probe("big", 11, { compositions: [], compositionPages: { unread: [], oversized: ["3"], capped: false } }, { items: "skipped" }), ["3"]));
  assert.deepEqual(idsOf(oversized), ["2", "3"], "an oversized composition is unknown, not gone: the base's copy stays");
  assert.deepEqual(raw(oversized).compositionPages, { unread: [], oversized: ["3"], capped: false });
  assert.ok(oversized.warnings.includes("composition-count-limit"), "and the snapshot still says part of it was not read");
  assert.deepEqual(idsOf(merged(mergeRead(base, probe("blind", 11, { compositions: [] }, { items: "skipped" })))), ["2", "3"], "without a record of what was asked, nothing is deleted for being absent");
});

test("a read that closes the gaps clears them and the unread warning", () => {
  const base = stored(probe("base", 10, { compositions: [comp("2")], compositionPages: { unread: ["3"], oversized: [], capped: false }, warnings: ["composition-count-limit", "layer-count-limit:Comp 2"] }));
  const snapshot = merged(mergeRead(base, probe("rest", 11, { compositions: [comp("3")] }, { items: "skipped" }), ["3"]));
  assert.deepEqual(raw(snapshot).compositionPages, { unread: [], oversized: [], capped: false });
  assert.deepEqual(snapshot.warnings, ["layer-count-limit:Comp 2"], "the warning of a limit that no longer applies goes; the others are united without repeats");
});

test("warnings are united without repeats, truncation is sticky, and the interrupted apply is the read's own", () => {
  const base = stored(probe("base", 10, { truncation: { truncated: true, limits: { maxReadMs: 3000 } }, interruptedApply: { planId: "p", index: 1, startedAt: "1" }, warnings: ["unverified-host-version:26.2", "layer-count-limit:Comp 2"] }));
  const snapshot = merged(mergeRead(base, probe("scoped", 11, { compositions: [comp("2")], warnings: ["layer-count-limit:Comp 2", "extra"] }, { items: "skipped" }), ["2"]));
  assert.deepEqual(snapshot.warnings, ["unverified-host-version:26.2", "layer-count-limit:Comp 2", "extra"]);
  assert.equal(objectOf(raw(snapshot).truncation)?.truncated, true); assert.equal("interruptedApply" in raw(snapshot), false, "a breadcrumb the host no longer reports is gone");
});

test("a scoped read that cannot be placed is refused, and the refusal names why", () => {
  const scoped = (revision = 12, over: Over = {}) => probe("scoped", revision, { compositions: [comp("2")], ...over }, { items: "skipped" });
  const reason = (base: StoredSnapshot | undefined, read: ProbeSnapshot) => { const result = mergeRead(base, read, ["2"]); return result.ok ? "merged" : result.reason; };
  assert.equal(reason(undefined, scoped()), "no-base");
  const covered = probe("covered", 10, { coverage: { kind: "composition-metadata", compositionId: "2", properties: "unknown", otherCompositions: "unknown" } });
  assert.equal(reason(stored(covered), scoped()), "base-is-coverage");
  assert.equal(reason(stored(probe("b", 10, { project: { name: "Other", filePath: "/p/fixture.aep" } })), scoped()), "other-project", "the name");
  assert.equal(reason(stored(probe("b", 10, { project: { name: "Fixture", filePath: "/p/other.aep" } })), scoped()), "other-project", "the file");
  assert.equal(reason(stored(probe("b", 10, { hostStamp: { epoch: 4, revision: 10 } })), scoped()), "other-epoch");
  assert.equal(reason(stored(probe("b", 10)), scoped(12, { hostStamp: undefined })), "read-has-no-stamp");
  assert.equal(reason(stored(probe("b", 10, { hostStamp: undefined })), scoped()), "base-has-no-stamp");
  assert.equal(reason(stored(probe("b", 10)), scoped()), "merged");
});

test("a project that gained a composition has one fingerprint however After Effects ordered its lists: the snapshot an apply posts equals a full read taken later", () => {
  const base = stored(probe("base", 10)), made = comp("9");
  const justAfter = [item("1", "footage"), item("2", "composition"), item("3", "composition"), item("9", "composition"), item("4", "footage")];
  const later = [item("1", "footage"), item("2", "composition"), item("9", "composition"), item("3", "composition"), item("4", "footage")];
  const afterApply = merged(mergeRead(base, probe("apply", 12, { items: justAfter, itemCount: 5, compositions: [made], revision: "5:2" }, { items: "read" }), ["9"]));
  const fullRead = probe("full", 12, { items: later, itemCount: 5, compositions: [comp("2"), made, comp("3")], revision: "5:2" });
  assert.deepEqual(idsOf(afterApply), ["2", "3", "9"]); assert.deepEqual(idsOf(fullRead), ["2", "9", "3"], "the two orders differ");
  assert.equal(fingerprintOf(afterApply), fingerprintOf(fullRead));
  const gone = probe("gone", 12, { items: later, itemCount: 5, compositions: [comp("2"), comp("3")], revision: "5:2" });
  assert.notEqual(fingerprintOf(gone), fingerprintOf(fullRead), "a composition that is really missing still reads as a change");
});
