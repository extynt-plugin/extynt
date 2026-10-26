// duplicate_composition, edit_keyframes, effect stack edits, Source Text keys and puppet pins.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { keyframeEditAction } from "../src/index.js";
import { compositionTarget as source, target } from "./fixtures.js";
import { assertOperations, assertSequences, refusal, verdict } from "./plan-builders.js";

const options = { bounds: { maxOperations: 8 } };
const duplicate = { type: "duplicate_composition", target: source, newCompositionId: "__new__:run", name: "Run Cycle" } satisfies JsonObject;
const onCopy = { type: "set_layer_name", target: { ...source, compositionId: "__new__:run", layerId: "layer-title" }, name: "Run Title" } satisfies JsonObject;

test("duplicate_composition accepts an observed source, a new placeholder and an optional name", () => {
  const unnamed = { type: "duplicate_composition", target: source, newCompositionId: "__new__:run" } satisfies JsonObject;
  assertOperations([["ok", duplicate], ["ok", unnamed]], options);
});

test("duplicate_composition accepts a planned source and later operations address the copy", () => {
  const again = { ...duplicate, target: { ...source, compositionId: "__new__:run" }, newCompositionId: "__new__:jump", name: "Jump Cycle" } satisfies JsonObject;
  assertSequences([["ok", [duplicate, onCopy]], ["ok", [duplicate, again]]], options);
});

test("duplicate_composition refuses an unplaced copy, a reused placeholder, an empty name and an unknown source", () => {
  assertSequences([
    ["TARGET_NOT_FOUND", [onCopy]],
    ["INVALID_OPERATION", [{ ...duplicate, newCompositionId: "run" }]],
    ["INVALID_OPERATION", [duplicate, { ...duplicate, name: "Again" }]],
    ["INVALID_OPERATION", [{ ...duplicate, name: "" }]],
    ["TARGET_NOT_FOUND", [{ ...duplicate, target: { ...source, compositionId: "comp-missing" } }]],
  ], options);
  assert.equal(refusal([{ ...duplicate, extra: 1 }], options).ok, false);
});

const POSITION = "ADBE Transform Group/ADBE Position";
const ANCHOR = "ADBE Transform Group/ADBE Anchor Point";

function edit(fields: JsonObject): JsonObject {
  return { type: "edit_keyframes", target: { ...target, propertyPath: POSITION }, ...fields };
}

function editRow(expected: string, fields: JsonObject): readonly [string, JsonObject] {
  return [expected, edit(fields)];
}

const copyFrom = (propertyPath: string): JsonObject => ({ compositionId: "comp-main", layerId: target.layerId, propertyPath });

test("edit_keyframes accepts each action with its fields", () => {
  assertOperations([
    editRow("ok", { action: "delete", times: [1, 2] }),
    editRow("ok", { action: "delete", indices: [1] }),
    editRow("ok", { action: "delete", all: true }),
    editRow("ok", { action: "move", times: [1], offset: 0.5 }),
    editRow("ok", { action: "move", offset: -1 }),
    editRow("ok", { action: "scale", about: 0, factor: 2 }),
    editRow("ok", { action: "copy", source: copyFrom(ANCHOR), timeOffset: 1 }),
  ], options);
});

test("edit_keyframes refuses missing, conflicting and no-op fields", () => {
  assertOperations([
    editRow("INVALID_OPERATION", { action: "delete" }),
    editRow("INVALID_OPERATION", { action: "delete", times: [1], indices: [1] }),
    editRow("INVALID_VALUE", { action: "move", offset: 0 }),
    editRow("INVALID_VALUE", { action: "scale", about: 0, factor: 1 }),
    editRow("INVALID_VALUE", { action: "scale", factor: 2 }),
    editRow("INVALID_OPERATION", { action: "explode" }),
    editRow("INVALID_VALUE", { action: "delete", indices: [0] }),
  ], options);
  assert.notEqual(verdict([edit({ action: "move", offset: 1, factor: 2 })], options), "ok");
});

test("edit_keyframes copy needs a source other than its own property that exists", () => {
  assertOperations([
    editRow("INVALID_OPERATION", { action: "copy" }),
    editRow("INVALID_VALUE", { action: "copy", source: copyFrom(POSITION) }),
    editRow("TARGET_NOT_FOUND", { action: "copy", source: { compositionId: "comp-gone", layerId: "x", propertyPath: "p" } }),
  ], options);
});

test("edit_keyframes infers the action from the fields given and never infers delete", () => {
  assertOperations([
    editRow("ok", { offset: 0.5 }),
    editRow("ok", { times: [1], offset: -0.25 }),
    editRow("ok", { about: 0, factor: 2 }),
    editRow("ok", { source: copyFrom(ANCHOR) }),
    editRow("INVALID_OPERATION", { all: true }),
    editRow("INVALID_OPERATION", { times: [1] }),
  ], options);
  assert.notEqual(verdict([edit({ offset: 1, factor: 2 })], options), "ok");
  assert.notEqual(verdict([edit({ action: "move", factor: 2, offset: 1 })], options), "ok");
});

