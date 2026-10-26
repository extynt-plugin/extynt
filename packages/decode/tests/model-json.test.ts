/** Reading JSON a model wrote: code fences, surrounding prose, trailing commas and the failure reported when nothing parses. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, decodeModelJson, number, object, string, stripCodeFence } from "../src/index.js";
import type { Decoder } from "../src/index.js";

const answer = object({ n: number() });
const numbers = array(number());

function modelValue<T>(text: string, decoder: Decoder<T>): T {
  const result = decodeModelJson(text, decoder);
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

test("stripCodeFence removes a fence with or without a language tag", () => {
  assert.equal(stripCodeFence('```json\n{"n":1}\n```'), '{"n":1}');
  assert.equal(stripCodeFence("```\n[1]\n```"), "[1]");
  assert.equal(stripCodeFence("  plain  "), "plain");
});

test("decodeModelJson reads plain JSON", () => {
  assert.deepEqual(modelValue('{"n":1}', answer), { n: 1 });
});

test("decodeModelJson reads a fenced block", () => {
  assert.deepEqual(modelValue('```json\n{"n":2}\n```', answer), { n: 2 });
});

test("decodeModelJson reads an object surrounded by prose", () => {
  assert.deepEqual(modelValue('Here you go: {"n":3} Hope that helps.', answer), { n: 3 });
});

test("decodeModelJson reads an array surrounded by prose", () => {
  assert.deepEqual(modelValue("Sure: [1, 2, 3] done", numbers), [1, 2, 3]);
});

test("decodeModelJson removes trailing commas", () => {
  assert.deepEqual(modelValue('{"n":4,}', answer), { n: 4 });
  assert.deepEqual(modelValue("[1, 2,\n]", numbers), [1, 2]);
});

test("decodeModelJson leaves a comma inside a valid string untouched", () => {
  assert.deepEqual(modelValue('{"s":"a,}"}', object({ s: string() })), { s: "a,}" });
});

test("decodeModelJson reports the whole text's failure when no reading decodes", () => {
  const result = decodeModelJson("not json at all", answer);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.path, "$");
});

test("decodeModelJson reports a shape failure at its field", () => {
  const result = decodeModelJson('{"n":"x"}', answer);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.path, "$.n");
});
