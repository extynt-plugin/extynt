/**
 * The fixture host's contract: a plan's operations either change the snapshot where a later
 * inspection reads, or they are refused by name. No network, clock or filesystem, so the chat
 * tests can close the act -> observe -> correct loop without a host.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PropertySnapshot } from "@extynt/project-graph";
import type { FixtureApplyResult, FixtureOperationVerdict } from "../src/fake-host.js";
import { apply, compositionOf, fixture, layerChild, layerOf, OPACITY, POSITION, propertyOf } from "./fake-host-fixture.js";

const ROTATION = "ADBE Transform Group/ADBE Rotate Z";

function verdictAt(result: FixtureApplyResult, index: number): FixtureOperationVerdict {
  const verdict = result.verdicts[index];
  assert.ok(verdict, `expected a verdict at index ${index}`);
  return verdict;
}

describe("fake-host: the act -> observe loop", () => {
  it("resolves a create_composition + create_layer + set_layer_name chain to real ids", resolvesCreatedIds);
  it("writes, merges, replaces and refuses keyframes the way the three modes say", writesAndMergesKeyframes);
  it("refuses an unmodelled plan type without touching the snapshot", refusesUnmodelledPlanType);
  it("fails a dependent operation with DEPENDENCY_FAILED naming the earlier index", failsDependentOperation);
  it("never mutates the caller's snapshot", neverMutatesTheCallersSnapshot);
  it("accepts a four-channel solid colour the way the host does", acceptsFourChannelSolidColour);
  it("keeps mutated and revision consistent with what actually changed", keepsMutatedAndRevisionConsistent);
  it("compensates Position when parenting, and refuses a transform it cannot compute", compensatesPositionWhenParenting);
});

function resolvesCreatedIds(): void {
  const input = fixture();
  const result = apply(input, [
    { type: "create_composition", newCompositionId: "__new__:overlay", name: "Overlay", width: 1080, height: 1080, durationSeconds: 6, frameRate: 30 },
    { type: "create_layer", target: { compositionId: "__new__:overlay", layerId: "__new__:badge" }, layerType: "shape", name: "Badge" },
    { type: "set_layer_name", target: { compositionId: "__new__:overlay", layerId: "__new__:badge" }, name: "Badge — Final" },
  ]);

  assert.equal(result.verdicts.length, 3);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.ok), [true, true, true]);
  assert.equal(result.mutated, true);

  const created = result.snapshot.compositions.find((candidate) => candidate.name === "Overlay");
  assert.ok(created, "the created composition should be in the returned snapshot");
  assert.match(created.id, /^fx-comp-[0-9]+$/);
  assert.equal(created.width, 1080);
  assert.equal(created.duration, 6);
  assert.equal(created.frameRate, 30);

  assert.equal(created.layers.length, 1);
  const [layer] = created.layers;
  assert.ok(layer);
  assert.match(layer.id, /^fx-layer-[0-9]+$/, "the layer must carry the real id the fixture minted, not its placeholder");
  assert.ok(!layer.id.startsWith("__new__:"));
  assert.equal(layer.name, "Badge — Final", "the rename that targeted the placeholder reached the same layer");
  assert.equal(layer.type, "shape");
  assert.equal(layer.index, 1);
  assert.ok(propertyOf(layer, "ADBE Root Vectors Group"), "a created shape layer carries the vectors root a later shape operation needs");

  assert.ok(result.snapshot.items?.some((item) => item.id === created.id && item.type === "composition"));
  assert.ok(result.snapshot.compositions.some((candidate) => candidate.id === "comp-main"));
  assert.equal(compositionOf(result.snapshot, "comp-main").layers.length, 5, "creating into a new composition leaves the open one alone");
}

function writesAndMergesKeyframes(): void {
  const input = fixture();
  const target = { compositionId: "comp-main", layerId: "layer-title", propertyPath: OPACITY };

  const written = apply(input, [{ type: "animate_property", target, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }]);
  assert.equal(verdictAt(written, 0).ok, true);
  const animated = propertyOf(layerOf(written.snapshot, "comp-main", "layer-title"), OPACITY);
  assert.deepEqual(animated.keyframes, [{ time: 0, value: 0 }, { time: 1, value: 100 }]);
  assert.equal(animated.keyframeCount, 2);
  assert.equal(animated.value, null, "a keyframed property claims no single static value");

  const rejected = apply(written.snapshot, [{ type: "animate_property", target, keyframes: [{ time: 2, value: 50 }] }]);
  assert.equal(verdictAt(rejected, 0).ok, false);
  assert.equal(verdictAt(rejected, 0).code, "CONFLICTING_KEYS");
  assert.match(verdictAt(rejected, 0).message ?? "", /keyframeMode/);
  assert.equal(rejected.mutated, false, "a refused keyframe write changes nothing");
  assert.equal(rejected.revision, written.snapshot.revision);
  assert.deepEqual(propertyOf(layerOf(rejected.snapshot, "comp-main", "layer-title"), OPACITY).keyframes, [{ time: 0, value: 0 }, { time: 1, value: 100 }]);

  const merged = apply(written.snapshot, [{ type: "animate_property", target, keyframeMode: "merge", keyframes: [{ time: 1, value: 80 }, { time: 2, value: 20 }] }]);
  assert.equal(verdictAt(merged, 0).ok, true);
  assert.deepEqual(propertyOf(layerOf(merged.snapshot, "comp-main", "layer-title"), OPACITY).keyframes, [{ time: 0, value: 0 }, { time: 1, value: 80 }, { time: 2, value: 20 }]);

  const replaced = apply(merged.snapshot, [{ type: "animate_property", target, keyframeMode: "replace", keyframes: [{ time: 5, value: 10 }] }]);
  assert.equal(verdictAt(replaced, 0).ok, true);
  const finalKeys = propertyOf(layerOf(replaced.snapshot, "comp-main", "layer-title"), OPACITY);
  assert.deepEqual(finalKeys.keyframes, [{ time: 5, value: 10 }]);
  assert.equal(finalKeys.keyframeCount, 1);

  const badCurve = apply(input, [{ type: "animate_property", target, keyframes: [{ time: 0, value: 0, curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } }] }]);
  assert.equal(verdictAt(badCurve, 0).ok, false);
  assert.equal(verdictAt(badCurve, 0).code, "INVALID_VALUE");
}

function refusesUnmodelledPlanType(): void {
  const input = fixture();
  const before = structuredClone(input);
  const result = apply(input, [
    { type: "render_composition", compositionId: "comp-main", outputPath: "/tmp/out.mov", destinationPolicy: "explicit-local-path", executeAuthorization: "RENDER_NOW" },
  ]);

  assert.equal(result.verdicts.length, 1);
  assert.equal(result.verdicts[0]?.ok, false);
  assert.equal(result.verdicts[0]?.code, "UNSUPPORTED_IN_FIXTURE");
  assert.match(result.verdicts[0]?.message ?? "", /render_composition/);
  assert.equal(result.mutated, false);
  assert.deepEqual(result.snapshot, input, "a refused operation returns the project exactly as it was observed");
  assert.deepEqual(input, before);
}

function failsDependentOperation(): void {
  const input = fixture();
  const result = apply(input, [
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:ghost" }, layerType: "wormhole", name: "Ghost" },
    { type: "set_layer_name", target: { compositionId: "comp-main", layerId: "__new__:ghost" }, name: "Ghost Renamed" },
  ]);

  assert.equal(result.verdicts.length, 2, "one verdict per operation, even after a refusal");
  assert.deepEqual(result.verdicts.map((verdict) => [verdict.ok, verdict.code]), [[false, "INVALID_VALUE"], [false, "DEPENDENCY_FAILED"]]);
  const dependent = result.verdicts[1]?.message ?? "";
  assert.match(dependent, /operation 0/);
  assert.match(dependent, /__new__:ghost/);
  assert.equal(result.mutated, false);
}

function acceptsFourChannelSolidColour(): void {
  const result = apply(fixture(), [
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:rgba" }, layerType: "solid", name: "Rgba", color: [1, 0, 0, 1] },
  ]);
  assert.deepEqual(result.verdicts.map((verdict) => verdict.ok), [true]);
  assert.deepEqual(apply(fixture(), [{ type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:bad" }, layerType: "solid", name: "Bad", color: [1, 0] }]).verdicts.map((verdict) => verdict.ok), [false]);
}

function neverMutatesTheCallersSnapshot(): void {
  const input = fixture();
  const before = structuredClone(input);
  const result = apply(input, [
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:floor" }, layerType: "solid", name: "Floor", color: [0.1, 0.2, 0.3] },
    { type: "set_layer_timing", target: { compositionId: "comp-main", layerId: "__new__:floor" }, inPoint: 1, outPoint: 4 },
    { type: "set_layer_property", target: { compositionId: "comp-main", layerId: "__new__:floor" }, role: "transform.position", propertyPath: POSITION, value: [100, 200] },
    { type: "add_marker", target: { compositionId: "comp-main", layerId: "__new__:floor" }, time: 2, comment: "beat" },
    { type: "add_mask", target: { compositionId: "comp-main", layerId: "__new__:floor" }, newMaskId: "__new__:reveal", name: "Reveal", values: { opacity: 50 } },
    { type: "update_mask", target: { compositionId: "comp-main", layerId: "__new__:floor" }, maskId: "__new__:reveal", values: { opacity: 90 } },
    { type: "set_layer_attribute", target: { compositionId: "comp-main", layerId: "__new__:floor" }, role: "solo", value: true },
  ]);

  assert.deepEqual(result.verdicts.map((verdict) => verdict.ok), [true, true, true, true, true, true, true]);
  assert.equal(result.mutated, true);
  assert.deepEqual(input, before, "the input snapshot is untouched after a successful apply");
  assert.notEqual(result.snapshot, input, "the returned snapshot is a different object");

  const floor = layerOf(result.snapshot, "comp-main", "fx-layer-1");
  assert.equal(floor.name, "Floor");
  assert.equal(floor.inPoint, 1);
  assert.equal(floor.outPoint, 4);
  assert.equal(floor.solo, true);
  assert.deepEqual(propertyOf(floor, POSITION).value, [100, 200]);
  const marker = propertyOf(floor, "ADBE Marker");
  assert.deepEqual(marker.value, { count: 1, markers: [{ time: 2, comment: "beat", duration: 0, chapter: null, url: null, label: 0, cuePointName: null }] });
  const parade = layerChild(floor, "ADBE Mask Parade");
  assert.ok(parade, "add_mask should materialise the mask parade a real layer always has");
  const mask = propertyIn(parade, "ADBE Mask Parade/ADBE Mask Atom");
  assert.equal(mask.displayName, "Reveal");
  assert.equal(propertyIn(mask, "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Opacity").value, 90);
}

function keepsMutatedAndRevisionConsistent(): void {
  const input = fixture();
  const rename = { type: "set_layer_name", target: { compositionId: "comp-main", layerId: "layer-title" }, name: "Renamed" };

  const changed = apply(input, [rename]);
  assert.equal(changed.mutated, true);
  assert.notEqual(changed.revision, input.revision);
  assert.equal(changed.snapshot.revision, changed.revision);
  assert.equal(changed.snapshot.freshness.revision, changed.revision);
  assert.notEqual(changed.snapshot.fingerprint, input.fingerprint, "the graph fingerprint follows the content");

  const unchanged = apply(input, [{ ...rename, name: layerOf(input, "comp-main", "layer-title").name }]);
  assert.equal(unchanged.mutated, false);
  assert.equal(unchanged.revision, input.revision);
  assert.equal(unchanged.snapshot.revision, input.revision);
  assert.equal(unchanged.snapshot.freshness.revision, input.revision);
  assert.equal(unchanged.snapshot.fingerprint, input.fingerprint);

  const empty = apply(input, []);
  assert.deepEqual(empty.verdicts, []);
  assert.equal(empty.mutated, false);
  assert.equal(empty.revision, input.revision);

  const based = apply(input, [rename], "host-revision-7");
  assert.equal(based.revision, "host-revision-7+fx1");
  assert.notEqual(based.revision, "host-revision-7");
  const chained = apply(based.snapshot, [{ ...rename, name: "Renamed Again" }], based.revision);
  assert.equal(chained.revision, "host-revision-7+fx2", "repeated applies advance the same token deterministically");
  assert.equal(apply(input, [rename], "host-revision-7").revision, based.revision, "the same input gives the same output");
}

function compensatesPositionWhenParenting(): void {
  const input = fixture();
  const parented = apply(input, [
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:child" }, layerType: "null", name: "Child" },
    { type: "set_layer_property", target: { compositionId: "comp-main", layerId: "__new__:child" }, role: "transform.position", propertyPath: POSITION, value: [160, 90] },
    { type: "set_layer_property", target: { compositionId: "comp-main", layerId: "layer-null" }, role: "transform.position", propertyPath: POSITION, value: [100, 50] },
    { type: "set_layer_parent", target: { compositionId: "comp-main", layerId: "__new__:child" }, parentLayerId: "layer-null" },
  ]);
  assert.deepEqual(parented.verdicts.map((verdict) => verdict.ok), [true, true, true, true]);
  const child = layerOf(parented.snapshot, "comp-main", "fx-layer-1");
  assert.equal(child.parentId, "layer-null");
  assert.deepEqual(propertyOf(child, POSITION).value, [60, 40]);

  const rotated = apply(parented.snapshot, [
    { type: "set_layer_property", target: { compositionId: "comp-main", layerId: "layer-null" }, role: "transform.rotation", propertyPath: ROTATION, value: 45 },
    { type: "create_layer", target: { compositionId: "comp-main", layerId: "__new__:child2" }, layerType: "null", name: "Child 2" },
    { type: "set_layer_parent", target: { compositionId: "comp-main", layerId: "__new__:child2" }, parentLayerId: "layer-null" },
  ]);
  assert.equal(rotated.verdicts[2]?.ok, false);
  assert.equal(rotated.verdicts[2]?.code, "UNSUPPORTED_IN_FIXTURE");
  assert.match(rotated.verdicts[2]?.message ?? "", /rotation or scale/);
}

function propertyIn(root: PropertySnapshot, path: string): PropertySnapshot {
  const found: PropertySnapshot[] = [];
  const visit = (properties: PropertySnapshot[]) => {
    for (const property of properties) {
      if (property.path === path) found.push(property);
      if (property.children) visit(property.children);
    }
  };
  visit([root]);
  assert.equal(found.length, 1, `expected exactly one ${path} under ${root.path}`);
  const [only] = found;
  assert.ok(only);
  return only;
}
