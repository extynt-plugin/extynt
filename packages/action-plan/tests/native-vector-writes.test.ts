// Native vector writes: the Anchor Point contract, per-component nulls resolved against the observed value, and the host view of a plan.
import assert from "node:assert/strict";
import test from "node:test";
import { representativeSnapshot } from "@extynt/project-graph";
import { type JsonObject, type JsonValue } from "@extynt/decode";
import { isActionPlanV2, resolveNativeVectorValue, resolveNativeVectorWrites, type ActionPlanV2, type ActionPlanV2Operation, type NativeVectorResolution } from "../src/index.js";
import { ANCHOR_PATH, BLUR_CONTROL_PATH, BLUR_EFFECT_PATH, nativeWrite, OPACITY_PATH, POSITION_PATH, target } from "./fixtures.js";
import { buildPlan, refusal, verdict } from "./plan-builders.js";

const GENEROUS = { maxOperations: 1, maxKeyframes: 16, maxExpressionLength: 4096 } satisfies JsonObject;

function anchor(value: JsonValue): string {
  return verdict([nativeWrite("transform.anchor", ANCHOR_PATH, value)], { bounds: GENEROUS });
}

function position(value: JsonValue): string {
  return verdict([nativeWrite("transform.position", POSITION_PATH, value)], { bounds: GENEROUS });
}

function messageOf(resolution: NativeVectorResolution): string {
  if (resolution.ok) assert.fail("expected a refusal");
  return resolution.message;
}

function v2Plan(operations: readonly JsonValue[]): ActionPlanV2 {
  const plan = buildPlan({ operations, bounds: { maxOperations: operations.length, maxKeyframes: 16 } });
  if (!isActionPlanV2(plan)) assert.fail("expected a v0.2 plan");
  return plan;
}

function valueOf(operation: ActionPlanV2Operation | undefined): JsonValue | undefined {
  return operation?.type === "set_layer_property" ? operation.value : undefined;
}

test("set_layer_property accepts a 2- or 3-component Anchor Point and its exact magnitude bound", () => {
  for (const value of [[0, 0], [960, 540, 0], [0, 10_000_000]]) assert.equal(anchor(value), "ok", JSON.stringify(value));
});

test("set_layer_property refuses an Anchor Point that is not a bounded 2- or 3-vector", () => {
  const values: readonly JsonValue[] = [[0, 0, 0, 0], 50, [], { x: 0, y: 0 }, [0, 10_000_001], [-10_000_001, 0]];
  for (const value of values) assert.equal(anchor(value), "INVALID_VALUE", JSON.stringify(value));
});

test("a non-finite Anchor Point component is not a JSON value and a role naming another path is refused", () => {
  assert.equal(anchor([Number.POSITIVE_INFINITY, 0]), "INVALID_OPERATION");
  assert.equal(verdict([nativeWrite("transform.position", ANCHOR_PATH, [0, 0])], { bounds: GENEROUS }), "INVALID_TARGET");
});

test("set_layer_property keeps complete position vectors and scalar roles as they were", () => {
  for (const value of [[960, 540], [960, 540, 100]]) assert.equal(position(value), "ok", JSON.stringify(value));
  assert.equal(verdict([nativeWrite("transform.opacity", OPACITY_PATH, 50)], { bounds: GENEROUS }), "ok");
});

test("set_layer_property accepts a null in any component that a current value can fill", () => {
  const values: readonly JsonValue[] = [[700, 540, null], [null, 620, 100], [700, null, null], [700, null, 100], [700, null], [960, null]];
  for (const value of values) assert.equal(position(value), "ok", JSON.stringify(value));
});

test("set_layer_property refuses a position that is a scalar, out of bounds, non-numeric or too long", () => {
  const values: readonly JsonValue[] = [48, [960, 10_000_001], [null, 10_000_001], [960, "540"], [960, 540, 100, 0]];
  for (const value of values) assert.equal(position(value), "INVALID_VALUE", JSON.stringify(value));
});

test("a write that names no component at all is refused and the refusal says what to write instead", () => {
  const allNull = refusal([nativeWrite("transform.position", POSITION_PATH, [null, null, null])], { bounds: GENEROUS });
  assert.equal(allNull.code, "INVALID_VALUE");
  assert.match(allNull.message, /give at least one number/i);
});

