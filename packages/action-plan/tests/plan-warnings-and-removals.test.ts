// Plan warnings that never refuse a plan, removals the same plan already made, and the legal ids a refused target names.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { EMPTY_SNAPSHOT, footageTarget, newComposition, newTarget, newTextLayer, POSITION_PATH, target } from "./fixtures.js";
import { assertSequences, GENEROUS_BOUNDS, refusal, warningsOf, type SequenceRow } from "./plan-builders.js";

const KEYED = { maxOperations: 3, maxKeyframes: 2, maxKeyframeTimeSeconds: 30 } satisfies JsonObject;

function codes(operations: readonly JsonValue[]): readonly string[] {
  return warningsOf(operations, { bounds: KEYED }).map((warning) => warning.code);
}

function timing(fields: JsonObject, at: JsonObject = target): JsonObject {
  return { type: "set_layer_timing", target: at, ...fields };
}

const animate = { type: "animate_property", target: { ...target, propertyPath: POSITION_PATH }, role: "transform.position", keyframes: [{ time: 0, value: [960, 1180] }, { time: 12, value: [960, -100] }] } satisfies JsonObject;

test("a plan's own set_layer_timing window that ends before its animation is reported, not refused", () => {
  const trimmed = warningsOf([animate, timing({ outPoint: 2 })], { bounds: KEYED });
  assert.deepEqual(trimmed.map((warning) => warning.code), ["TRIM_HIDES_ANIMATION"]);
  assert.equal(trimmed[0]?.lastKeyframeSeconds, 12);
  assert.equal(trimmed[0]?.visibleThroughSeconds, 2);
  assert.match(trimmed[0]?.message ?? "", /layer-title/);
});

test("a window that holds the last keyframe, or no same-plan animation, warns about nothing", () => {
  assert.deepEqual(codes([animate, timing({ outPoint: 12 })]), []);
  assert.deepEqual(codes([timing({ outPoint: 2 })]), []);
  assert.deepEqual(codes([animate, timing({ outPoint: 2 }, footageTarget)]), []);
});

test("a stretch moves the keys the window has to hold", () => {
  assert.deepEqual(codes([animate, timing({ outPoint: 12, stretch: 200 })]), ["TRIM_HIDES_ANIMATION"]);
  assert.deepEqual(codes([animate, timing({ outPoint: 24, stretch: 200 })]), []);
});

test("the plan's final timing decides the window, not an earlier step", () => {
  assert.deepEqual(codes([animate, timing({ outPoint: 2 }), timing({ outPoint: 12 })]), []);
});

const createdTarget = { compositionId: "comp-main", layerId: "__new__:ramp-shape", snapshotFingerprint: representativeSnapshot.fingerprint, selectionFingerprint: representativeSnapshot.selectionFingerprint } satisfies JsonObject;
const RAMP_PATH = "ADBE Effect Parade/ADBE Ramp";

function ensureRamp(layerId: string): JsonObject {
  return { type: "ensure_effect", target: { ...createdTarget, layerId, effectPath: RAMP_PATH }, capabilityId: "adobe.gradient-ramp", effectMatchName: "ADBE Ramp", effectPath: RAMP_PATH };
}

function rampCodes(layer: JsonObject): readonly string[] {
  return warningsOf([layer, ensureRamp(createdTarget.layerId)], { bounds: GENEROUS_BOUNDS }).map((warning) => warning.code);
}

test("Gradient Ramp on a created shape layer warns without refusing the plan", () => {
  assert.deepEqual(rampCodes({ type: "create_layer", target: createdTarget, layerType: "shape", name: "Gradient target" }), ["RAMP_ON_SHAPE_LAYER"]);
});

test("Gradient Ramp on a created solid layer warns about nothing", () => {
  assert.deepEqual(rampCodes({ type: "create_layer", target: createdTarget, layerType: "solid", name: "Gradient target", color: [0, 0, 0, 1] }), []);
});

test("Gradient Ramp on an observed text layer warns too", () => {
  const observed = warningsOf([ensureRamp("layer-title")], { bounds: GENEROUS_BOUNDS });
  assert.deepEqual(observed.map((warning) => warning.code), ["RAMP_ON_SHAPE_LAYER"]);
});

const shortComposition = { ...newComposition, durationSeconds: 5 };

function animateCreated(last: number): JsonObject {
  return { type: "animate_property", target: newTarget({ propertyPath: POSITION_PATH }), keyframes: [{ time: 0, value: [960, 1180] }, { time: last, value: [960, -100] }] };
}

test("keyframes past a composition the same plan creates are reported, not refused", () => {
  const warnings = warningsOf([shortComposition, newTextLayer, animateCreated(12)], { snapshot: EMPTY_SNAPSHOT, bounds: KEYED });
  assert.deepEqual(warnings.map((warning) => warning.code), ["KEYFRAMES_OUTSIDE_COMPOSITION"]);
});

test("a keyframe at the created composition's own duration stays inside it", () => {
  assert.deepEqual(warningsOf([shortComposition, newTextLayer, animateCreated(5)], { snapshot: EMPTY_SNAPSHOT, bounds: KEYED }), []);
});

const MASK_BOUNDS = { bounds: { maxOperations: 4 } } satisfies { bounds: JsonObject };

function addMask(newMaskId: string): JsonObject {
  return { type: "add_mask", target, newMaskId, name: "Reveal" };
}

