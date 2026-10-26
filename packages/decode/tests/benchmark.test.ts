/** Decoding a large array of small objects stays fast: 10k elements decode far inside a generous time budget. */
import assert from "node:assert/strict";
import test from "node:test";
import { array, boolean, number, object, optional, string } from "../src/index.js";
import { valueOf } from "./support.js";

const BUDGET_MS = 50;
const ELEMENT_COUNT = 10_000;
const keyframe = object({ id: string(), time: number(), value: number(), locked: boolean(), label: optional(string()) });

const elements = Array.from({ length: ELEMENT_COUNT }, (_, index) => ({ id: `k${index}`, time: index / 24, value: index % 100, locked: index % 2 === 0, extra: true }));

test("a 10k element array of small objects decodes well under the budget", () => {
  const decoder = array(keyframe);
  valueOf(decoder, elements);
  const started = performance.now();
  const decoded = valueOf(decoder, elements);
  const elapsedMs = performance.now() - started;
  assert.equal(decoded.length, ELEMENT_COUNT);
  assert.ok(elapsedMs < BUDGET_MS, `took ${elapsedMs} ms`);
});
