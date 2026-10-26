/** Expression approval text, animation-evidence bounds and vector/scalar read-back verdicts, verified against adapter envelopes. */
import type { JsonObject, JsonValue } from "@extynt/decode";
import assert from "node:assert/strict";
import test from "node:test";
import { shapeMismatchEvidence, shapeReadbackMatches } from "../src/verify/shape-readback.js";
import { sameControlValue, sameOptionValue } from "../src/verify/compare-values.js";
import { planExpressionLines } from "../src/verify/expression-lines.js";
import { requestOf } from "../src/verify/plan-request.js";
import type { VerifiedStep } from "../src/verify/verdicts.js";
import { applyKeyframeSteps } from "../src/verify/receipt-build.js";
import type { HostApplyResult } from "../src/verify/host-types.js";
import { COMP, LAYER, envelopeOf, PROPERTY_PATH, positionLayer, verdict, writeVerdict } from "./verify-fixtures.js";
import { entry, makeLayer, type Row } from "./native-fixtures.js";

function propertyLayer(value: JsonValue, extra: Row): Row {
  return makeLayer("layer-1", 1, { propertyPaths: [entry(PROPERTY_PATH, { valueType: "vector", value, keyframeCount: 0, ...extra })] });
}

function assertVerdict(result: VerifiedStep | null, state: string, basis?: string): void {
  assert.equal(result?.verificationState, state);
  if (basis !== undefined) assert.equal(result?.basis, basis);
}

function assertWriteVerdict(write: { readonly requested: JsonValue; readonly before: JsonValue | undefined; readonly observed: JsonValue }, state: string, basis?: string): void {
  assertVerdict(writeVerdict(write.requested, write.before, write.observed), state, basis);
}

function requestedPropertyVerdict(value: JsonValue): (observed: JsonValue) => VerifiedStep {
  const operation = { operation: "set_layer_property", propertyPath: PROPERTY_PATH, value };
  return (observed) => verdict({ operations: [operation], layers: [positionLayer(observed)] });
}

test("a 24-operation shape scene can be structurally verified from fresh host readback", () => {
  const path = { vertices: [[0, 0], [100, 0], [100, 100]], closed: true };
  const shapeOperations = Array.from({ length: 6 }, (_, index): ReadonlyArray<{ kind: string; operation: JsonObject; readback: JsonObject }> => [
    { kind: "create_shape_group", operation: { name: `Group ${index}` }, readback: { matchName: "ADBE Vector Group", name: `Group ${index}`, ordinal: index + 1 } },
    { kind: "set_shape_path", operation: { path }, readback: { matchName: "ADBE Vector Shape", vertices: path.vertices, inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]], closed: true } },
    { kind: "ensure_shape_fill", operation: { color: [0.2, 0.4, 0.8], opacity: 75 }, readback: { matchName: "ADBE Vector Graphic - Fill", color: [0.20000000298, 0.4, 0.8, 1], opacity: 75.0001 } },
    { kind: "ensure_shape_stroke", operation: { color: [1, 0.6, 0.2], width: 18, opacity: 90 }, readback: { matchName: "ADBE Vector Graphic - Stroke", color: [1, 0.6, 0.2, 1], width: 18.0001, opacity: 90.0001 } },
  ]).flat();
  assert.equal(shapeOperations.length, 24);
  assert.equal(shapeOperations.every((entry) => shapeReadbackMatches(entry.kind, requestOf({ operation: entry.kind, ...entry.operation }), entry.readback) === true), true, "every shape write has matching bounded host state");
  assert.equal(shapeReadbackMatches("ensure_shape_stroke", requestOf({ operation: "ensure_shape_stroke", color: [1, 0.6, 0.2], width: 18, opacity: 90 }), { matchName: "ADBE Vector Graphic - Stroke", color: [1, 0.6, 0.2], width: 12, opacity: 90 }), false, "a wrong width is a failed readback, not a success string");
  assert.equal(shapeReadbackMatches("set_shape_path", requestOf({ operation: "set_shape_path", path }), undefined), null, "missing native state stays inconclusive for observation recovery");
});

