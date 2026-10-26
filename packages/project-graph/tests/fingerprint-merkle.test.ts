/** The project fingerprint is a Merkle hash: same content hashes the same however it is ordered, any included field moves it, no excluded field does, and the incremental path equals the from-scratch one. */
import assert from "node:assert/strict";
import test from "node:test";
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "@extynt/decode";
import {
  FINGERPRINT_PREFIX, canonicalSnapshot, createFingerprintMemo, createSnapshot, freezeDeep, graphFingerprint, isCurrentFingerprint, isLegacyFingerprint, projectFingerprint,
  representativeSnapshot, selectionFingerprint, type CompositionSnapshot, type LayerSnapshot, type ProjectItemSnapshot, type ProjectSnapshot,
  type PropertySnapshot, type SnapshotInput, type SourceSnapshot,
} from "../src/index.js";
import { compositionAt, layerAt, required } from "./snapshot-parts.js";

const fresh = (): ProjectSnapshot => structuredClone(representativeSnapshot);
const layerOf = (snapshot: ProjectSnapshot, comp = 0, layer = 1): LayerSnapshot => layerAt(snapshot, layer, comp);
const withProperty = (property: PropertySnapshot): ProjectSnapshot => { const snapshot = fresh(); layerOf(snapshot).properties.push(property); return snapshot; };
const leaf = (over: Partial<PropertySnapshot> = {}): PropertySnapshot => ({ path: "ADBE Transform Group/ADBE Opacity", matchName: "ADBE Opacity", displayName: "Opacity", kind: "property", valueType: "number", value: 50, canSetValue: true, ...over });

function reorderedValue(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(reorderedValue);
  return isJsonObject(value) ? reordered(value) : value;
}

function reordered(record: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(record).reverse().map(([key, child]) => [key, reorderedValue(child)]));
}

test("the fingerprint is a prefixed 128-bit hex digest, and the earlier 8-digit form is recognised as legacy", () => {
  const fingerprint = graphFingerprint(representativeSnapshot);
  assert.match(fingerprint, /^fp3-[0-9a-f]{32}$/);
  assert.equal(fingerprint.startsWith(FINGERPRINT_PREFIX), true);
  assert.equal(isCurrentFingerprint(fingerprint), true);
  assert.equal(isLegacyFingerprint(fingerprint), false);
  assert.equal(isLegacyFingerprint("cf49f7fc"), true);
  assert.equal(isLegacyFingerprint("fp2-8d3e2c3c0123456789abcdef01234567"), true, "the version that read list order as content is an earlier one too");
  assert.equal(isCurrentFingerprint("fp2-8d3e2c3c0123456789abcdef01234567"), false);
  assert.equal(isCurrentFingerprint("cf49f7fc"), false);
  for (const odd of ["", "CF49F7FC", "cf49f7f", "cf49f7fcc", undefined, null, 12345678, "fp2-abc"]) { assert.equal(isLegacyFingerprint(odd), false, String(odd)); assert.equal(isCurrentFingerprint(odd), false, String(odd)); }
  assert.match(selectionFingerprint(representativeSnapshot), /^fp3-[0-9a-f]{32}$/);
});

test("the same content hashes the same whatever the order of its keys", () => {
  const shuffled = reordered(fresh());
  assert.notDeepEqual(Object.keys(shuffled), Object.keys(fresh()), "the shuffle did reorder");
  assert.equal(projectFingerprint(shuffled), graphFingerprint(representativeSnapshot));
  assert.equal(projectFingerprint(reordered(withProperty(leaf({ keyframeCount: 2 })))), graphFingerprint(withProperty(leaf({ keyframeCount: 2 }))));
});

test("array order is content for layers and properties", () => {
  const base = graphFingerprint(representativeSnapshot);
  const layers = fresh(); compositionAt(layers).layers.reverse();
  const props = fresh(); layerOf(props, 0, 0).properties.reverse();
  for (const changed of [layers, props]) assert.notEqual(graphFingerprint(changed), base);
});

type Listed = ProjectSnapshot & { items: ProjectItemSnapshot[]; sources: SourceSnapshot[] };
function listed(): Listed {
  const snapshot: Listed = { ...fresh(), items: [], sources: [] };
  const first = compositionAt(snapshot);
  snapshot.compositions = ["1", "444", "457"].map((id) => ({ ...structuredClone(first), id, name: `Comp ${id}` }));
  snapshot.items = ["1", "444", "457"].map((id) => ({ id, name: `Comp ${id}`, type: "composition", parentFolderId: null, compositionId: id, sourceId: null }));
  snapshot.sources = ["s1", "s2"].map((id) => ({ id, name: id, type: "footage", filePath: `/media/${id}.mov`, missing: false }));
  return snapshot;
}

