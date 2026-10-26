// Proves jsonOf and its siblings keep exactly what JSON serialisation keeps, with anything it cannot carry left out, without a text round trip.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, jsonFieldsOf, jsonItems, jsonOf, jsonRecordOf } from "../src/json.js";

test("scalars, arrays and objects pass through; a non-finite number becomes null", () => {
  assert.deepEqual(jsonOf({ a: 1, b: [true, "x", null], c: { d: Number.NaN, e: Number.POSITIVE_INFINITY } }), { a: 1, b: [true, "x", null], c: { d: null, e: null } });
});

test("a field JSON cannot carry is dropped from an object and becomes null in an array", () => {
  assert.deepEqual(jsonOf({ keep: 1, gone: undefined, fn: () => 1, sym: Symbol("s") }), { keep: 1 });
  assert.deepEqual(jsonOf([1, undefined, () => 1]), [1, null, null]);
  assert.equal(jsonOf(undefined), null);
});

test("a value with toJSON travels as its toJSON result", () => {
  assert.equal(jsonOf(new Date(Date.UTC(2026, 0, 2))), "2026-01-02T00:00:00.000Z");
  assert.deepEqual(jsonOf({ at: { toJSON: () => ({ n: 2 }) } }), { at: { n: 2 } });
});

test("jsonFieldsOf and jsonRecordOf give fields only for an object", () => {
  assert.deepEqual(jsonFieldsOf({ a: 1 }), { a: 1 });
  assert.deepEqual(jsonFieldsOf([1]), {});
  assert.deepEqual(jsonRecordOf({ a: undefined, b: 2 }), { b: 2 });
  assert.equal(jsonRecordOf("text"), undefined);
});

test("jsonItems leaves out an item JSON cannot carry", () => {
  assert.deepEqual(jsonItems([1, undefined, { a: 1 }, () => 1]), [1, { a: 1 }]);
});

test("canonicalJson sorts every object's keys whatever order they were built in", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 1, c: 2 } }), canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), "{\"a\":2,\"b\":1}");
});
