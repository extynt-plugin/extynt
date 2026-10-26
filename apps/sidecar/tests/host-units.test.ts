/** The pure parts of the reader lane: the focus report built from an event, the frame a thumbnail pictures, the hash index after a read, and the narrowing of read results. */
import assert from "node:assert/strict";
import test from "node:test";
import { initialWatchState, makeProject } from "@extynt/fake-plugin";
import { focusBodyOf } from "../src/host/focus-body.js";
import { indexAfter } from "../src/host/hash-memory.js";
import { decode } from "@extynt/decode";
import type { NativeReadResult } from "@extynt/host-native";
import { nativeReadResult } from "../src/host/read-parse.js";
import { thumbTargetFor } from "../src/host/thumb-target.js";
import { chipLayers } from "../src/live-focus.js";
import { focusOf, liveFocusReport } from "../src/live-focus-report.js";
import type { NativeReadSet } from "../src/native-snapshot/index.js";
import { validSnapshot } from "./sidecar-fixture.js";

const readOf = <T>(value: T): NativeReadResult | null => { const result = decode(nativeReadResult, value); return result.ok ? result.value : null; };

const watch = () => initialWatchState(makeProject());

test("the focus report an event becomes passes the strict parser, whatever the event carried", () => {
  const state = { ...watch(), selection: ["11", "12", "bad id with spaces"], selectedLayers: [{ id: "11", index: 1, name: "Title" }, { id: "99", index: 9, name: "not selected" }], time: 3.25, items: 7 };
  const decoded = decode(liveFocusReport, focusBodyOf(state, 1000));
  assert.ok(decoded.ok);
  if (!decoded.ok) return;
  const focus = focusOf(decoded.value, 2000);
  assert.deepEqual(focus.selected, ["11", "12"], "an id the report cannot carry is dropped, not fatal");
  assert.deepEqual(focus.selectedLayers, [{ id: "11", index: 1, name: "Title" }], "a name for a layer that is not selected is dropped");
  assert.deepEqual([focus.time, focus.items, focus.observedAt, focus.receivedAt], [3.25, 7, 1000, 2000]);
});

test("a project with nothing open is a valid, empty focus", () => {
  const empty = { epoch: 3, revision: null, items: null, projectName: "", projectPath: null, activeCompId: null, activeCompName: null, time: null, selection: [], selectedLayers: [] };
  const decoded = decode(liveFocusReport, focusBodyOf(empty, 5));
  assert.ok(decoded.ok);
  assert.equal(decoded.ok && focusOf(decoded.value, 5).revision, null);
});

test("the chip lists at most eight names, each at most 128 characters", () => {
  const layers = Array.from({ length: 20 }, (_, index) => ({ id: String(index), index, name: "n".repeat(500) }));
  const chip = chipLayers({ selectedLayers: layers });
  assert.equal(chip.length, 8);
  assert.ok(chip.every((layer) => layer.name.length === 128));
});

const snapshotWith = (composition: { width: number; height: number; duration?: number; frameRate?: number; currentTime?: number; backgroundColor?: number[] }) => ({ ...validSnapshot, result: { ...validSnapshot.result, activeCompositionId: "c1", currentTime: 2, compositions: [{ id: "c1", name: "Main", ...composition }] } });

test("a thumbnail pictures the first composition a visual plan names, at its time clamped inside the composition", () => {
  const snapshot = snapshotWith({ width: 1920, height: 1080, duration: 10, frameRate: 25, currentTime: 12, backgroundColor: [0.1, 0.2, 2] });
  const target = thumbTargetFor([{ type: "set_layer_property", compositionId: "c1", layerId: "l1" }], snapshot);
  assert.deepEqual(target, { compositionId: "c1", name: "Main", width: 1920, height: 1080, time: 9.96, background: [0.1, 0.2, 1] });
  assert.equal(thumbTargetFor([{ type: "set_layer_name", compositionId: "c1", layerId: "l1" }], snapshot), null, "nothing a frame shows");
  assert.equal(thumbTargetFor([{ type: "set_composition_settings", compositionId: "c1" }], snapshot), null, "the frame itself changes shape");
  assert.equal(thumbTargetFor([{ type: "set_layer_property", compositionId: "elsewhere" }], snapshot), null, "a composition the snapshot does not hold");
  assert.equal(thumbTargetFor([{ type: "set_layer_property", compositionId: "c1" }], snapshotWith({ width: 8, height: 1080 })), null, "a size the host cannot capture");
});

const read = (scope: NativeReadSet["scope"], ids: string[]): NativeReadSet => ({
  stamp: { ...watch() }, comps: ids.map((id) => ({ source: "native", project: { name: "p", filePath: null, dirty: false }, itemCount: 0, selectedLayerIds: [], warnings: [], compositions: [{ id, hash: `c-${id}`, layers: [{ id: `${id}-1`, hash: "x", propertyPaths: [] }] }] })),
  ping: { pong: true, mainThread: false, pluginVersion: "1", aeVersion: "25.0", pid: 1, host: null, arch: "arm64", idleAgeMs: 1, idleTicks: 1, queueDepth: 0, oldestQueuedMs: null, watchers: 1, library: { version: null, entryFile: null } }, requestId: "r", scope,
});

test("the hash index after a scoped read keeps the compositions it did not read and replaces the ones it did", () => {
  const first = indexAfter(undefined, read({ kind: "compositions", ids: ["a", "b"], includeItems: false }, ["a", "b"]));
  assert.deepEqual(Object.keys(first.compositions).sort(), ["a", "b"]);
  const next = indexAfter(first, read({ kind: "compositions", ids: ["b", "gone"], includeItems: false }, ["b"]));
  assert.deepEqual(Object.keys(next.compositions).sort(), ["a", "b"], "a was kept, gone was asked for and is not there");
  assert.equal(next.compositions.b?.hash, "c-b");
});

test("a read result is narrowed member by member, and one that is not a read is refused", () => {
  const good = { source: "native", project: { name: "p", filePath: "/p.aep", dirty: true }, itemCount: 2, selectedLayerIds: ["1"], compositions: [{ id: "c" }], warnings: ["w"], currentTime: 1, activeCompositionId: "c" };
  assert.deepEqual(readOf(good)?.project, { name: "p", filePath: "/p.aep", dirty: true });
  assert.equal(readOf(good)?.currentTime, 1);
  for (const bad of [null, "x", { ...good, source: "other" }, { ...good, project: { name: 3 } }, { ...good, compositions: "no" }, { ...good, itemCount: "2" }, { ...good, warnings: [1] }]) assert.equal(readOf(bad), null);
  assert.deepEqual(readOf({ ...good, selectedLayerIds: undefined, warnings: undefined })?.warnings, [], "a plugin that omits an empty list is not refused");
});