test("the order of compositions, items and sources is not content: After Effects lists a new item in another place right after it is made than a read taken later does", () => {
  const base = listed(), afterApply = listed(), laterRead = listed();
  const move = <T>(list: T[], from: number, to: number): void => { list.splice(to, 0, ...list.splice(from, 1)); };
  move(laterRead.compositions, 2, 1); move(laterRead.items, 2, 1); laterRead.sources.reverse();
  assert.notDeepEqual(laterRead.compositions.map((composition) => composition.id), afterApply.compositions.map((composition) => composition.id), "the lists really are in another order");
  assert.equal(graphFingerprint(laterRead), graphFingerprint(afterApply));
  assert.equal(createSnapshot(laterRead).fingerprint, createSnapshot(base).fingerprint);
  assert.equal(projectFingerprint(canonicalSnapshot(laterRead)), graphFingerprint(afterApply));
});

test("a change to a composition, an item or a source still changes the fingerprint when the lists are reordered, and a member is never counted twice", () => {
  const base = graphFingerprint(listed());
  const edited = (change: (snapshot: Listed) => void): string => { const snapshot = listed(); snapshot.compositions.reverse(); snapshot.items.reverse(); snapshot.sources.reverse(); change(snapshot); return graphFingerprint(snapshot); };
  assert.equal(edited(() => undefined), base);
  assert.notEqual(edited((snapshot) => { compositionAt(snapshot).name = "Renamed"; }), base);
  assert.notEqual(edited((snapshot) => { snapshot.compositions.pop(); }), base);
  assert.notEqual(edited((snapshot) => { snapshot.items[0] = { ...required(snapshot.items[0], "an item"), name: "Renamed" }; }), base);
  assert.notEqual(edited((snapshot) => { snapshot.items.pop(); }), base);
  assert.notEqual(edited((snapshot) => { snapshot.sources[0] = { ...required(snapshot.sources[0], "a source"), missing: true }; }), base);
  assert.notEqual(edited((snapshot) => { snapshot.items.push(structuredClone(required(snapshot.items[0], "an item"))); }), base, "a repeated item is a change");
  assert.notEqual(edited((snapshot) => { snapshot.compositions.push(structuredClone(compositionAt(snapshot))); }), base, "a repeated composition is a change");
  assert.notEqual(edited((snapshot) => { snapshot.items = []; }), edited((snapshot) => { snapshot.items = [{ id: "x", name: "x", type: "folder", parentFolderId: null, compositionId: null, sourceId: null }]; }));
  const layers = listed(); layers.compositions.reverse(); compositionAt(layers).layers.reverse();
  assert.notEqual(graphFingerprint(layers), base, "layer order inside a composition still counts");
});

test("the memoised path gives the same fingerprint for a reordered, frozen list", () => {
  const memo = createFingerprintMemo(), once = listed(), reversed = listed();
  reversed.compositions.reverse(); reversed.items.reverse();
  assert.equal(graphFingerprint(freezeDeep(reversed), memo), graphFingerprint(freezeDeep(once), memo));
});

type Edit = [string, (snapshot: ProjectSnapshot) => void];

function layerEdits(): Edit[] {
  const base = layerOf(fresh());
  const patches: Array<[string, Partial<LayerSnapshot>]> = [
    ["id", { id: "other" }], ["index", { index: 9 }], ["name", { name: "Renamed" }], ["type", { type: "camera" }], ["enabled", { enabled: !base.enabled }], ["shy", { shy: !base.shy }],
    ["solo", { solo: !base.solo }], ["locked", { locked: !base.locked }], ["startTime", { startTime: 1 }], ["inPoint", { inPoint: 1 }], ["outPoint", { outPoint: 9 }], ["stretch", { stretch: 50 }],
    ["parentId", { parentId: "layer-x" }], ["matteLayerId", { matteLayerId: "layer-y" }], ["matteType", { matteType: "alpha" }], ["label", { label: 3 }], ["sourceId", { sourceId: "src" }],
    ["compositionSourceId", { compositionSourceId: "comp-x" }],
  ];
  return patches.map(([name, patch]) => [`layer.${name}`, (snapshot) => { Object.assign(layerOf(snapshot), patch); }]);
}

