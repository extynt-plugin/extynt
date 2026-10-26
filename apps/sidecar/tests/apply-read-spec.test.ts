/** What the sidecar tells the panel to read around an apply and an undo: judged from the plan and the sidecar's own record, never from the panel. */
import assert from "node:assert/strict";
import test from "node:test";
import { decode, jsonObject, type JsonObject } from "@extynt/decode";
import { applyReadsFor, reachOf, undoReadsFor, withApplyReads } from "../src/apply-read-spec.js";
import { snapshotView, type Opaque } from "../src/snapshot-view.js";
import { observedOfWhole } from "../src/snapshot-merge.js";
import type { ProbeSnapshot } from "../src/server-types.js";
import { read } from "./read-fixture.js";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
type Row = JsonObject;
type ApplyReadState = Parameters<typeof applyReadsFor>[0];
const SKIP_STAMP_MAX_AGE_MS = 2000;
const must = <T>(value: T | undefined | null): T => { assert.ok(value !== undefined && value !== null); return value; };
const rowOf = (value: Opaque): Row => { const decoded = decode(jsonObject, value); assert.ok(decoded.ok); return decoded.value; };
const readsFor = (state: ApplyReadState, command: Row): NonNullable<ReturnType<typeof applyReadsFor>> => must(applyReadsFor(state, command));
const rename = { operation: "set_layer_name", compositionId: "comp-1", layerId: "layer-1", name: "x" };
const blur = { operation: "set_layer_property", compositionId: "comp-1", layerId: "layer-1", propertyPath: "ADBE Transform Group/ADBE Position", role: "position", value: [1, 2] };
const apply = (...operations: Row[]): Row => ({ operation: "apply_plan", planId: "p1", undoGroup: "g", operations });

function world(over: { stamp?: Partial<NonNullable<ApplyReadState["liveStamp"]>> | null; read?: ProbeSnapshot; observed?: Record<string, number | null>; itemsRevision?: number | null; readAt?: number } = {}): ApplyReadState {
  const snapshot = over.read ?? read("r0", 10), observed = observedOfWhole(snapshot);
  if (over.observed) Object.assign(observed.compositions, over.observed);
  if (over.itemsRevision !== undefined) observed.itemsRevision = over.itemsRevision;
  return { latest: { snapshot, receivedAt: new Date(over.readAt ?? NOW - 60_000).toISOString(), bytes: 1, observed }, liveStamp: over.stamp === null ? null : { epoch: 3, revision: 10, items: 2, at: NOW, ...over.stamp }, now: () => new Date(NOW), readSequence: 0, issuedReads: new Map() };
}

test("a plan's reach is the compositions it names that the snapshot holds, the item list when it touches items, and whether it makes things", () => {
  const snapshot = read("r", 10);
  assert.deepEqual(reachOf([rename], snapshot), { compositionIds: ["comp-1"], items: false, creates: false, picture: false });
  assert.deepEqual(reachOf([blur], snapshot).compositionIds, ["comp-1"]); assert.equal(reachOf([blur], snapshot).picture, true, "a visual change may be pictured");
  assert.equal(reachOf([{ operation: "create_layer", compositionId: "comp-2", layerId: "__new__:layer1" }], snapshot).items, false, "a new layer lives inside a composition");
  assert.equal(reachOf([{ operation: "create_layer", compositionId: "comp-2", layerId: "__new__:layer1", sourceItemId: "comp-1" }], snapshot).items, false, "a composition used as a source is not a footage item");
  const made = reachOf([{ operation: "create_composition", newCompositionId: "__new__:comp1", name: "n" }, { operation: "create_layer", compositionId: "__new__:comp1", layerId: "__new__:layer1" }], snapshot);
  assert.deepEqual([made.compositionIds, made.items, made.creates, made.picture], [[], true, true, false]);
  assert.equal(reachOf([{ operation: "set_item_name", itemId: "comp-2", name: "z" }], snapshot).items, true, "an item-level operation reads the item list");
  assert.deepEqual(reachOf([{ type: "set_layer_name", target: { compositionId: "comp-1", layerId: "layer-1" } }], snapshot).compositionIds, ["comp-1"], "a stored plan's operations are scanned the same way");
});