test("the verifier routes every shape kind through the host readback", () => {
  const path = { vertices: [[0, 0], [100, 0], [100, 100]], closed: true };
  const readback = { matchName: "ADBE Vector Shape", vertices: path.vertices, inTangents: [[0, 0], [0, 0], [0, 0]], outTangents: [[0, 0], [0, 0], [0, 0]], closed: true };
  const withReadback = (value: JsonValue) => verdict({ operations: [{ operation: "set_shape_path", path }], hostSteps: [{ operation: "set_shape_path", readback: value }] });
  assertVerdict(withReadback(readback), "exact", "shape-host-readback");
  assertVerdict(withReadback({ ...readback, vertices: [[0, 0], [90, 0], [100, 100]] }), "failed", "shape-host-readback-mismatch");
  assertVerdict(withReadback(null), "applied_unverified", "shape-host-readback-unavailable");
  const mismatch = withReadback({ ...readback, vertices: [[0, 0], [8, 8], [100, 100]] });
  assert.match(String(mismatch.expectedValue), /100,0/);
  assert.match(String(mismatch.observedValue), /8,8/);
});

test("a structured shape mismatch carries bounded expected and observed geometry into repair evidence", () => {
  const operation = { shapes: [{ name: "Ring", paths: [{ vertices: [[0, 0], [10, 0], [10, 10]], closed: true }], fill: { color: [1, 0, 0] } }] };
  const readback = { matchName: "ADBE Root Vectors Group", groups: [{ matchName: "ADBE Vector Group", name: "Ring", paths: 1, points: 2, closedPaths: 1, checksum: 20, fill: { color: [0, 0, 1] } }] };
  const evidence = shapeMismatchEvidence("draw_vector_shapes", requestOf({ operation: "draw_vector_shapes", ...operation }), readback);
  assert.match(evidence.expectedValue, /"shapeIndex":0.*"points":3/);
  assert.match(evidence.observedValue, /"points":2/);
  assert.ok(evidence.expectedValue.length <= 512 && evidence.observedValue.length <= 512);
  const pathEvidence = shapeMismatchEvidence("set_shape_path", requestOf({ operation: "set_shape_path", path: { vertices: [[0, 0], [10, 10]], closed: true } }), { vertices: [[0, 0], [8, 8]], closed: true });
  assert.match(pathEvidence.expectedValue, /10,10/);
  assert.match(pathEvidence.observedValue, /8,8/);
  const drawn = verdict({ operations: [{ operation: "draw_vector_shapes", ...operation }], hostSteps: [{ operation: "draw_vector_shapes", readback }] });
  assert.equal(drawn.verificationState, "failed");
  assert.match(String(drawn.expectedValue), /"shapeIndex":0/);
});

test("the approval line shows the expression source and bounds it", () => {
  const shortSource = "linear(time, 0, thisComp.duration, [960, 1180], [960, -100])";
  const short = planExpressionLines({ operations: [{ operation: "set_expression", propertyPath: PROPERTY_PATH, source: shortSource, enabled: true }] });
  assert.deepEqual(short, [{ propertyPath: PROPERTY_PATH, text: shortSource, truncated: false, length: shortSource.length, remaining: 0 }]);
  const long = planExpressionLines({ operations: [{ operation: "set_expression", target: { propertyPath: PROPERTY_PATH }, source: "x".repeat(4096), enabled: true }] });
  assert.deepEqual([long[0]?.text.length, long[0]?.truncated, long[0]?.length, long[0]?.remaining, long[0]?.propertyPath], [240, true, 4096, 3856, PROPERTY_PATH]);
  assert.equal(planExpressionLines({ expressions: [{ propertyPath: PROPERTY_PATH, source: "valueAtTime(3)" }] }).length, 1);
  assert.equal(planExpressionLines({ operations: [{ operation: "set_expression", propertyPath: PROPERTY_PATH, source: "", enabled: false }] }).length, 0);
  assert.equal(planExpressionLines({ operations: ["set_expression · Set an expression on ADBE Transform Group/ADBE Position"] }).length, 0);
  assert.equal(planExpressionLines({}).length, 0);
});