function compositionEdits(): Edit[] {
  const patches: Array<[string, Partial<CompositionSnapshot>]> = [
    ["id", { id: "c" }], ["name", { name: "N" }], ["width", { width: 1 }], ["height", { height: 2 }], ["pixelAspect", { pixelAspect: 2 }], ["duration", { duration: 99 }], ["frameRate", { frameRate: 60 }],
    ["workAreaStart", { workAreaStart: 1 }], ["workAreaDuration", { workAreaDuration: 2 }], ["itemIndex", { itemIndex: 7 }], ["backgroundColor", { backgroundColor: [1, 0, 0] }],
  ];
  return patches.map(([name, patch]) => [`composition.${name}`, (snapshot) => { Object.assign(compositionAt(snapshot), patch); }]);
}

function projectEdits(): Edit[] {
  const item: ProjectItemSnapshot = { id: "1", name: "f", type: "footage", parentFolderId: null, compositionId: null, sourceId: null };
  const source: SourceSnapshot = { id: "1", name: "f", type: "footage", filePath: null, missing: true };
  return [
    ["host.version", (snapshot) => { snapshot.host.version = "99"; }],
    ["project.name", (snapshot) => { snapshot.project.name = "Other"; }],
    ["project.filePath", (snapshot) => { snapshot.project.filePath = null; }],
    ["items", (snapshot) => { snapshot.items = [item]; }],
    ["sources", (snapshot) => { snapshot.sources = [source]; }],
    ["coverage", (snapshot) => { snapshot.coverage = { kind: "composition-metadata", compositionId: "comp-main", properties: "unknown", otherCompositions: "unknown" }; }],
    ["composition added", (snapshot) => { snapshot.compositions.push({ ...structuredClone(compositionAt(snapshot)), id: "extra" }); }],
    ["layer removed", (snapshot) => { compositionAt(snapshot).layers.pop(); }],
  ];
}

const includedEdits = (): Edit[] => [...layerEdits(), ...compositionEdits(), ...projectEdits()];

test("a change to any included field changes the fingerprint", () => {
  const base = graphFingerprint(representativeSnapshot);
  const seen = new Set<string>([base]);
  for (const [name, edit] of includedEdits()) {
    const snapshot = fresh(); edit(snapshot);
    const changed = graphFingerprint(snapshot);
    assert.notEqual(changed, base, name);
    assert.equal(seen.has(changed), false, `${name} collides with another edit`);
    seen.add(changed);
  }
});

function propertyEdits(): Array<[string, Partial<PropertySnapshot>]> {
  return [["path", { path: "ADBE Transform Group/ADBE Other" }], ["matchName", { matchName: "ADBE Other" }], ["displayName", { displayName: "Other" }], ["kind", { kind: "group" }], ["valueType", { valueType: "string" }],
    ["value", { value: 51 }], ["canSetValue", { canSetValue: false }], ["enabled", { enabled: false }], ["keyDigest", { keyDigest: "abc" }], ["hidden", { hidden: true }], ["animatable", { animatable: false }],
    ["expression", { expression: "time" }], ["expressionEnabled", { expressionEnabled: false }], ["keyframeCount", { keyframeCount: 4 }], ["children", { children: [leaf({ path: "ADBE Transform Group/ADBE Opacity/Child", matchName: "Child" })] }]];
}

test("a change to any field of a property changes the fingerprint, nested ones included", () => {
  const base = graphFingerprint(withProperty(leaf()));
  for (const [name, over] of propertyEdits()) assert.notEqual(graphFingerprint(withProperty(leaf(over))), base, name);
  const nested = (value: number) => withProperty(leaf({ children: [leaf({ path: "a/b", matchName: "b", value })] }));
  assert.notEqual(graphFingerprint(nested(1)), graphFingerprint(nested(2)));
});

test("observation state never changes the fingerprint", () => {
  const base = graphFingerprint(representativeSnapshot);
  const volatile: Array<(snapshot: ProjectSnapshot) => void> = [
    (s) => { s.capturedAt = "2030-01-01T00:00:00.000Z"; }, (s) => { s.currentTime = 99; }, (s) => { s.selection = { compositionId: "comp-square", layerIds: [] }; },
    (s) => { s.activeCompositionId = "comp-square"; }, (s) => { s.revision = "other"; }, (s) => { s.hostStamp = { epoch: 9, revision: 9 }; }, (s) => { s.freshness = { revision: "r", capturedAt: "x", receivedAt: "y" }; },
    (s) => { s.warnings = ["composition-count-limit"]; }, (s) => { s.truncation = { truncated: true, limits: { layers: 1 } }; }, (s) => { s.fingerprint = "anything"; }, (s) => { s.selectionFingerprint = "anything"; },
    (s) => { compositionAt(s).currentTime = 7; }, (s) => { for (const layer of compositionAt(s).layers) layer.isSelected = !layer.isSelected; },
  ];
  for (const [index, edit] of volatile.entries()) { const snapshot = fresh(); edit(snapshot); assert.equal(graphFingerprint(snapshot), base, `volatile edit ${index}`); }
});

