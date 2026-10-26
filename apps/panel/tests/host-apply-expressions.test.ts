/**
 * Apply-plan host contract: property and effect-control expressions, their sampled evidence and their failure handling.
 * The fake host and payload builders live in host-apply-harness.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { type FakeLayer, FakeProperty, POSITION_PATH, animatePosition, loadApplyPlan } from "./host-apply-harness.js";
import { childAt, effectParade, itemAt, layerProperty, positionOf } from "./host-fake-lookup.js";
import { TITLE_TARGET, applyPlan, assertApplied, setExpressionOperation } from "./host-plan-io.js";
import { fieldOf, listAt, numberAt, recordAt } from "./json-narrow.js";
import { type JsonObject, type JsonValue } from "@extynt/decode";

test("apply_plan writes and clears an exact property expression without host scripts", () => {
  const { apply, title } = loadApplyPlan();
  const written = applyPlan(apply, "expression-1", [setExpressionOperation(POSITION_PATH, "value + [10, 0]")]);
  assert.equal(fieldOf(written, "ok"), true);
  const position = positionOf(title);
  assert.equal(position.expression, "value + [10, 0]");
  assert.equal(position.expressionEnabled, true);
  assert.equal(fieldOf(written, "steps", 0, "verification"), "expression-enabled");
  const cleared = applyPlan(apply, "expression-2", [{ ...setExpressionOperation(POSITION_PATH, ""), enabled: false }]);
  assert.equal(fieldOf(cleared, "ok"), true);
  assert.equal(position.expressionEnabled, false);
});

const MOTION_KEYS = [{ time: 1, value: [960, 1300] }, { time: 9, value: [960, -100] }];

const MOTION_SAMPLES = [
  { time: 0, value: [960, 1400] },
  { time: 1, value: [960, 1300] },
  { time: 2.5, value: [960, 1000] },
  { time: 5, value: [960, 600] },
  { time: 7.5, value: [960, 200] },
  { time: 9, value: [960, -100] },
  { time: 10, value: [960, -200] },
];

const MOTION_EVIDENCE = [
  { time: 0, value: "[960,1400]" },
  { time: 2.5, value: "[960,1000]" },
  { time: 5, value: "[960,600]" },
  { time: 7.5, value: "[960,200]" },
  { time: 10, value: "[960,-200]" },
  { time: 1, value: "[960,1300]" },
  { time: 9, value: "[960,-100]" },
];

function assertExpressionMotionReported(rolling: JsonObject): void {
  assertApplied(rolling);
  assert.deepEqual(fieldOf(rolling, "steps", 1, "expressionSamples"), MOTION_EVIDENCE);
  assert.equal(fieldOf(rolling, "steps", 1, "expressionChanges"), true);
  assert.equal(fieldOf(rolling, "steps", 1, "expressionSampleMisses"), 0);
  assert.equal(fieldOf(rolling, "steps", 1, "expressionExistingKeys"), 2);
}

test("apply_plan samples an enabled expression at bounded times and reports whether it moves", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  position.expressionValues = MOTION_SAMPLES;
  const rolling = applyPlan(apply, "expression-motion", [
    animatePosition(MOTION_KEYS, { keyframeMode: "reject" }),
    setExpressionOperation(POSITION_PATH, "value + [0, -10]"),
  ]);
  assertExpressionMotionReported(rolling);
  position.expressionValues = [0, 1, 2.5, 5, 7.5, 9, 10].map((time) => ({ time, value: [960, 1400] }));
  const frozen = applyPlan(apply, "expression-frozen", [setExpressionOperation(POSITION_PATH, "[960, 1400]")]);
  assertApplied(frozen);
  assert.equal(fieldOf(frozen, "steps", 0, "expressionChanges"), false);
  assert.equal(listAt(frozen, "steps", 0, "expressionSamples").length, 7);
});

function assertKeysSupersededByEarlierExpression(apply: (raw: string) => string): void {
  const reverse = applyPlan(apply, "expression-reverse", [
    setExpressionOperation(POSITION_PATH, "[960, 540]"),
    animatePosition([{ time: 0, value: [960, 1400] }, { time: 10, value: [960, -200] }], { keyframeMode: "reject" }),
  ]);
  assertApplied(reverse);
  assert.equal(fieldOf(reverse, "steps", 1, "expressionEnabled"), true, "the keyframe step names the expression that makes its keys inert");
}

function assertUnsampledExpressionStaysApplied(apply: (raw: string) => string, position: FakeProperty): void {
  position.valueAtTimeThrows = true;
  const unsampled = applyPlan(apply, "expression-unsampled", [setExpressionOperation(POSITION_PATH, "wiggle(2, 5)")]);
  assertApplied(unsampled);
  assert.equal(position.expression, "wiggle(2, 5)");
  assert.equal(position.expressionEnabled, true, "an unsampled expression stays applied");
  assert.equal(fieldOf(unsampled, "steps", 0, "expressionChanges"), false);
  assert.equal(listAt(unsampled, "steps", 0, "expressionSamples").length, 0);
  assert.ok(numberAt(unsampled, "steps", 0, "expressionSampleMisses") >= 2, "every failed read is counted");
  position.valueAtTimeThrows = false;
}

function assertLateEvaluationErrorIsEvidence(apply: (raw: string) => string, position: FakeProperty): void {
  position.expressionValues = [{ time: 0, value: [960, 540] }, { time: 2.5, value: [960, 540] }, { time: 5, value: null, error: "ReferenceError: sourceRectAtTime is undefined" }];
  const lateError = applyPlan(apply, "expression-late-error", [setExpressionOperation(POSITION_PATH, "thisLayer.sourceRectAtTime(time, false)")]);
  assert.equal(fieldOf(lateError, "ok"), true);
  assert.equal(fieldOf(lateError, "steps", 0, "expressionSampledError"), "ReferenceError: sourceRectAtTime is undefined");
}

test("apply_plan reports the expression a later keyframe write lands on and survives sampling failure", () => {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  assertKeysSupersededByEarlierExpression(apply);
  assertUnsampledExpressionStaysApplied(apply, position);
  assertLateEvaluationErrorIsEvidence(apply, position);
});

interface ExpressionSample {
  readonly time: number;
  readonly value: JsonValue;
}

const SAMPLE_TIMES = [0, 2.5, 5, 7.5, 10];

function sampledAt(points: ReadonlyArray<JsonValue>): ExpressionSample[] {
  return SAMPLE_TIMES.map((time, index) => ({ time, value: itemAt(points, index) }));
}

function constantSamples(point: JsonValue): ExpressionSample[] {
  return sampledAt(SAMPLE_TIMES.map(() => point));
}

function keyedExpressionStep(planId: string, source: string, samples: ReadonlyArray<ExpressionSample> | null): JsonObject {
  const { apply, title } = loadApplyPlan();
  const position = positionOf(title);
  if (samples) position.expressionValues = samples.map(({ time, value }) => ({ time, value }));
  else position.valueAtTimeThrows = true;
  const reply = applyPlan(apply, planId, [
    animatePosition([{ time: 0, value: [960, 1400] }, { time: 10, value: [960, -200] }], { keyframeMode: "reject" }),
    setExpressionOperation(POSITION_PATH, source),
  ]);
  assertApplied(reply);
  return recordAt(reply, "steps", 1);
}

const KEY_VALUES = ["[960,1400]", "[960,-200]"];

test("apply_plan reports whether an enabled expression reads the keyed values", () => {
  const ignored = keyedExpressionStep("expression-keys-ignored", "[960, 1500]", constantSamples([960, 1500]));
  assert.equal(fieldOf(ignored, "expressionKeysReferenced"), "ignored");
  assert.equal(fieldOf(ignored, "expressionExistingKeys"), 2);
  assert.deepEqual(fieldOf(ignored, "expressionKeyValues"), KEY_VALUES);
  const trackedKeys = sampledAt([[960, 1400], [960, 1000], [960, 600], [960, 200], [960, -200]]);
  const referenced = keyedExpressionStep("expression-keys-referenced", "linear(time, 0, 10, valueAtTime(0), valueAtTime(10))", trackedKeys);
  assert.equal(fieldOf(referenced, "expressionKeysReferenced"), "referenced");
  const ambiguous = keyedExpressionStep("expression-keys-ambiguous", "[960, 1400]", constantSamples([960, 1400]));
  assert.equal(fieldOf(ambiguous, "expressionKeysReferenced"), "unknown");
  const unsampled = keyedExpressionStep("expression-keys-unsampled", "wiggle(2, 5)", null);
  assert.equal(fieldOf(unsampled, "expressionKeysReferenced"), "unknown");
  assert.deepEqual(fieldOf(unsampled, "expressionKeyValues"), KEY_VALUES);
  assert.ok(numberAt(unsampled, "expressionSampleMisses") >= 2);
});

test("host property lookup resolves #n ordinals to repeated sibling matchNames", () => {
  const { apply, title } = loadApplyPlan();
  const parade = layerProperty(title, "ADBE Effect Parade");
  const blur = (blurriness: number) => new FakeProperty("ADBE Gaussian Blur 2", "Gaussian Blur", [new FakeProperty("ADBE Gaussian Blur 2-0001", "Blurriness", [], blurriness, true)], null, false);
  parade.children.push(blur(1), blur(2));
  const reply = applyPlan(apply, "ordinal-expression", [setExpressionOperation("ADBE Effect Parade/ADBE Gaussian Blur 2#2/ADBE Gaussian Blur 2-0001", "wiggle(2, 5)")]);
  assertApplied(reply);
  assert.equal(childAt(childAt(parade, 1), 0).expression, "wiggle(2, 5)");
  assert.equal(childAt(childAt(parade, 0), 0).expression, "");
});

const BLUR_PATH = "ADBE Effect Parade/ADBE Gaussian Blur 2";
const BLUR_CONTROL_PATH = `${BLUR_PATH}/ADBE Gaussian Blur 2-0001`;

const ENSURE_BLUR: JsonObject = {
  operation: "ensure_effect",
  ...TITLE_TARGET,
  capabilityId: "adobe.gaussian-blur",
  effectMatchName: "ADBE Gaussian Blur 2",
  effectPath: BLUR_PATH,
};

function blurControlOf(title: FakeLayer): FakeProperty {
  return childAt(childAt(effectParade(title), 0), 0);
}

test("apply_plan writes an expression to an effect control and samples the evaluated value", () => {
  const { apply, title } = loadApplyPlan();
  const ensured = applyPlan(apply, "expression-effect", [ENSURE_BLUR, setExpressionOperation(BLUR_CONTROL_PATH, "time * 10")]);
  assertApplied(ensured);
  const control = blurControlOf(title);
  assert.equal(control.expression, "time * 10");
  assert.equal(control.expressionEnabled, true);
  assert.equal(fieldOf(ensured, "steps", 1, "propertyPath"), BLUR_CONTROL_PATH);
  assert.equal(fieldOf(ensured, "steps", 1, "verification"), "expression-enabled");
  assert.equal(listAt(ensured, "steps", 1, "expressionSamples").length, 5);
  assert.equal(fieldOf(ensured, "steps", 1, "expressionChanges"), false);
  control.expressionValues = [{ time: 0, value: 10 }, { time: 2.5, value: 35 }, { time: 5, value: 60 }, { time: 7.5, value: 85 }, { time: 10, value: 110 }];
  const sampled = applyPlan(apply, "expression-effect-motion", [setExpressionOperation(BLUR_CONTROL_PATH, "time * 10")]);
  assertApplied(sampled);
  assert.deepEqual(fieldOf(sampled, "steps", 0, "expressionSamples"), [{ time: 0, value: "10" }, { time: 2.5, value: "35" }, { time: 5, value: "60" }, { time: 7.5, value: "85" }, { time: 10, value: "110" }]);
  assert.equal(fieldOf(sampled, "steps", 0, "expressionChanges"), true);
  assert.equal(fieldOf(sampled, "steps", 0, "expressionSampleMisses"), 0);
});

test("an expression error on an effect control fails the step and leaves no expression behind", () => {
  const { apply, title } = loadApplyPlan();
  const first = applyPlan(apply, "expression-effect-bad-first", [ENSURE_BLUR]);
  assert.equal(fieldOf(first, "ok"), true);
  const control = blurControlOf(title);
  control.expressionValues = [{ time: 0, value: null, error: "SyntaxError: invalid expression" }];
  const failed = applyPlan(apply, "expression-effect-invalid", [ENSURE_BLUR, setExpressionOperation(BLUR_CONTROL_PATH, "this is not a valid expression")]);
  assert.equal(fieldOf(failed, "ok"), false);
  assert.equal(fieldOf(failed, "error", "code"), "EXPRESSION_INVALID");
  assert.equal(control.expression, "", "the broken source is cleared, never left half-written");
  assert.equal(control.expressionEnabled, false);
  assert.equal(fieldOf(failed, "mutationState"), "partial-applied", "the effect an earlier step added is reported as a real mutation");
  assert.deepEqual(fieldOf(failed, "completedOperations"), ["ensure_effect"], "the completed ensure_effect is reported; the failed expression is not");
  assert.equal(control.numKeys, 0, "no keyframe half-write is left on the control");
});