test("a null with no current value to keep is refused while a trailing null falls back to the [x, y] spelling", () => {
  const orphan = refusal([nativeWrite("transform.anchor", ANCHOR_PATH, [700, null, 100])], { bounds: GENEROUS });
  assert.equal(orphan.code, "INVALID_VALUE");
  assert.match(orphan.message, /component 1 is null/);
  assert.equal(anchor([700, 620, null]), "ok");
});

test("resolveNativeVectorValue fills exactly the components the request leaves null", () => {
  assert.deepEqual(resolveNativeVectorValue("transform.position", [700, null, 100], [960, 540, 0]), { ok: true, value: [700, 540, 100] });
  assert.deepEqual(resolveNativeVectorValue("transform.scale", [null, 200], [100, 100, 100]), { ok: true, value: [100, 200] });
  assert.deepEqual(resolveNativeVectorValue("transform.position", [960, null], [960, 540]), { ok: true, value: [960, 540] });
});

test("resolveNativeVectorValue leaves the [x, y] spelling to After Effects and needs no before-value for a complete vector", () => {
  assert.deepEqual(resolveNativeVectorValue("transform.position", [700, 620, null], [960, 540]), { ok: true, value: [700, 620] });
  assert.deepEqual(resolveNativeVectorValue("transform.position", [700, 620, 100], undefined), { ok: true, value: [700, 620, 100] });
});

test("resolveNativeVectorValue invents nothing and stays scoped to the three vector roles", () => {
  assert.match(messageOf(resolveNativeVectorValue("transform.position", [700, null, 100], undefined)), /component 1 is null/);
  assert.equal(resolveNativeVectorValue("transform.opacity", [50, null], [50]).ok, false);
});

test("the operations handed to the host carry complete vectors", () => {
  const plan = v2Plan([nativeWrite("transform.position", POSITION_PATH, [700, null, 100]), nativeWrite("transform.opacity", OPACITY_PATH, 50)]);
  const resolved = resolveNativeVectorWrites(plan, representativeSnapshot);
  if (!resolved.ok) assert.fail(resolved.message);
  assert.deepEqual(valueOf(resolved.operations[0]), [700, 540, 100]);
  assert.equal(resolved.operations[1], plan.operations[1]);
  assert.deepEqual(valueOf(plan.operations[0]), [700, null, 100]);
});

test("a null the snapshot cannot fill is refused at the host boundary rather than resolved by guessing", () => {
  const resolved = resolveNativeVectorWrites(v2Plan([nativeWrite("transform.anchor", ANCHOR_PATH, [700, null, 100])]), representativeSnapshot);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.match(resolved.message, /component 1 is null/);
});

const KEYS_BOUNDS = { maxOperations: 1, maxKeyframes: 16, maxExpressionLength: 4096 } satisfies JsonObject;

function animatePosition(keyframes: JsonValue): string {
  return verdict([{ type: "animate_property", target: { ...target, propertyPath: POSITION_PATH }, role: "transform.position", keyframes }], { bounds: KEYS_BOUNDS });
}

test("a keyframe value keeps its complete spellings", () => {
  assert.equal(animatePosition([{ time: 0, value: [960, 540] }, { time: 1, value: [700, 620] }]), "ok");
});

test("a keyframe value refuses the per-component null a static write accepts", () => {
  const sparse = [{ time: 0, value: [960, 540, null] }, { time: 1, value: [700, 620, 0] }];
  const result = refusal([{ type: "animate_property", target: { ...target, propertyPath: POSITION_PATH }, role: "transform.position", keyframes: sparse }], { bounds: KEYS_BOUNDS });
  assert.equal(result.code, "INVALID_VALUE");
  assert.match(result.message, /only a static set_layer_property write/);
});

const controlTarget = { ...target, effectPath: BLUR_EFFECT_PATH, propertyPath: BLUR_CONTROL_PATH } satisfies JsonObject;

function control(value: JsonValue): string {
  return verdict([{ type: "set_effect_control", target: controlTarget, effectMatchName: "ADBE Gaussian Blur 2", value }], { bounds: KEYS_BOUNDS });
}

test("a one-dimensional effect control takes a scalar and refuses a null component", () => {
  assert.equal(control(64), "ok");
  assert.equal(control([64, null]), "INVALID_VALUE");
});

test("the animated control path refuses a null component too", () => {
  const keyframes = [{ time: 0, value: [64, null] }];
  const animated = { type: "animate_control", target: controlTarget, role: "blur.amount", effectMatchName: "ADBE Gaussian Blur 2", keyframes } satisfies JsonObject;
  assert.equal(verdict([animated], { bounds: KEYS_BOUNDS }), "INVALID_VALUE");
});