test("a keyframed or expression-driven value is sampled, so it is not content; a static one is", () => {
  const animated = (value: number) => graphFingerprint(withProperty(leaf({ keyframeCount: 2, value })));
  const expressed = (value: number) => graphFingerprint(withProperty(leaf({ expressionEnabled: true, expression: "time", value })));
  assert.equal(animated(1), animated(2)); assert.equal(expressed(1), expressed(2));
  assert.notEqual(graphFingerprint(withProperty(leaf({ keyframeCount: 0, value: 1 }))), graphFingerprint(withProperty(leaf({ keyframeCount: 0, value: 2 }))));
  assert.notEqual(graphFingerprint(withProperty(leaf({ keyframeCount: 2, keyDigest: "a" }))), graphFingerprint(withProperty(leaf({ keyframeCount: 2, keyDigest: "b" }))));
  const nested = (value: number) => graphFingerprint(withProperty(leaf({ children: [leaf({ path: "a/b", matchName: "b", keyframeCount: 1, value })] })));
  assert.equal(nested(1), nested(2), "a keyframed child is sampled too");
});

test("the fingerprint is the fingerprint of the canonical snapshot: serialising drops exactly what canonicalSnapshot drops", () => {
  const samples = [fresh(), withProperty(leaf({ keyframeCount: 2, value: 3 })), withProperty(leaf({ children: [leaf({ path: "a/b", matchName: "b", expressionEnabled: true, value: 4 })] }))];
  for (const sample of samples) assert.equal(graphFingerprint(sample), projectFingerprint(canonicalSnapshot(sample)));
});

test("a key holding undefined is the same as a missing key, and a non-finite number is null, as in the JSON form", () => {
  const withUndefined = fresh(); Reflect.set(layerOf(withUndefined), "label", undefined);
  assert.equal(graphFingerprint(withUndefined), graphFingerprint(representativeSnapshot));
  const nan = withProperty(leaf({ value: Number.NaN })), infinity = withProperty(leaf({ value: Number.POSITIVE_INFINITY })), nothing = withProperty(leaf({ value: null }));
  assert.equal(graphFingerprint(nan), graphFingerprint(nothing)); assert.equal(graphFingerprint(infinity), graphFingerprint(nothing));
});

function editedLayer(snapshot: ProjectSnapshot, salt: number): ProjectSnapshot {
  const replaced = freezeDeep({ ...structuredClone(layerOf(snapshot, 0, 0)), name: `Edited ${salt}`, properties: [leaf({ value: salt })] });
  const first = compositionAt(snapshot);
  return { ...snapshot, compositions: [{ ...first, layers: [replaced, ...first.layers.slice(1)] }, ...snapshot.compositions.slice(1)] };
}

test("the incremental fingerprint equals the from-scratch one, step by step", () => {
  const memo = createFingerprintMemo();
  let current: ProjectSnapshot = freezeDeep(fresh());
  assert.equal(graphFingerprint(current, memo), graphFingerprint(fresh()));
  const seen = new Set<string>();
  for (let step = 1; step <= 6; step += 1) {
    current = editedLayer(current, step);
    const incremental = graphFingerprint(current, memo);
    assert.equal(incremental, graphFingerprint(structuredClone(current)), `step ${step}`);
    assert.equal(graphFingerprint(current, memo), incremental, "asking again is stable");
    assert.equal(seen.has(incremental), false); seen.add(incremental);
  }
});

test("a layer that was not frozen is hashed again every time, so a memo can never serve a stale digest", () => {
  const memo = createFingerprintMemo(), snapshot = fresh();
  const before = graphFingerprint(snapshot, memo);
  layerOf(snapshot).name = "Edited after it was hashed";
  assert.notEqual(graphFingerprint(snapshot, memo), before);
  assert.equal(graphFingerprint(snapshot, memo), graphFingerprint(snapshot));
});

test("a frozen layer cannot be edited after it was remembered", () => {
  const memo = createFingerprintMemo(), snapshot = freezeDeep(fresh());
  graphFingerprint(snapshot, memo);
  assert.throws(() => { layerOf(snapshot).name = "Edited"; }, TypeError);
  assert.throws(() => { required(layerAt(snapshot).properties[0], "a property").displayName = "Edited"; }, TypeError);
});

test("createSnapshot with a memo gives the snapshot the same fingerprints as without", () => {
  const input: SnapshotInput = { ...fresh() };
  assert.equal(createSnapshot(input, createFingerprintMemo()).fingerprint, createSnapshot(input).fingerprint);
  assert.equal(createSnapshot(input).fingerprint, graphFingerprint(representativeSnapshot));
});