test("a layer that is backed by a solid reads the item list afterwards, so the next plan is made against the project that has the solid", () => {
  const snapshot = read("r", 10), layer = (layerType: string): Row => ({ operation: "create_layer", compositionId: "comp-1", layerId: "__new__:layer1", layerType });
  for (const layerType of ["null", "solid", "adjustment"]) assert.equal(reachOf([layer(layerType)], snapshot).items, true, `${layerType} makes a solid item`);
  for (const layerType of ["text", "shape", "camera", "light", "footage"]) assert.equal(reachOf([layer(layerType)], snapshot).items, false, `${layerType} makes no item`);
  const derive = (kind: string): Row => ({ operation: "derive_layer", compositionId: "comp-1", layerId: "layer-1", kind, newLayerId: "__new__:layer2" });
  assert.equal(reachOf([derive("path-null")], snapshot).items, true);
  assert.equal(reachOf([derive("split")], snapshot).items, false);
  const verify = readsFor(world(), apply(layer("null"))).verify;
  assert.deepEqual(verify.read, { scope: "compositions", compositionIds: ["comp-1"], includeItems: true }, "the verify read carries the item list");
});

test("the precheck is skipped exactly when AE's stamp is the one last read and every composition the plan names is current", () => {
  const state = world(), reads = readsFor(state, apply(rename));
  assert.equal(reads.precheck, null, "nothing happened since the last read");
  assert.deepEqual(reads.expectedStamp, { epoch: 3, revision: 10 }, "the host must still find that stamp before it writes");
  const preApply = snapshotView(must(reads.preApply));
  assert.deepEqual(preApply.compositions.map((composition) => composition.id), ["comp-1"], "the panel's comparison holds only the plan's compositions");
  assert.equal(preApply.itemsLength, 0);
  const refused = (label: string, over: Parameters<typeof world>[0]): void => assert.notEqual(readsFor(world(over), apply(rename)).precheck, null, label);
  refused("no stamp", { stamp: null });
  refused("a stamp older than the limit", { stamp: { at: NOW - SKIP_STAMP_MAX_AGE_MS - 1 } });
  refused("AE moved on", { stamp: { revision: 11 } });
  refused("a stamp from before the last read says nothing that read did not see", { stamp: { at: NOW - 1000 }, readAt: NOW - 500 });
  refused("another project", { stamp: { epoch: 4 } });
  refused("the composition was last read at an older revision", { observed: { "comp-1": 9 } });
  assert.equal(readsFor(world({ stamp: { at: NOW - SKIP_STAMP_MAX_AGE_MS } }), apply(rename)).precheck, null, "at the limit exactly it still counts");
  assert.equal(readsFor(world({ observed: { "comp-2": 9 } }), apply(rename)).precheck, null, "a composition the plan does not name may be older");
  assert.deepEqual(readsFor(world(), apply({ operation: "set_layer_name", compositionId: "__new__:comp1", layerId: "x", name: "n" })).precheck?.read, { scope: "full" }, "a plan that names no composition the snapshot holds reads the whole project");
});

test("a visual plan skips its precheck under the same conditions as any plan", () => {
  const visual = readsFor(world(), apply(blur));
  assert.equal(visual.precheck, null, "the stamp is current and the composition was read at it");
  assert.deepEqual(visual.expectedStamp, { epoch: 3, revision: 10 });
  assert.notEqual(readsFor(world({ stamp: { revision: 11 } }), apply(blur)).precheck, null, "and it is read when AE moved on, like any other plan");
});

