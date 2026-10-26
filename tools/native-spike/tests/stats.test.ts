/** Tests the percentile statistic. */
import assert from "node:assert/strict";
import test from "node:test";
import { percentile, summarize } from "../lib/stats.ts";

test("percentile uses the nearest rank on unsorted input", () => {
  const values = [5, 1, 4, 2, 3];
  assert.equal(percentile(values, 50), 3);
  assert.equal(percentile(values, 95), 5);
  assert.equal(percentile(values, 100), 5);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([7], 95), 7);
});

test("percentile of nothing is null and does not reorder its input", () => {
  assert.equal(percentile([], 50), null);
  const values = [3, 1, 2];
  percentile(values, 50);
  assert.deepEqual(values, [3, 1, 2]);
});

test("p95 of twenty samples is the nineteenth smallest", () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 1);
  assert.equal(percentile(values, 95), 19);
  assert.equal(percentile(values, 50), 10);
});

test("summarize ignores non-numbers and reports n, min, max, mean, p50, p95", () => {
  const stats = summarize([2, 4, undefined, null, 6, Number.NaN]);
  assert.deepEqual(stats, { n: 3, min: 2, max: 6, mean: 4, p50: 4, p95: 6 });
  assert.deepEqual(summarize([]), { n: 0, min: null, max: null, mean: null, p50: null, p95: null });
});
