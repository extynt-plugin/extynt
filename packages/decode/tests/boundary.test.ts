/** The entry points: decode, decodeOrThrow, decodeJson, brand and rawJson turn input into results, exceptions and branded values. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, brand, decode, decodeJson, decodeOrThrow, number, object, rawJson, string } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

const layerId = brand("LayerId", string({ nonEmpty: true }));
const scene = object({ layers: array(object({ name: string() })) });

test("decode returns a discriminated result", () => {
  assert.deepEqual(decode(number(), 1), { ok: true, value: 1 });
  const rejected = decode(number(), "1");
  assert.equal(rejected.ok, false);
});

test("decodeOrThrow returns the value", () => {
  assert.equal(decodeOrThrow(number(), 5), 5);
});

test("decodeOrThrow throws a DecodeFailure carrying the error", () => {
  assert.throws(() => decodeOrThrow(scene, { layers: [{ name: 1 }] }), { name: "DecodeFailure", message: /^\$\.layers\[0\]\.name:/ });
});

test("decodeJson parses and decodes", () => {
  const result = decodeJson('{"layers":[{"name":"a"}]}', scene);
  assert.deepEqual(result, { ok: true, value: { layers: [{ name: "a" }] } });
});

test("decodeJson turns a parse failure into a DecodeError at the root", () => {
  const result = decodeJson("{nope", scene);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.path, "$");
  assert.equal(result.error.expected, "valid JSON text");
});

test("decodeJson reports decode errors with their path", () => {
  const result = decodeJson('{"layers":[{"name":1}]}', scene);
  assert.equal(result.ok ? "" : result.error.path, "$.layers[0].name");
});

test("brand passes valid values through and applies the extra check", () => {
  assert.equal(valueOf(layerId, "L1"), "L1");
  assert.equal(errorOf(layerId, "").expected, "non-empty string");
  const even = brand("Even", number(), (value) => value % 2 === 0);
  assert.equal(errorOf(even, 3).expected, "Even");
});

test("rawJson keeps a payload as its JSON text", () => {
  assert.equal(valueOf(rawJson(), { a: [1, "b"] }), '{"a":[1,"b"]}');
  assert.equal(valueOf(rawJson(), "text"), '"text"');
});

test("rawJson rejects values with no JSON form", () => {
  for (const bad of [undefined, Number.NaN, 10n, () => 1]) assert.equal(errorOf(rawJson(), bad).expected, "JSON value");
});

test("rawJson inside an object keeps the opaque payload", () => {
  const request = object({ method: string(), params: rawJson() });
  assert.deepEqual(valueOf(request, { method: "m", params: { x: 1 } }), { method: "m", params: '{"x":1}' });
});