function updateMask(maskId: string): JsonObject {
  return { type: "update_mask", target, maskId, values: { opacity: 60 } };
}

function removeMask(maskId: string): JsonObject {
  return { type: "remove_mask", target, maskId, destructive: true };
}

test("a mask operation at a mask the same plan already removed is refused", () => {
  const rows: readonly SequenceRow[] = [
    ["TARGET_NOT_FOUND", [removeMask("mask:1"), updateMask("mask:1")]],
    ["TARGET_NOT_FOUND", [removeMask("mask:1"), removeMask("mask:1")]],
    ["TARGET_NOT_FOUND", [addMask("__new__:mask0"), removeMask("__new__:mask0"), updateMask("__new__:mask0")]],
  ];
  assertSequences(rows, MASK_BOUNDS);
});

test("removing a mask and adding another, or update then remove, stays legal", () => {
  const rows: readonly SequenceRow[] = [
    ["ok", [removeMask("mask:1"), addMask("__new__:mask1")]],
    ["ok", [updateMask("mask:1"), removeMask("mask:1")]],
    ["ok", [addMask("__new__:mask0"), updateMask("__new__:mask0"), removeMask("__new__:mask0")]],
  ];
  assertSequences(rows, MASK_BOUNDS);
});

test("a higher ordinal after a removal is shifted and refused", () => {
  assertSequences([["MASK_ORDINAL_SHIFTED", [removeMask("mask:1"), updateMask("mask:2")]]], MASK_BOUNDS);
});

test("the shifted-ordinal refusal names the operation, the removal and both ordinals", () => {
  const { message } = refusal([removeMask("mask:1"), updateMask("mask:2")], MASK_BOUNDS);
  assert.match(message, /\(index 1\)/);
  assert.match(message, /removal at index 0/);
  assert.match(message, /ordinal 2/);
  assert.match(message, /ordinal 1/);
});

test("ordinals that no earlier removal shifted stay legal", () => {
  const rows: readonly SequenceRow[] = [
    ["ok", [removeMask("mask:2"), updateMask("mask:1")]],
    ["ok", [updateMask("mask:2"), removeMask("mask:1")]],
    ["ok", [updateMask("mask:1"), updateMask("mask:2"), updateMask("mask:3")]],
    ["ok", [removeMask("mask:2"), removeMask("mask:1")]],
    ["MASK_ORDINAL_SHIFTED", [removeMask("mask:1"), removeMask("mask:2")]],
  ];
  assertSequences(rows, MASK_BOUNDS);
});

const MARKER_BOUNDS = { bounds: { maxOperations: 3 } } satisfies { bounds: JsonObject };

function addMarker(time: number): JsonObject {
  return { type: "add_marker", target, time, comment: "New" };
}

function updateMarker(time: number): JsonObject {
  return { type: "update_marker", target, time, comment: "Moved" };
}

function removeMarker(time: number): JsonObject {
  return { type: "remove_marker", target, time, destructive: true };
}

test("a marker operation at a time the same plan already removed is refused", () => {
  const rows: readonly SequenceRow[] = [
    ["TARGET_NOT_FOUND", [removeMarker(1), updateMarker(1)]],
    ["TARGET_NOT_FOUND", [removeMarker(1), addMarker(1)]],
    ["TARGET_NOT_FOUND", [removeMarker(1), removeMarker(1)]],
    ["TARGET_NOT_FOUND", [removeMarker(1), updateMarker(1.0002)]],
  ];
  assertSequences(rows, MARKER_BOUNDS);
});

test("removing one marker and adding another time, update then remove, or add then remove stays legal", () => {
  const rows: readonly SequenceRow[] = [
    ["ok", [removeMarker(1), addMarker(2)]],
    ["ok", [updateMarker(1), removeMarker(1)]],
    ["ok", [addMarker(1), removeMarker(1)]],
  ];
  assertSequences(rows, MARKER_BOUNDS);
});

const missingLayer = { ...target, layerId: "layer-nope" } satisfies JsonObject;

const familyOperations = [
  ["ensure_shape_fill", { type: "ensure_shape_fill", target: missingLayer, groupId: "root", color: [1, 0, 0] }],
  ["add_mask", { type: "add_mask", target: missingLayer, newMaskId: "__new__:mask0" }],
  ["add_marker", { type: "add_marker", target: missingLayer, time: 1, comment: "x" }],
  ["set_three_d_options", { type: "set_three_d_options", target: missingLayer, options: { position: [0, 0, 0] } }],
] as const satisfies readonly (readonly [string, JsonObject])[];

test("the table-driven and family validators name the legal layers, described the way inspection does", () => {
  for (const [label, operation] of familyOperations) {
    const result = refusal([operation], { bounds: GENEROUS_BOUNDS });
    assert.equal(result.code, "TARGET_NOT_FOUND", label);
    assert.match(result.message, /layer-title "TITLE/, `${label}: ${result.message}`);
    assert.match(result.message, /\(text, index 1\)/, `${label}: ${result.message}`);
  }
});

test("a layer id the refusal names is one the check accepts", () => {
  const accepted = { type: "ensure_shape_fill", target: { ...target, layerId: "layer-title" }, groupId: "root", color: [1, 0, 0] } satisfies JsonObject;
  assertSequences([["ok", [accepted]]], { bounds: GENEROUS_BOUNDS });
});