test("the items count: a plan that needs the item list skips its precheck only when the list was read at this revision with this count", () => {
  const itemOp = { operation: "create_folder", newFolderId: "__new__:folder1", name: "f" }, onComp = rename;
  assert.equal(readsFor(world(), apply(onComp, itemOp)).precheck, null);
  assert.deepEqual(readsFor(world({ itemsRevision: 9 }), apply(onComp, itemOp)).precheck?.read, { scope: "compositions", compositionIds: ["comp-1"], includeItems: true });
  assert.notEqual(readsFor(world({ stamp: { items: 3 } }), apply(onComp, itemOp)).precheck, null, "an item was added or removed since");
  assert.equal(readsFor(world({ itemsRevision: 9 }), apply(onComp)).precheck, null, "a plan inside one composition does not need the list");
});

test("verify reads the whole project when the plan makes compositions, imports or precomposes, else only what it names", () => {
  const scope = (...operations: Row[]): Opaque => readsFor(world({ stamp: null }), apply(...operations)).verify.read;
  assert.deepEqual(scope(rename), { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.deepEqual(scope(rename, { operation: "set_item_name", itemId: "comp-2", name: "z" }), { scope: "compositions", compositionIds: ["comp-1", "comp-2"], includeItems: true });
  for (const kind of ["create_composition", "import_file", "precompose_layers"]) assert.deepEqual(scope(rename, { operation: kind, compositionId: "comp-1" }), { scope: "full" }, kind);
  assert.deepEqual(scope({ operation: "set_project_settings", settings: {} }), { scope: "full" }, "nothing to scope to");
  const reads = readsFor(world({ stamp: null }), apply(rename));
  assert.match(reads.verify.readId, /^read-/); assert.equal(reads.verify.reason, "apply");
});

test("each read is named and remembered, so its answer is placed on what was asked", () => {
  const state = world({ stamp: null }), reads = readsFor(state, apply(blur));
  assert.notEqual(must(reads.precheck).readId, reads.verify.readId);
  assert.deepEqual(state.issuedReads.get(must(reads.precheck).readId), must(reads.precheck).read);
  assert.deepEqual(state.issuedReads.get(reads.verify.readId), reads.verify.read);
});

test("an apply item carries the reads and, when the precheck is skipped, the stamp in its command; other commands are left alone", () => {
  const data = { planId: "p1", command: apply(rename) }, item = withApplyReads(world(), data);
  assert.deepEqual(rowOf(item.command).expectedStamp, { epoch: 3, revision: 10 }); assert.equal(rowOf(data.command).expectedStamp, undefined, "the stored command is not changed");
  assert.equal(rowOf(item.reads).precheck, null);
  const stale = withApplyReads(world({ stamp: { revision: 12 } }), data);
  assert.equal(rowOf(stale.command).expectedStamp, undefined);
  const metadata = { planId: "p2", command: { ...apply(rename), readSet: { schemaVersion: "metadata-read-set/1" } } };
  assert.equal(withApplyReads(world(), metadata), metadata, "a metadata read-set plan keeps its own path");
  assert.equal(withApplyReads({ ...world(), latest: undefined }, data), data);
});

test("an undo's guard is a whole-project read and the read after it covers what the plan touched", () => {
  const state = world(), reads = undoReadsFor(state, [blur]);
  assert.deepEqual(reads.guard.read, { scope: "full" }); assert.equal(reads.guard.reason, "undo");
  assert.deepEqual(reads.after.read, { scope: "compositions", compositionIds: ["comp-1"], includeItems: false });
  assert.deepEqual(undoReadsFor(state, [{ operation: "create_composition", newCompositionId: "__new__:comp1" }]).after.read, { scope: "full" }, "what the plan made is gone, and only the whole project shows it");
  assert.deepEqual(undoReadsFor({ ...state, latest: undefined }, [blur]).after.read, { scope: "full" });
});

test("resize_solid reads the item list afterwards: the solid's size rides in the source rows, so a layer-only read would leave the held fingerprint stale for the next whole-project plan", () => {
  const snapshot = read("r", 10), resize = { operation: "resize_solid", compositionId: "comp-1", layerId: "layer-1", width: 320 };
  assert.equal(reachOf([resize], snapshot).items, true);
  assert.deepEqual(readsFor(world(), { operation: "apply_plan", operations: [resize] }).verify.read, { scope: "compositions", compositionIds: ["comp-1"], includeItems: true });
});
