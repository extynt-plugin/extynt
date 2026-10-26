/** Scalar decoders accept exactly their kind and enforce their limits, and say where and why they reject. */
import assert from "node:assert/strict";
import test from "node:test";
import { boolean, literal, nullValue, number, string } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

test("string accepts strings and rejects other kinds", () => {
  assert.equal(valueOf(string(), "layer"), "layer");
  assert.deepEqual(errorOf(string(), 3), { path: "$", expected: "string", found: "number", message: "$: expected string, found number" });
  assert.equal(errorOf(string(), null).found, "null");
  assert.equal(errorOf(string(), [1]).found, "array");
});

test("string nonEmpty rejects the empty string", () => {
  assert.equal(valueOf(string({ nonEmpty: true }), "a"), "a");
  assert.equal(errorOf(string({ nonEmpty: true }), "").expected, "non-empty string");
});

test("string maxLength and minLength bound the length", () => {
  assert.equal(valueOf(string({ maxLength: 3 }), "abc"), "abc");
  assert.equal(errorOf(string({ maxLength: 3 }), "abcd").expected, "string of at most 3 characters");
  assert.equal(errorOf(string({ minLength: 2 }), "a").expected, "string of at least 2 characters");
});

test("string pattern requires a match", () => {
  const hex = string({ pattern: /^[0-9a-f]+$/ });
  assert.equal(valueOf(hex, "ff00"), "ff00");
  assert.equal(errorOf(hex, "xyz").found, '"xyz"');
});

test("number accepts finite numbers only", () => {
  assert.equal(valueOf(number(), -1.5), -1.5);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "1", null]) assert.equal(errorOf(number(), bad).expected, "finite number");
});

test("number int, min and max constrain the value", () => {
  assert.equal(valueOf(number({ int: true }), 4), 4);
  assert.equal(errorOf(number({ int: true }), 4.5).expected, "integer");
  assert.equal(errorOf(number({ min: 0 }), -1).expected, "number of at least 0");
  assert.equal(errorOf(number({ max: 10 }), 11).expected, "number of at most 10");
  assert.equal(valueOf(number({ min: 0, max: 10 }), 10), 10);
});

test("boolean accepts only true and false", () => {
  assert.equal(valueOf(boolean(), false), false);
  assert.equal(errorOf(boolean(), 0).expected, "boolean");
});

test("literal accepts only the listed scalars", () => {
  const mode = literal("add", "remove", 3, true);
  assert.equal(valueOf(mode, "remove"), "remove");
  assert.equal(valueOf(mode, 3), 3);
  const error = errorOf(mode, "drop");
  assert.equal(error.expected, '"add" or "remove" or 3 or true');
  assert.equal(error.found, '"drop"');
});

test("nullValue accepts only null", () => {
  assert.equal(valueOf(nullValue, null), null);
  assert.equal(errorOf(nullValue, undefined).expected, "null");
});
