// Tests for plan row format.
import test from "node:test";
import assert from "node:assert/strict";
import { clipText, colorHex, compactNumber, describeFields, formatKeys, formatValue, humanizeName } from "../src/plan-row-format.js";


test("numbers are rounded to two places without trailing zeros or a negative zero", () => {
  assert.equal(compactNumber(55), "55");
  assert.equal(compactNumber(12.3456), "12.35");
  assert.equal(compactNumber(0.1 + 0.2), "0.3");
  assert.equal(compactNumber(-0.001), "0");
  assert.equal(formatValue(100), "100");
  assert.equal(formatValue(Number.NaN), null);
});

test("number lists read as comma-separated components and long ones as a count", () => {
  assert.equal(formatValue([970, 540]), "970, 540");
  assert.equal(formatValue([960, 540, 0]), "960, 540, 0");
  assert.equal(formatValue([50.126, 50]), "50.13, 50");
  assert.equal(formatValue([1, 2, 3, 4, 5, 6, 7]), "7 values");
  assert.equal(formatValue([]), null);
});

test("a colour is hex only when the property is a colour, with alpha only when it is not opaque", () => {
  assert.equal(formatValue([1, 0, 0], true), "#FF0000");
  assert.equal(formatValue([0.2, 0.4, 0.6], true), "#336699");
  assert.equal(formatValue([1, 1, 1, 0.5], true), "#FFFFFF80");
  assert.equal(colorHex([0, 0, 0, 1]), "#000000");
  assert.equal(formatValue([1, 0, 0]), "1, 0, 0", "a bare triple is not guessed to be a colour");
  assert.equal(formatValue([255, 0, 0], true), "255, 0, 0", "values outside 0-1 are not colours");
});

test("booleans read as on and off, and text is flattened and cut at about 40 characters", () => {
  assert.equal(formatValue(true), "on");
  assert.equal(formatValue(false), "off");
  assert.equal(formatValue("Summer"), "Summer");
  assert.equal(formatValue("Line one\rLine two\nLine three"), "Line one Line two Line three");
  const long = formatValue("x".repeat(200)) ?? "";
  assert.equal(long.length, 40);
  assert.ok(long.endsWith("…"));
  assert.equal(clipText("a   b"), "a b");
});

test("values with no single reading are null rather than a raw dump", () => {
  assert.equal(formatValue({ vertices: [[0, 0]] }), null);
  assert.equal(formatValue(null), null);
  assert.equal(formatValue(undefined), null);
  assert.equal(formatValue(""), null);
});

test("keyframe counts are singular or plural", () => {
  assert.equal(formatKeys(1), "1 key");
  assert.equal(formatKeys(3), "3 keys");
});

test("match names, roles and enums read as plain words", () => {
  assert.equal(humanizeName("ADBE Opacity"), "Opacity");
  assert.equal(humanizeName("ADBE Gaussian Blur 2"), "Gaussian Blur");
  assert.equal(humanizeName("ADBE Gaussian Blur 2-0001"), "Gaussian Blur");
  assert.equal(humanizeName("transform.opacity"), "Opacity");
  assert.equal(humanizeName("dropShadow"), "Drop Shadow");
  assert.equal(humanizeName("MULTIPLY"), "Multiply");
  assert.equal(humanizeName("alpha-inverted"), "Alpha inverted");
});

test("a bag of settings reads as a short list with the rest counted", () => {
  assert.equal(describeFields({ fontSize: 48, applyFill: true }), "font size 48, apply fill on");
  assert.equal(describeFields({ fillColor: [1, 0, 0] }), "fill color #FF0000");
  assert.equal(describeFields({ a: 1, b: 2, c: 3, d: 4, e: 5 }), "a 1, b 2, c 3 +2");
  assert.equal(describeFields({}), null);
});
