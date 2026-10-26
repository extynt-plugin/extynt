/** The snapshot answer decodes a parsed object once: the same object reads the same reply, a different object reads its own. */
import assert from "node:assert/strict";
import test from "node:test";
import { decode } from "@extynt/decode";
import type { JsonArray } from "@extynt/decode";
import type { ProbeSnapshot } from "../src/server-types.js";
import { snapshotAnswer } from "../src/verify/snapshot-reply.js";
import { COMP, envelopeOf, positionLayer } from "./verify-fixtures.js";

function replyOf(input: ProbeSnapshot | string | JsonArray) {
  const decoded = decode(snapshotAnswer, input);
  assert.ok(decoded.ok);
  return decoded.value;
}

test("the same parsed object decodes once and reads the same reply", () => {
  const envelope = envelopeOf([positionLayer([1, 2])]);
  assert.equal(replyOf(envelope), replyOf(envelope));
});

test("an equal but separate object is decoded on its own, so a changed copy never reads a stale reply", () => {
  const first = envelopeOf([positionLayer([1, 2])]);
  const second = envelopeOf([positionLayer([3, 4])]);
  const one = replyOf(first), two = replyOf(second);
  assert.notEqual(one, two);
  assert.deepEqual(replyOf(structuredClone(second)), two);
  assert.equal(two.result?.compositions?.[0]?.id, COMP);
});

test("text is decoded every time and anything that is not a snapshot reply is a failed read", () => {
  const text = JSON.stringify(envelopeOf([positionLayer([1, 2])]));
  assert.notEqual(replyOf(text), replyOf(text));
  assert.deepEqual(replyOf([]), { ok: false });
});