test("a requested third component that reads back as the zero a 2D layer stores is a coercion", () => {
  const position = requestedPropertyVerdict([960, 540, 100]);
  assertVerdict(position([960, 540, 0]), "applied_unverified", "property-value-coerced");
  assertVerdict(position([961, 540, 0]), "failed");
  assertVerdict(position([960, 999, 0]), "failed");
  assertVerdict(position([960, 540, 7]), "failed");
  assertVerdict(position([960, 540, 100]), "exact");
  assertVerdict(requestedPropertyVerdict([50, 150])([50, 0]), "failed");
  const scale = requestedPropertyVerdict([50, 150]);
  assertVerdict(scale([50, 150, 100]), "exact");
  assertVerdict(scale([50, 150]), "exact");
  assertVerdict(scale([50, 151, 100]), "failed");
  const float32 = requestedPropertyVerdict([960.1, 540]);
  assertVerdict(float32([960.0999755859375, 540]), "exact");
  assertVerdict(float32([960.2, 540]), "failed");
});

function assertPartialVectorMerge(): void {
  assertWriteVerdict({ requested: [960, 540], before: [960, 540, 100], observed: [960, 540, 100] }, "exact");
  assertWriteVerdict({ requested: [50, 150], before: [100, 100, 100], observed: [50, 150, 100] }, "exact");
  assertWriteVerdict({ requested: [960, 540], before: [160, 90, 0], observed: [960, 540, 0] }, "exact");
  assertWriteVerdict({ requested: [960, 540, 100], before: [160, 90, 0], observed: [960, 540, 0] }, "applied_unverified", "property-value-coerced");
  assertWriteVerdict({ requested: [960, 540, 100], before: [160, 90, 0], observed: [960, 540, 100] }, "exact");
  assertWriteVerdict({ requested: [960, 540], before: [960, 540, 100], observed: [960, 540, 7] }, "failed", "property-value-mismatch");
  assertWriteVerdict({ requested: [960, 540, null], before: [960, 540, 100], observed: [960, 540, 100] }, "exact");
  assertWriteVerdict({ requested: [960, 540, null], before: [960, 540, 100], observed: [960, 540, 7] }, "failed", "property-value-mismatch");
  assertWriteVerdict({ requested: [960, 540, null], before: undefined, observed: [960, 540, 100] }, "applied_unverified", "property-value-coerced");
  assertWriteVerdict({ requested: [960, null, 100], before: [960, 540, 100], observed: [960, 540, 100] }, "exact");
  assertWriteVerdict({ requested: [960, null, 100], before: [960, 540, 100], observed: [960, 7, 100] }, "failed");
  assertWriteVerdict({ requested: [960, 540], before: [960, 540, 100], observed: [960, 540] }, "failed");
}

test("a partial vector write keeps the components it left alone, and one that moved is the failure", () => {
  assertPartialVectorMerge();
  assertWriteVerdict({ requested: [960, 540], before: [960, 540, 100], observed: [960, 540, 100.0004] }, "exact");
  assertWriteVerdict({ requested: [960, 540], before: [960, 540, 100], observed: [960, 540, 100.5] }, "failed");
  assertWriteVerdict({ requested: 48, before: 25, observed: [48, 49] }, "failed");
  assertWriteVerdict({ requested: [48, 48], before: [48, 48], observed: [48, 49] }, "failed");
  assertWriteVerdict({ requested: [960, 540], before: [160, 90, 0], observed: [961, 540, 0] }, "failed");
  assertWriteVerdict({ requested: [960, 540, 100], before: [160, 90, 0], observed: [961, 540, 0] }, "failed");
  assertWriteVerdict({ requested: [960, 540], before: undefined, observed: [960, 540, 7] }, "exact");
});

test("a before-value that misses the lookup (a layer the plan just created) leaves a fully matched write exact, never a failure", () => {
  const operation = { operation: "set_layer_property", propertyPath: PROPERTY_PATH, value: [960, 540] };
  for (const before of [envelopeOf([], { id: COMP }), envelopeOf([], { id: "other" })]) {
    assertVerdict(verdict({ operations: [operation], layers: [positionLayer([960, 540, 7])], before }), "exact");
  }
});

