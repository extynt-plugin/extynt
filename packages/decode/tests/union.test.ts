/** Unions try alternatives in order and list them in errors; tagged unions look up one variant by tag. */
import assert from "node:assert/strict";
import test from "node:test";
import { literal, number, object, string, taggedUnion, union } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

const shape = taggedUnion("kind", {
  circle: object({ kind: literal("circle"), radius: number() }),
  square: object({ kind: literal("square"), side: number() }),
});

test("union returns the first alternative that accepts", () => {
  const either = union(number(), string());
  assert.equal(valueOf(either, 1), 1);
  assert.equal(valueOf(either, "a"), "a");
});

test("union error lists every alternative", () => {
  const error = errorOf(union(number(), string()), true);
  assert.equal(error.expected, "finite number or string");
  assert.equal(error.found, "boolean");
});

test("union error places nested alternatives at their relative path", () => {
  const either = union(object({ id: string() }), object({ id: number() }));
  assert.equal(errorOf(either, { id: true }).expected, "string at .id or finite number at .id");
});

test("taggedUnion decodes the variant named by the tag", () => {
  assert.deepEqual(valueOf(shape, { kind: "square", side: 2 }), { kind: "square", side: 2 });
  assert.deepEqual(valueOf(shape, { kind: "circle", radius: 1 }), { kind: "circle", radius: 1 });
});

test("taggedUnion rejects an unknown tag with the allowed tags", () => {
  const error = errorOf(shape, { kind: "star" });
  assert.equal(error.path, "$.kind");
  assert.equal(error.expected, '"circle" or "square"');
  assert.equal(error.found, '"star"');
});

test("taggedUnion rejects a missing tag and a non-object", () => {
  assert.equal(errorOf(shape, {}).found, "undefined");
  assert.equal(errorOf(shape, "circle").expected, "object");
});

test("taggedUnion reports a field error inside the chosen variant only", () => {
  assert.equal(errorOf(shape, { kind: "circle", radius: "big" }).path, "$.radius");
});

test("taggedUnion does not match inherited names as tags", () => {
  assert.equal(errorOf(shape, { kind: "constructor" }).path, "$.kind");
});