test("keyframeEditAction names the action a field set means", () => {
  assert.equal(keyframeEditAction({ offset: 1 }), "move");
  assert.equal(keyframeEditAction({ factor: 2 }), "scale");
  assert.equal(keyframeEditAction({ source: {} }), "copy");
  assert.equal(keyframeEditAction({ action: "delete" }), "delete");
  assert.equal(keyframeEditAction({}), undefined);
});

test("edit_keyframes needs a property path", () => {
  assertOperations([["INVALID_TARGET", { type: "edit_keyframes", target, action: "delete", all: true }]], options);
});

const BLUR = "ADBE Effect Parade/ADBE Gaussian Blur 2";

function onEffect(effectPath: string | undefined, extra: JsonObject = {}): JsonObject {
  return { ...target, ...(effectPath === undefined ? {} : { effectPath }), ...extra };
}

test("remove_effect and reorder_effect need an effect path on an existing layer and a stack place", () => {
  assertOperations([
    ["ok", { type: "remove_effect", target: onEffect(BLUR), destructive: true }],
    ["ok", { type: "reorder_effect", target: onEffect(BLUR), index: 2 }],
    ["INVALID_VALUE", { type: "reorder_effect", target: onEffect(BLUR), index: 0 }],
    ["INVALID_VALUE", { type: "reorder_effect", target: onEffect(BLUR), index: 1.5 }],
    ["STALE_TARGET", { type: "remove_effect", target: onEffect(undefined), destructive: true }],
    ["STALE_TARGET", { type: "remove_effect", target: onEffect(BLUR, { propertyPath: `${BLUR}/ADBE Gaussian Blur 2-0001` }), destructive: true }],
  ], options);
  assert.notEqual(verdict([{ type: "reorder_effect", target: onEffect("ADBE Effect Parade/Pseudo/rig#2"), index: 1 }], options), "ok");
});

test("remove_effect needs the destructive confirmation", () => {
  assertOperations([["DESTRUCTIVE_CONFIRMATION_REQUIRED", { type: "remove_effect", target: onEffect(BLUR) }]], options);
});

test("a removed effect can no longer be reordered but can be ensured again", () => {
  const removal = { type: "remove_effect", target: onEffect(BLUR), destructive: true } satisfies JsonObject;
  const ensure = { type: "ensure_effect", target: onEffect(BLUR), capabilityId: "x", effectMatchName: "ADBE Gaussian Blur 2" } satisfies JsonObject;
  assertSequences([["TARGET_NOT_FOUND", [removal, { type: "reorder_effect", target: onEffect(BLUR), index: 1 }]]], options);
  assert.notEqual(verdict([removal, ensure], options), "TARGET_NOT_FOUND");
});

function keyedText(keyframes: readonly JsonValue[]): JsonObject {
  return { type: "animate_property", target: { ...target, propertyPath: "ADBE Text Properties/ADBE Text Document" }, keyframes: [...keyframes], keyframeMode: "replace" };
}

test("animate_property keys Source Text with plain strings", () => {
  assertOperations([["ok", keyedText([{ time: 0, value: "One" }, { time: 1, value: "Two" }])], ["ok", keyedText([{ time: 0, value: "One" }])]], options);
});

test("animate_property refuses values and key options a text key cannot carry", () => {
  assertOperations([
    ["INVALID_VALUE", keyedText([{ time: 0, value: 5 }, { time: 1, value: 6 }])],
    ["INVALID_VALUE", keyedText([{ time: 0, value: "One", interpolation: { inType: "LINEAR", outType: "LINEAR" } }, { time: 1, value: "Two" }])],
    ["INVALID_VALUE", keyedText([{ time: 0, value: "x".repeat(5000) }])],
  ], options);
});

function pins(value: JsonValue): readonly [string, JsonObject] {
  return ["INVALID_VALUE", { type: "set_puppet_pins", target, pins: value }];
}

test("set_puppet_pins takes 1-64 pins with optional increasing keyframes", () => {
  const keyed = [{ x: 1, y: 2, keyframes: [{ time: 0, x: 1, y: 2 }, { time: 1, x: 3, y: 4 }] }];
  assertOperations([["ok", { type: "set_puppet_pins", target, pins: [{ x: 1, y: 2 }] }], ["ok", { type: "set_puppet_pins", target, pins: keyed }]], options);
});

test("set_puppet_pins refuses an empty, oversized, unordered or non-numeric pin list", () => {
  const unordered = [{ x: 1, y: 2, keyframes: [{ time: 1, x: 1, y: 2 }, { time: 1, x: 3, y: 4 }] }];
  assertOperations([pins([]), pins(Array.from({ length: 65 }, () => ({ x: 0, y: 0 }))), pins(unordered), pins([{ x: "a", y: 2 }])], options);
});
