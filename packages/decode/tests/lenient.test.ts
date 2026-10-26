/** The never-failing decoders: fallback, absentAs, skippingInvalid and skippingInvalidRecord keep valid data and replace or drop the rest. */
import assert from "node:assert/strict";
import test from "node:test";
import { Failure, absentAs, fail, fallback, number, object, optional, skippingInvalid, skippingInvalidRecord, string } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

test("fallback passes a valid value and replaces a rejected one", () => {
  const port = fallback(number({ int: true }), 8080);
  assert.equal(valueOf(port, 9000), 9000);
  assert.equal(valueOf(port, "9000"), 8080);
  assert.equal(valueOf(port, Number.NaN), 8080);
  assert.equal(valueOf(port, undefined), 8080);
});

test("fallback with undefined or null reads a bad field as not given or absent", () => {
  assert.equal(valueOf(fallback(string(), undefined), 3), undefined);
  assert.equal(valueOf(fallback(string(), null), 3), null);
});

test("fallback never produces a Failure for a rejected nested object", () => {
  const row = fallback(object({ id: string() }), { id: "none" });
  assert.deepEqual(valueOf(row, { id: 7 }), { id: "none" });
});

test("a fallback field keeps the rest of its row when it is optional and bad", () => {
  const row = object({ id: string(), note: optional(fallback(string(), undefined)) });
  assert.deepEqual(valueOf(row, { id: "a", note: 5 }), { id: "a", note: undefined });
  assert.deepEqual(valueOf(row, { id: "a" }), { id: "a" });
});

test("absentAs replaces only an absent value and still rejects a present bad one", () => {
  const count = absentAs(number(), 0);
  assert.equal(valueOf(count, undefined), 0);
  assert.equal(valueOf(count, 4), 4);
  assert.equal(errorOf(count, "4").expected, "finite number");
  assert.equal(errorOf(count, null).expected, "finite number");
});

test("absentAs treats a missing object key as absent", () => {
  const row = object({ count: absentAs(number(), 0) });
  assert.deepEqual(valueOf(row, {}), { count: 0 });
  assert.equal(errorOf(row, { count: "x" }).path, "$.count");
});

test("skippingInvalid keeps valid entries in order and drops the rest", () => {
  assert.deepEqual(valueOf(skippingInvalid(number()), [1, "x", 2, null, Number.NaN, 3]), [1, 2, 3]);
});

test("skippingInvalid reads only the first readLimit entries", () => {
  assert.deepEqual(valueOf(skippingInvalid(number(), 3), [1, "x", 2, 3, 4]), [1, 2]);
  assert.deepEqual(valueOf(skippingInvalid(number(), 0), [1]), []);
});

test("skippingInvalid rejects input that is not an array", () => {
  assert.equal(errorOf(skippingInvalid(number()), { 0: 1 }).expected, "array");
  assert.equal(errorOf(skippingInvalid(number()), undefined).expected, "array");
});

test("skippingInvalid drops a hole in a sparse array", () => {
  const sparse = [1, 2, 3];
  delete sparse[1];
  assert.deepEqual(valueOf(skippingInvalid(number()), sparse), [1, 3]);
});

test("skippingInvalidRecord keeps valid entries and drops the rest", () => {
  assert.deepEqual(valueOf(skippingInvalidRecord(string()), { a: "x", b: 1, c: "z" }), { a: "x", c: "z" });
  assert.equal(errorOf(skippingInvalidRecord(string()), ["x"]).expected, "object");
});

test("skippingInvalidRecord keeps a __proto__ entry as plain data", () => {
  const decoded = valueOf(skippingInvalidRecord(string()), Object.fromEntries([["__proto__", "x"], ["ok", "y"]]));
  assert.deepEqual(Object.keys(decoded), ["__proto__", "ok"]);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
});

test("the exported Failure is what a rejecting decoder returns", () => {
  assert.ok(string().run(1) instanceof Failure);
  assert.ok(fail("string", 1) instanceof Failure);
  assert.equal(string().run("a") instanceof Failure, false);
});
