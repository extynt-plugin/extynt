/** The shared JSON value decoders: exact acceptance, rejection of what JSON cannot carry, bounded nesting, plain-data keys and the wire form of plain values. */
import assert from "node:assert/strict";
import test from "node:test";
import { JSON_NESTING_LIMIT, decode, isJsonArray, isJsonObject, jsonObject, jsonValue, jsonValueWithin, wireJson } from "../src/index.js";
import type { JsonValue } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

interface Cycle {
  self?: Cycle;
}

function nestedArrays(depth: number): JsonValue {
  let value: JsonValue = [];
  for (let level = 1; level < depth; level++) value = [value];
  return value;
}

test("jsonValue accepts every kind of JSON value unchanged", () => {
  const document = { a: [1, "two", true, null, { b: [] }], c: {} };
  assert.deepEqual(valueOf(jsonValue, document), document);
});

test("jsonValue rejects NaN and infinities and names the path", () => {
  assert.equal(errorOf(jsonValue, { a: [1, Number.NaN] }).path, "$.a[1]");
  assert.equal(errorOf(jsonValue, Number.POSITIVE_INFINITY).expected, "finite number");
});

test("jsonValue rejects a field holding undefined and values JSON cannot carry", () => {
  assert.equal(errorOf(jsonValue, { a: undefined }).path, "$.a");
  assert.equal(errorOf(jsonValue, () => 1).expected, "JSON value");
  assert.equal(errorOf(jsonValue, 1n).expected, "JSON value");
});

test("jsonValue keeps a __proto__ key as plain data without touching the prototype", () => {
  const decoded = valueOf(jsonValue, Object.fromEntries([["__proto__", { polluted: true }], ["constructor", 1]]));
  assert.ok(isJsonObject(decoded));
  assert.deepEqual(Object.keys(decoded), ["__proto__", "constructor"]);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  assert.equal("polluted" in {}, false);
});

test("jsonValue accepts nesting up to the limit and rejects one level more", () => {
  assert.ok(decode(jsonValue, nestedArrays(JSON_NESTING_LIMIT)).ok);
  assert.equal(errorOf(jsonValue, nestedArrays(JSON_NESTING_LIMIT + 1)).expected, "JSON nested less deeply");
});

test("jsonValue rejects hostile nesting without overflowing the stack", () => {
  assert.equal(decode(jsonValue, nestedArrays(50_000)).ok, false);
});

test("jsonValueWithin allows exactly the given number of containers", () => {
  const withinTwo = jsonValueWithin(2);
  assert.ok(decode(withinTwo, [[1]]).ok);
  assert.equal(decode(withinTwo, [[[1]]]).ok, false);
  assert.ok(decode(jsonValueWithin(0), "text").ok);
  assert.equal(decode(jsonValueWithin(0), {}).ok, false);
});

test("jsonObject accepts objects only", () => {
  assert.deepEqual(valueOf(jsonObject, { a: 1 }), { a: 1 });
  assert.equal(errorOf(jsonObject, [1]).expected, "object");
  assert.equal(errorOf(jsonObject, null).expected, "object");
});

test("isJsonObject and isJsonArray tell containers apart", () => {
  assert.ok(isJsonObject({ a: 1 }) && !isJsonObject([1]) && !isJsonObject(null) && !isJsonObject(undefined));
  assert.ok(isJsonArray([1]) && !isJsonArray({}) && !isJsonArray(undefined));
});

test("wireJson drops undefined fields, turns non-finite numbers into null and honours toJSON", () => {
  const plain = { kept: 1, dropped: undefined, nan: Number.NaN, list: [undefined, 2], when: { toJSON: () => "stamp" } };
  assert.deepEqual(valueOf(wireJson, plain), { kept: 1, nan: null, list: [null, 2], when: "stamp" });
});

test("wireJson rejects what JSON cannot carry", () => {
  const cycle: Cycle = {};
  cycle.self = cycle;
  assert.equal(decode(wireJson, undefined).ok, false);
  assert.equal(decode(wireJson, () => 1).ok, false);
  assert.equal(decode(wireJson, Symbol("s")).ok, false);
  assert.equal(decode(wireJson, 1n).ok, false);
  assert.equal(decode(wireJson, cycle).ok, false);
});