test("a scalar property write that reads back as a uniform vector is not called a failure", () => {
  const result = requestedPropertyVerdict(48);
  assertVerdict(result([48, 48]), "applied_unverified", "property-value-broadcast");
  assert.equal(result([48, 48, 48]).basis, "property-value-broadcast");
  assertVerdict(result([48, 49]), "failed", "property-value-mismatch");
  for (const observed of [[49, 48], [48.5, 48.5], [-48, -48], [48]]) assertVerdict(result(observed), "failed");
  assertVerdict(result(48), "exact");
  assertVerdict(result(48.0004), "exact");
  assertVerdict(result(48.5), "failed");
  const positionVerdict = requestedPropertyVerdict([960, 540]);
  assertVerdict(positionVerdict([960, 540, 0]), "exact");
  assertVerdict(positionVerdict([960, 540]), "exact");
  assertVerdict(positionVerdict([960, 999, 0]), "failed");
});

test("a null component of a requested vector reads as zero, and a missing observed component never matches", () => {
  assert.equal(sameControlValue([0, 5], [null, 5]), true);
  assert.equal(sameControlValue([0.0001, 5], [null, 5]), true);
  assert.equal(sameControlValue([1, 5], [null, 5]), false);
  assert.equal(sameControlValue([5], [5, null]), false);
});

test("an effect control read back as a uniform vector still matches its scalar request", () => {
  assert.equal(sameControlValue([48, 48], 48), true);
  assert.equal(sameControlValue(48, 48), true);
  assert.equal(sameControlValue([48, 48], [48, 48]), true);
  assert.equal(sameControlValue([48, 48, 48], 48), true);
  for (const observed of [[48, 49], [49, 49], [], [48], "48"]) assert.equal(sameControlValue(observed, 48), false);
  assert.equal(sameControlValue(48, [48, 48]), false);
  assert.equal(sameControlValue([48, 49], [48, 48]), false);
  assert.equal(sameOptionValue([48, 48], 48), true);
  assert.equal(sameOptionValue([48, 49], 48), false);
  assert.equal(sameOptionValue([48.5, 48.5], 48), false);
  assert.equal(sameOptionValue([1, 1], true), false);
});

test("animation evidence is filtered over the whole plan before the receipt bounds it", () => {
  const animationIndexes = new Set([20, 30, 114]);
  const steps = Array.from({ length: 129 }, (_, index) => ({ operation: animationIndexes.has(index) ? "animate_property" : "set_layer_property", propertyPath: `ADBE Transform Group/ADBE Property ${index}`, keyframeMode: "linear", removedKeys: index % 3, afterKeys: index + 1 }));
  const retained = applyKeyframeSteps({ steps } satisfies HostApplyResult);
  assert.deepEqual(retained.map((step) => step.propertyPath), [20, 30, 114].map((index) => `ADBE Transform Group/ADBE Property ${index}`));
  assert.deepEqual(retained.map((step) => step.afterKeys), [21, 31, 115]);
  const many = Array.from({ length: 400 }, (_, index) => ({ operation: "animate_control", propertyPath: `property-${index}`, afterKeys: index + 1 }));
  assert.equal(applyKeyframeSteps({ steps: many }).length, 256);
  assert.equal(applyKeyframeSteps({ steps: many })[255]?.propertyPath, "property-255");
});

test("a write whose property has an enabled expression is not called a mismatch: the read-back is the expression's output", () => {
  const operation = { operation: "set_layer_property", propertyPath: PROPERTY_PATH, value: [960, 540] };
  const wiggled = (extra: Row) => verdict({ operations: [operation], layers: [propertyLayer([971.4, 528.9], extra)] });
  const under = wiggled({ expressionEnabled: true, expression: "wiggle(2,30)" });
  assertVerdict(under, "applied_unverified", "property-value-under-expression");
  assert.equal(under.observed, false, "the static value was never observed");
  assert.deepEqual(under.observedValue, [971.4, 528.9], "the row reports what was actually read");
  assertVerdict(wiggled({}), "failed", "property-value-mismatch");
  assertVerdict(wiggled({ expressionEnabled: false }), "failed", "property-value-mismatch");
  assertVerdict(verdict({ operations: [operation], layers: [propertyLayer([960, 540], { expressionEnabled: true, expression: "value" })] }), "exact");
});

