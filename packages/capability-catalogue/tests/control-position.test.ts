// Tests where a control value sits in its reported range and against its default.
import assert from "node:assert/strict";
import test from "node:test";
import { controlPosition, describePositionedValue } from "../src/index.js";

const scalar = { valueType: "OneD", minimum: 0, maximum: 200 };

test("position is (value - min) / (max - min) in the reported range, to three decimals", () => {
  assert.deepEqual(controlPosition({ ...scalar, value: 25 }), { position: 0.125, ofDefault: null, reason: null });
  assert.equal(controlPosition({ ...scalar, value: 0 }).position, 0);
  assert.equal(controlPosition({ ...scalar, value: 200 }).position, 1);
  assert.equal(controlPosition({ valueType: "number", value: 0, minimum: -50, maximum: 50 }).position, 0.5);
  assert.equal(controlPosition({ valueType: "OneD", value: 1, minimum: 0, maximum: 3 }).position, 0.333, "rounded, not truncated");
  assert.equal(controlPosition({ valueType: "OneD", value: 2, minimum: 0, maximum: 3 }).position, 0.667);
  assert.equal(Object.is(controlPosition({ valueType: "OneD", value: -0.0001, minimum: -0.0001, maximum: 1 }).position, -0), false, "never a negative zero");
});

test("position relative to the observed default is value / default, only for a known non-zero single-number default", () => {
  assert.equal(controlPosition({ ...scalar, value: 50, defaultValue: 25 }).ofDefault, 2);
  assert.equal(controlPosition({ ...scalar, value: 10, defaultValue: 30 }).ofDefault, 0.333);
  assert.equal(controlPosition({ ...scalar, value: 10, defaultValue: 0 }).ofDefault, null, "a zero default has no ratio");
  assert.equal(controlPosition({ ...scalar, value: 10, defaultValue: undefined }).ofDefault, null);
  assert.equal(controlPosition({ ...scalar, value: 10, defaultValue: [1, 2] }).ofDefault, null);
  assert.equal(controlPosition({ ...scalar, value: 10, defaultValue: Number.NaN }).ofDefault, null);
  assert.equal(controlPosition({ ...scalar, value: 1e308, defaultValue: 1e-308 }).ofDefault, null, "an overflowing ratio is not reported");
  assert.deepEqual(controlPosition({ valueType: "OneD", value: 5, minimum: null, maximum: null, defaultValue: 10 }), { position: null, ofDefault: 0.5, reason: "range-unobserved" }, "the ratio does not need a range");
});

test("a range that cannot carry a position says why, and never invents a bound", () => {
  const reason = (input: Parameters<typeof controlPosition>[0]) => controlPosition(input).reason;
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: null, maximum: null }), "range-unobserved");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: undefined, maximum: undefined }), "range-unobserved");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: 0, maximum: null }), "range-unbounded");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: null, maximum: 10 }), "range-unbounded");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: 3, maximum: 3 }), "range-degenerate");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: 9, maximum: 1 }), "range-invalid");
  assert.equal(reason({ valueType: "OneD", value: 500, minimum: 0, maximum: 200 }), "value-outside-range");
  assert.equal(reason({ valueType: "OneD", value: -1, minimum: 0, maximum: 200 }), "value-outside-range");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: Number.NaN, maximum: 10 }), "range-unbounded");
  assert.equal(reason({ valueType: "OneD", value: 5, minimum: Number.NEGATIVE_INFINITY, maximum: 10 }), "range-unbounded");
  for (const input of [{ valueType: "OneD", value: 5, minimum: null, maximum: 10 }, { valueType: "OneD", value: 5, minimum: 3, maximum: 3 }]) assert.equal(controlPosition(input).position, null);
});

test("vectors, colours, menus, other types and non-numeric values have no position", () => {
  const nothing = (reason: string) => ({ position: null, ofDefault: null, reason });
  for (const valueType of ["TwoD", "TwoD_SPATIAL", "ThreeD", "COLOR", "LAYER_INDEX", "MASK_INDEX", "vector", "color", "enum", "unknown", "NO_VALUE", "", "oned"]) assert.deepEqual(controlPosition({ valueType, value: 5, minimum: 0, maximum: 10, defaultValue: 1 }), nothing("not-numeric-scalar"), valueType);
  assert.deepEqual(controlPosition({ valueType: null, value: 5, minimum: 0, maximum: 10 }), nothing("not-numeric-scalar"));
  assert.deepEqual(controlPosition({ valueType: undefined, value: 5, minimum: 0, maximum: 10 }), nothing("not-numeric-scalar"));
  assert.deepEqual(controlPosition({ ...scalar, value: 1, menu: true, defaultValue: 1 }), nothing("menu"));
  for (const value of [[1, 2], "5", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, true]) assert.equal(controlPosition({ ...scalar, value, defaultValue: 5 }).position, null);
  assert.equal(controlPosition({ ...scalar, value: [1, 2] }).reason, "value-not-finite");
});

test("the position never depends on a name: the same numbers give the same answer", () => {
  const input = { valueType: "OneD", value: 40, minimum: 0, maximum: 100, defaultValue: 20 };
  assert.deepEqual(controlPosition(input), controlPosition({ ...input }));
  assert.deepEqual(Object.keys(controlPosition(input)).sort(), ["ofDefault", "position", "reason"]);
});

test("describePositionedValue words the position with the reported range and unit label, and adds nothing without one", () => {
  const position = controlPosition({ ...scalar, value: 25 });
  assert.equal(describePositionedValue("25", position, { minimum: 0, maximum: 200, units: "pixels" }), "25 (12.5% of 0–200 pixels)");
  assert.equal(describePositionedValue("25", position, { minimum: 0, maximum: 200, units: null }), "25 (12.5% of 0–200)", "no unit label, no unit");
  assert.equal(describePositionedValue("25", position, { minimum: 0, maximum: 200 }), "25 (12.5% of 0–200)");
  assert.equal(describePositionedValue("25", controlPosition({ valueType: "OneD", value: 25, minimum: null, maximum: null }), { minimum: null, maximum: null, units: "pixels" }), "25", "a unit label alone does not make a position");
  assert.equal(describePositionedValue("[1,2]", controlPosition({ valueType: "TwoD", value: [1, 2], minimum: 0, maximum: 9 }), { minimum: 0, maximum: 9 }), "[1,2]");
  assert.equal(describePositionedValue("", position, { minimum: 0, maximum: 200, units: "%" }), " (12.5% of 0–200 %)");
});
