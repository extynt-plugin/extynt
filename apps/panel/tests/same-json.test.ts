/** Structural equality of JSON values: same data compares equal whatever the key order, any difference does not. */
import assert from "node:assert/strict";
import test from "node:test";
import { sameJson } from "../runtime/same-json.js";

test("scalars are equal only when identical", () => {
  assert.equal(sameJson(1, 1), true);
  assert.equal(sameJson("a", "a"), true);
  assert.equal(sameJson(null, null), true);
  assert.equal(sameJson(1, 2), false);
  assert.equal(sameJson(0, null), false);
  assert.equal(sameJson("1", 1), false);
});

test("objects are equal whatever the key order", () => {
  assert.equal(sameJson({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }), true);
});

test("objects differ by a value, a missing key or an extra key", () => {
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
  assert.equal(sameJson({ a: 1, b: 2 }, { a: 1 }), false);
  assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(sameJson({ a: 1 }, { b: 1 }), false);
});

test("lists are equal only in the same order and length", () => {
  assert.equal(sameJson([1, 2], [1, 2]), true);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson([1], [1, 2]), false);
});

test("a list never equals an object or a scalar", () => {
  assert.equal(sameJson([], {}), false);
  assert.equal(sameJson({}, []), false);
  assert.equal(sameJson([1], 1), false);
  assert.equal(sameJson({ a: 1 }, null), false);
});
