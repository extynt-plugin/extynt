/** Object decoders: required and optional fields, extra-key policy, own-property reads and exactOptionalPropertyTypes output. */
import assert from "node:assert/strict";
import test from "node:test";
import { number, object, optional, string, strictObject } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

const layer = object({ id: string(), opacity: optional(number()) });

test("object decodes required and present optional fields", () => {
  assert.deepEqual(valueOf(layer, { id: "a", opacity: 50 }), { id: "a", opacity: 50 });
});

test("object leaves an absent optional key out of the output", () => {
  const output = valueOf(layer, { id: "a" });
  assert.equal("opacity" in output, false);
});

test("object treats an undefined optional value as absent", () => {
  assert.equal("opacity" in valueOf(layer, { id: "a", opacity: undefined }), false);
});

test("object still validates a present optional value", () => {
  assert.equal(errorOf(layer, { id: "a", opacity: "half" }).path, "$.opacity");
});

test("object reports a missing required field by its path", () => {
  const error = errorOf(layer, {});
  assert.equal(error.path, "$.id");
  assert.equal(error.found, "undefined");
});

test("object ignores extra keys and drops them from the output", () => {
  assert.deepEqual(valueOf(layer, { id: "a", extra: 1 }), { id: "a" });
});

test("object rejects arrays, null and scalars", () => {
  for (const bad of [[], null, "x", 1]) assert.equal(errorOf(layer, bad).expected, "object");
});

test("object does not read inherited properties", () => {
  const inherits = object({ toString: string() });
  assert.equal(errorOf(inherits, {}).path, "$.toString");
});

test("strictObject rejects an unknown key by name", () => {
  const strict = strictObject({ id: string() });
  assert.deepEqual(valueOf(strict, { id: "a" }), { id: "a" });
  const error = errorOf(strict, { id: "a", surprise: 1 });
  assert.equal(error.path, "$.surprise");
  assert.equal(error.expected, "no such field");
});

test("object reports nested paths through objects", () => {
  const outer = object({ layers: object({ first: object({ name: string() }) }) });
  assert.equal(errorOf(outer, { layers: { first: { name: 1 } } }).path, "$.layers.first.name");
});

test("object quotes keys that are not identifiers in the path", () => {
  const odd = object({ "a b": number() });
  assert.equal(errorOf(odd, { "a b": "x" }).path, '$["a b"]');
});
