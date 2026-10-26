// Timing and creation rules: layer stretch, loops, new compositions, vector artwork timing, text animator roles and non-animatable properties.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { type JsonObject } from "@extynt/decode";
import { validateInlineSvgText } from "../src/index.js";
import { toJsonValue } from "../src/plain-json.js";
import { fingerprints, mapLayers, target } from "./fixtures.js";
import { assertOperations, assertSequences, refusal, verdict } from "./plan-builders.js";

const POSITION = "ADBE Transform Group/ADBE Position";
const positionTarget = { ...target, propertyPath: POSITION } satisfies JsonObject;

function stretch(value: number): readonly [string, JsonObject] {
  return [value >= 1 && value <= 10_000 ? "ok" : "INVALID_VALUE", { type: "set_layer_timing", target, stretch: value }];
}

test("set_layer_timing carries a bounded stretch percentage", () => {
  assertOperations([stretch(50), stretch(1), stretch(10_000)]);
});

test("set_layer_timing rejects a stretch percentage outside 1-10000", () => {
  assertOperations([stretch(0), stretch(10_001)]);
});

test("set_loop without 2+ keyframes is refused with LOOP_REQUIRES_KEYFRAMES", () => {
  assertOperations([["LOOP_REQUIRES_KEYFRAMES", { type: "set_loop", target: positionTarget, mode: "cycle" }]]);
});

test("set_loop is accepted on a property with 2+ keyframes", () => {
  const animate = { type: "animate_property", target: positionTarget, role: "transform.position", keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [100, 100] }] } satisfies JsonObject;
  assertSequences([["ok", [animate, { type: "set_loop", target: positionTarget, mode: "pingpong" }]]]);
});

const good = { type: "create_composition", newCompositionId: "__new__:variant1", ...fingerprints, name: "Variant 1", width: 1920, height: 1080, durationSeconds: 4, frameRate: 30 } satisfies JsonObject;

test("create_composition accepts a __new__: placeholder id and bounded dimensions", () => {
  assertOperations([["ok", good], ["INVALID_OPERATION", { ...good, newCompositionId: "not-a-placeholder" }]]);
});

test("create_composition rejects out-of-range values", () => {
  assertOperations([["INVALID_VALUE", { ...good, width: 0 }], ["INVALID_VALUE", { ...good, frameRate: 0 }], ["INVALID_VALUE", { ...good, durationSeconds: 0 }]]);
});

function vectorTiming(timing: JsonObject): string {
  const checked = validateInlineSvgText('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
  if (!checked.ok) assert.fail(checked.message);
  const operation = { type: "create_vector_artwork", newItemId: "__new__:vector", ...fingerprints, name: "Vector", svg: checked.svg, sourceHash: checked.metadata.sourceHash, metadata: toJsonValue(checked.metadata) ?? null, importMode: "editable", managedSourcePolicy: "retain", ...timing };
  return verdict([operation]);
}

test("vector artwork accepts the create_composition timing bounds", () => {
  assert.equal(vectorTiming({ durationSeconds: 0.0001, frameRate: 1 }), "ok");
});

test("vector artwork rejects non-finite or out-of-range timing", () => {
  const bad: readonly JsonObject[] = [{ durationSeconds: Number.NaN }, { durationSeconds: Number.POSITIVE_INFINITY }, { durationSeconds: 0 }, { durationSeconds: 10_800.001 }, { frameRate: Number.NaN }, { frameRate: Number.POSITIVE_INFINITY }, { frameRate: 0 }, { frameRate: 120.001 }];
  for (const timing of bad) assert.notEqual(vectorTiming(timing), "ok", JSON.stringify(timing));
});

test("ensure_text_animator takes the text.opacity role bounded 0-100", () => {
  const ensure = (value: number, role = "text.opacity", on: JsonObject = target): JsonObject => ({ type: "ensure_text_animator", target: on, role, value });
  assertOperations([
    ["ok", ensure(0)],
    ["ok", ensure(100)],
    ["INVALID_VALUE", ensure(101)],
    ["INVALID_OPERATION", ensure(0, "text.position")],
    ["INVALID_TARGET", ensure(0, "text.opacity", { ...target, effectPath: "ADBE Effect Parade/ADBE Tint" })],
  ]);
});

test("set_layer_name refuses an empty name", () => {
  assertOperations([["INVALID_OPERATION", { type: "set_layer_name", target, name: "" }]]);
});

function withoutAnimation(properties: readonly PropertySnapshot[], path: string): PropertySnapshot[] {
  return properties.map((property) => ({ ...property, ...(property.path === path ? { animatable: false as const } : {}), ...(property.children === undefined ? {} : { children: withoutAnimation(property.children, path) }) }));
}

test("keyframes on a property the host reports as not animatable are rejected before approval", () => {
  const snapshot = mapLayers(representativeSnapshot, (layer) => ({ ...layer, properties: withoutAnimation(layer.properties, POSITION) }));
  const animate = { type: "animate_property", target: positionTarget, keyframes: [{ time: 0, value: [0, 0] }, { time: 1, value: [10, 10] }] } satisfies JsonObject;
  const options = { snapshot, bounds: { maxOperations: 1, maxKeyframes: 2, maxKeyframeTimeSeconds: 30 } };
  assert.equal(refusal([animate], options).code, "PROPERTY_NOT_ANIMATABLE");
});
