// derive_layer and retime_layer validation: kind-specific fields, target layer types, minted layer ids and Time Remapping writes.
import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "@extynt/decode";
import { footageTarget as footage, snapshotWithMask, target as text } from "./fixtures.js";
import { assertOperations, assertSequences, buildPlan, verdict } from "./plan-builders.js";

const NEW = "__new__:derived";
const MASK_PATH = "ADBE Mask Parade/ADBE Mask Atom/ADBE Mask Shape";

function derive(kind: string, extra: JsonObject = {}, layer: JsonObject = footage): JsonObject {
  return { type: "derive_layer", target: layer, kind, newLayerId: NEW, ...extra };
}

function pathNull(extra: JsonObject = {}): JsonObject {
  return { ...derive("path-null", { pointIndex: 1, ...extra }), target: { ...footage, propertyPath: MASK_PATH } };
}

test("derive_layer split needs a time strictly inside the layer", () => {
  assertOperations([
    ["ok", derive("split", { time: 5 })],
    ["INVALID_VALUE", derive("split", { time: 12 })],
    ["INVALID_VALUE", derive("split")],
    ["INVALID_OPERATION", { ...derive("split", { time: 5 }), newLayerId: "plain" }],
  ]);
});

test("derive_layer refuses fields that belong to another kind", () => {
  assertOperations([["INVALID_VALUE", derive("shapes-from-vector", { time: 5 })], ["INVALID_VALUE", derive("unknown")]]);
});

test("derive_layer refuses layers the command cannot take", () => {
  assertOperations([
    ["INVALID_TARGET", derive("shapes-from-vector", {}, text)],
    ["INVALID_TARGET", derive("shapes-from-text")],
    ["ok", derive("shapes-from-text", {}, text)],
    ["ok", derive("audio-keyframes")],
    ["INVALID_TARGET", derive("audio-keyframes", {}, text)],
  ]);
});

test("derive_layer mints a layer later operations may use", () => {
  const later = { type: "set_layer_name", target: { ...footage, layerId: NEW }, name: "Second half" } satisfies JsonObject;
  assertSequences([["ok", [derive("split", { time: 5 }), later]]]);
});

test("the derived layer placeholder must be unique", () => {
  assertSequences([["INVALID_OPERATION", [derive("split", { time: 3 }), derive("split", { time: 6 })]]]);
});

test("derive_layer path-null reads the path from the snapshot and bounds the point", () => {
  const snapshot = snapshotWithMask(MASK_PATH, 3);
  assertOperations([
    ["ok", pathNull()],
    ["ok", pathNull({ pointKind: "outTangent", name: "Handle" })],
    ["INVALID_VALUE", pathNull({ pointIndex: 3 })],
    ["INVALID_VALUE", pathNull({ pointKind: "middle" })],
    ["INVALID_TARGET", { ...pathNull(), target: { ...footage, propertyPath: "ADBE Transform Group/ADBE Position" } }],
  ], { snapshot });
});

test("derive_layer path-null refuses a path the snapshot does not hold", () => {
  assertOperations([["TARGET_NOT_FOUND", pathNull()]]);
});

test("retime_layer reverses or freezes footage layers", () => {
  assertOperations([
    ["ok", { type: "retime_layer", target: footage, mode: "reverse" }],
    ["INVALID_VALUE", { type: "retime_layer", target: footage, mode: "reverse", time: 2 }],
    ["ok", { type: "retime_layer", target: footage, mode: "freeze", time: 2 }],
    ["INVALID_VALUE", { type: "retime_layer", target: footage, mode: "freeze" }],
    ["INVALID_VALUE", { type: "retime_layer", target: footage, mode: "freeze", time: 12 }],
  ]);
});

test("retime_layer refuses other layer types and unknown modes", () => {
  assertOperations([["INVALID_TARGET", { type: "retime_layer", target: text, mode: "reverse" }], ["INVALID_VALUE", { type: "retime_layer", target: footage, mode: "rewind" }]]);
});

test("animate_property may write Time Remapping after an earlier retime or enable", () => {
  const remap = { type: "animate_property", target: { ...footage, propertyPath: "ADBE Time Remapping" }, keyframes: [{ time: 0, value: 0 }, { time: 4, value: 2 }] } satisfies JsonObject;
  const replacing = { ...remap, keyframeMode: "replace" };
  const enable = { type: "set_time_remap", target: footage, enabled: true } satisfies JsonObject;
  assertSequences([
    ["ok", [{ type: "retime_layer", target: footage, mode: "reverse" }, replacing]],
    ["ok", [enable, replacing]],
    ["CONFLICTING_KEYS", [enable, remap]],
    ["TARGET_NOT_FOUND", [remap]],
  ]);
});

test("the plan digest covers derive_layer fields", () => {
  const first = buildPlan({ operations: [derive("split", { time: 5 })] });
  const second = buildPlan({ operations: [derive("split", { time: 6 })] });
  assert.notEqual(first.digest, second.digest);
  assert.equal(verdict([derive("split", { time: 5 })]), "ok");
});
