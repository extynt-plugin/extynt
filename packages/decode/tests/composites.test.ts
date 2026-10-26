/** Array, tuple, record, nullable, map, refine and lazy decoders compose their parts and report the failing position. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, lazy, map, nullable, number, object, record, refine, string, tuple } from "../src/index.js";
import type { Decoder } from "../src/index.js";
import { errorOf, valueOf } from "./support.js";

test("array decodes every item and returns a new array", () => {
  const input = ["a", "b"];
  const output = valueOf(array(string()), input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
});

test("array reports the index of the first bad item", () => {
  const error = errorOf(array(number()), [1, 2, "three"]);
  assert.equal(error.path, "$[2]");
  assert.equal(error.message, "$[2]: expected finite number, found string");
});

test("array enforces maxLength and minLength", () => {
  assert.equal(errorOf(array(number(), { maxLength: 2 }), [1, 2, 3]).expected, "array of at most 2 items");
  assert.equal(errorOf(array(number(), { minLength: 1 }), []).expected, "array of at least 1 items");
  assert.equal(errorOf(array(number()), { length: 0 }).expected, "array");
});

test("tuple decodes each position with its own decoder", () => {
  assert.deepEqual(valueOf(tuple(string(), number()), ["x", 2]), ["x", 2]);
  assert.equal(errorOf(tuple(string(), number()), ["x", "y"]).path, "$[1]");
  assert.equal(errorOf(tuple(string(), number()), ["x"]).expected, "array of exactly 2 items");
});

test("record decodes an open map and checks every key and value", () => {
  const sizes = record(string({ nonEmpty: true }), number());
  assert.deepEqual(valueOf(sizes, { a: 1, b: 2 }), { a: 1, b: 2 });
  assert.equal(errorOf(sizes, { a: 1, b: "x" }).path, "$.b");
  assert.equal(errorOf(sizes, { "": 1 }).path, '$[""]');
});

test("record keeps a __proto__ key as data without touching the prototype", () => {
  const output = valueOf(record(string(), number()), JSON.parse('{"__proto__": 1}'));
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal(Object.keys(output).join(), "__proto__");
});

test("nullable accepts null or the inner value", () => {
  assert.equal(valueOf(nullable(string()), null), null);
  assert.equal(valueOf(nullable(string()), "a"), "a");
  assert.equal(errorOf(nullable(string()), 1).expected, "string");
});

test("map converts the decoded value and passes failures through", () => {
  const length = map(string(), (text) => text.length);
  assert.equal(valueOf(length, "four"), 4);
  assert.equal(errorOf(length, 4).expected, "string");
});

test("refine keeps values the guard accepts and names the expectation otherwise", () => {
  const isEven = (value: number): value is number => value % 2 === 0;
  const even = refine(number(), isEven, "an even number");
  assert.equal(valueOf(even, 4), 4);
  assert.deepEqual(errorOf(even, 3), { path: "$", expected: "an even number", found: "3", message: "$: expected an even number, found 3" });
});

interface Tree {
  readonly name: string;
  readonly children: ReadonlyArray<Tree>;
}

const tree: Decoder<Tree> = lazy(() => object({ name: string(), children: array(tree) }));

test("lazy decodes a recursive structure", () => {
  const input = { name: "root", children: [{ name: "leaf", children: [] }] };
  assert.deepEqual(valueOf(tree, input), input);
});

test("lazy reports the full path into a recursive structure", () => {
  const input = { name: "root", children: [{ name: "a", children: [{ name: 7, children: [] }] }] };
  assert.equal(errorOf(tree, input).path, "$.children[0].children[0].name");
});