test("an effect control write under an enabled expression is not called a mismatch", () => {
  const path = "ADBE Effect Parade/ADBE Glo2/ADBE Glo2-0004";
  const operation = { operation: "set_effect_control", propertyPath: path, value: 1.6 };
  const glow = (extra: Row) => verdict({ operations: [operation], layers: [makeLayer(LAYER, 1, { propertyPaths: [entry(path, { valueType: "number", value: 1.27, keyframeCount: 0, ...extra })] })] });
  assertVerdict(glow({ expressionEnabled: true, expression: "time < 0.5 ? wiggle(18, 1.2) : value" }), "applied_unverified", "effect-control-under-expression");
  assertVerdict(glow({}), "failed", "effect-control-value-mismatch");
});

test("set_track_matte reports the matte source's resulting enabled state and checks showMatteLayer against it", () => {
  const matte = (extra: JsonObject) => ({ operation: "set_track_matte", layerId: "title", matteLayerId: "signal", mode: "alpha", ...extra });
  const steps = [{ operation: "set_track_matte", layerId: "title" }];
  const layers = (enabled: boolean) => [makeLayer("signal", 1, { enabled, name: "SIGNAL" }), makeLayer("title", 2, { matteLayerId: "signal", matteType: "alpha" })];
  const hiddenRow = verdict({ operations: [matte({})], hostSteps: steps, layers: layers(false) });
  assertVerdict(hiddenRow, "exact", "track-matte-layer-and-mode");
  assert.equal(hiddenRow.matteSourceEnabled, false);
  assert.match(String(hiddenRow.matteSourceNote), /matte source SIGNAL is hidden .*showMatteLayer: true keeps it rendering/);
  const shownRow = verdict({ operations: [matte({ showMatteLayer: true })], hostSteps: steps, layers: layers(true) });
  assertVerdict(shownRow, "exact", "track-matte-layer-and-mode");
  assert.deepEqual([shownRow.matteSourceEnabled, shownRow.matteSourceNote], [true, undefined]);
  assertVerdict(verdict({ operations: [matte({ showMatteLayer: true })], hostSteps: steps, layers: layers(false) }), "failed", "track-matte-source-hidden");
});

test("turning on a layer that a later step in the batch makes a matte is not called a mismatch", () => {
  const enable = { operation: "set_layer_attribute", layerId: "matte", role: "enabled", value: true };
  const matte = { operation: "set_track_matte", layerId: "title", matteLayerId: "matte", mode: "alpha" };
  const layers = [makeLayer("matte", 1, { enabled: false }), makeLayer("title", 2, { matteLayerId: "matte", matteType: "alpha" })];
  const hostSteps = [{ operation: "set_layer_attribute", layerId: "matte" }, { operation: "set_track_matte", layerId: "title" }];
  assertVerdict(verdict({ operations: [enable, matte], hostSteps, layers }), "applied_unverified", "layer-hidden-as-track-matte");
  assertVerdict(verdict({ operations: [enable], hostSteps: hostSteps.slice(0, 1), layers }), "failed", "layer-attribute-mismatch");
});

test("a value mismatch row says what was asked and what After Effects holds, rounded and bounded", () => {
  const row = requestedPropertyVerdict([960.123456, 540])([971.4, 528.9123456, 0]);
  assertVerdict(row, "failed", "property-value-mismatch");
  assert.equal(row.expectedValue, "[960.123,540]");
  assert.equal(row.observedValue, "[971.4,528.912,0]");
  const long = requestedPropertyVerdict(Array.from({ length: 60 }, (_, index) => index + 0.5))([1]);
  assert.ok(String(long.expectedValue).length <= 81, "the asked value is cut");
});
