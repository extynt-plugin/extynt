/** The panel's own decoder helpers: whole counts, absent-as-null, chaining, the acknowledgement and the ignored answer. */
import assert from "node:assert/strict";
import test from "node:test";
import { decode, fallback, object, string } from "@extynt/decode";
import type { Decoder, JsonValue } from "@extynt/decode";
import { acknowledged, andThen, ignored, nullIfAbsent, wholeCount } from "../runtime/wire-decoders.js";

function read<T>(decoder: Decoder<T>, input: JsonValue | undefined): T | null {
  const outcome = decode(decoder, input);
  return outcome.ok ? outcome.value : null;
}

test("wholeCount rounds down and reads anything unusable as zero", () => {
  assert.equal(read(wholeCount, 4.9), 4);
  assert.equal(read(wholeCount, -3), 0);
  assert.equal(read(wholeCount, "7"), 0);
});

test("nullIfAbsent hands an absent field to the decoder as null", () => {
  assert.deepEqual(read(object({ data: nullIfAbsent(fallback(string(), null)) }), {}), { data: null });
});

test("andThen reads the same input with the decoder chosen from the first result", () => {
  const decoder = andThen(object({ kind: fallback(string(), "") }), (head) => object({ word: head.kind === "strict" ? string({ nonEmpty: true }) : string() }));
  assert.deepEqual(read(decoder, { kind: "strict", word: "x" }), { word: "x" });
  assert.equal(read(decoder, { kind: "strict", word: "" }), null);
  assert.deepEqual(read(decoder, { kind: "loose", word: "" }), { word: "" });
  assert.equal(read(decoder, 5), null);
});

test("ignored accepts any input, and acknowledged needs ok true", () => {
  for (const input of [null, 1, "x", [], { a: 1 }]) assert.equal(read(ignored, input), null);
  assert.deepEqual(read(acknowledged, { ok: true, extra: 1 }), { ok: true });
  assert.equal(read(acknowledged, { ok: false }), null);
});
