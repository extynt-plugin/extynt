// The decision fan-out limiter: no more than the cap is in flight at once, results keep the items' order, and the default cap is three.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DECISION_CONCURRENCY, mapWithConcurrency } from "../src/decision-concurrency.js";

function gauge(): { readonly task: (item: number) => Promise<number>; readonly peak: () => number } {
  let active = 0;
  let peak = 0;
  return {
    task: async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5 + ((item * 7) % 5)));
      active -= 1;
      return item * 10;
    },
    peak: () => peak,
  };
}

test("the default cap is three, and no more than that is in flight", async () => {
  const meter = gauge();
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], meter.task);
  assert.equal(DEFAULT_DECISION_CONCURRENCY, 3);
  assert.equal(meter.peak(), 3);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
});

test("a cap given explicitly holds, and fewer items than the cap run at once", async () => {
  const meter = gauge();
  assert.deepEqual(await mapWithConcurrency([1, 2], meter.task, 8), [10, 20]);
  assert.equal(meter.peak(), 2);
  const capped = gauge();
  await mapWithConcurrency([1, 2, 3, 4], capped.task, 1);
  assert.equal(capped.peak(), 1);
});

test("no items resolve to no results without starting a task", async () => {
  const meter = gauge();
  assert.deepEqual(await mapWithConcurrency([], meter.task), []);
  assert.equal(meter.peak(), 0);
});
