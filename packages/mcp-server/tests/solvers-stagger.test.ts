// Tests for the stagger solver: orders, curves, spans and item durations.
import test from "node:test";
import assert from "node:assert/strict";
import { solveStagger } from "../src/solvers/stagger.js";

test("forward, 5 items, startTime 1, step 0.1", () => {
  const result = solveStagger({
    count: 5,
    startTime: 1,
    step: 0.1,
    order: "forward",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [1, 1.1, 1.2, 1.3, 1.4]);
    assert.equal(result.span, 0.4);
    assert.deepEqual(result.ranks, [0, 1, 2, 3, 4]);
  }
});

test("reverse, 5 items, startTime 1, step 0.1", () => {
  const result = solveStagger({
    count: 5,
    startTime: 1,
    step: 0.1,
    order: "reverse",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [1.4, 1.3, 1.2, 1.1, 1]);
    assert.equal(result.span, 0.4);
    assert.deepEqual(result.ranks, [4, 3, 2, 1, 0]);
  }
});

test("center-out, 5 items, step 0.2, startTime 0", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.2,
    order: "center-out",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.ranks, [2, 1, 0, 1, 2]);
    assert.deepEqual(result.starts, [0.4, 0.2, 0, 0.2, 0.4]);
    assert.equal(result.span, 0.4);
  }
});

test("center-out, 4 items, step 0.2, startTime 0", () => {
  const result = solveStagger({
    count: 4,
    startTime: 0,
    step: 0.2,
    order: "center-out",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.ranks, [1, 0, 0, 1]);
  }
});

test("edges-in, 5 items, step 0.2, startTime 0", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.2,
    order: "edges-in",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.ranks, [0, 1, 2, 1, 0]);
  }
});

test("total instead of step: 11 items forward over total 1", () => {
  const result = solveStagger({
    count: 11,
    startTime: 0,
    total: 1,
    order: "forward",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const expected = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    assert.deepEqual(result.starts, expected);
    assert.equal(result.span, 1);
  }
});

test("ease-in with 3 items, total 1", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    total: 1,
    order: "forward",
    curve: "ease-in",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [0, 0.25, 1]);
  }
});

test("ease-out with 3 items, total 1", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    total: 1,
    order: "forward",
    curve: "ease-out",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [0, 0.75, 1]);
  }
});

test("ease-in-out with 5 items, total 1", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    total: 1,
    order: "forward",
    curve: "ease-in-out",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const expected = [0, 0.125, 0.5, 0.875, 1];
    assert.deepEqual(result.starts, expected);
  }
});

test("random: deterministic for same seed", () => {
  const result1 = solveStagger({
    count: 8,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 42,
  });

  const result2 = solveStagger({
    count: 8,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 42,
  });

  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
  if (result1.ok && result2.ok) {
    assert.deepEqual(result1.starts, result2.starts);
    assert.deepEqual(result1.ranks, result2.ranks);
  }
});

test("random: different for different seeds", () => {
  const result1 = solveStagger({
    count: 8,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 42,
  });

  const result2 = solveStagger({
    count: 8,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 99,
  });

  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
  if (result1.ok && result2.ok) {
    assert.notDeepEqual(result1.starts, result2.starts);
  }
});

test("random: ranks are a permutation of 0..count-1", () => {
  const result = solveStagger({
    count: 10,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 123,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    const sorted = [...result.ranks].sort((a, b) => a - b);
    const expected = Array.from({ length: 10 }, (_, k) => k);
    assert.deepEqual(sorted, expected);
  }
});

test("itemDuration adds ends and end", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    step: 0.5,
    order: "forward",
    itemDuration: 0.2,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [0, 0.5, 1]);
    assert.deepEqual(result.ends, [0.2, 0.7, 1.2]);
    assert.equal(result.end, 1.2);
  }
});

test("count 1: starts at startTime, span 0", () => {
  const result = solveStagger({
    count: 1,
    startTime: 5,
    step: 0.1,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [5]);
    assert.equal(result.span, 0);
    assert.deepEqual(result.ranks, [0]);
  }
});

test("count 1 with itemDuration", () => {
  const result = solveStagger({
    count: 1,
    startTime: 5,
    step: 0.1,
    itemDuration: 0.3,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [5]);
    assert.deepEqual(result.ends, [5.3]);
    assert.equal(result.end, 5.3);
  }
});

test("default order is forward", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    step: 0.5,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.ranks, [0, 1, 2]);
  }
});

test("default curve is linear", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    step: 0.5,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [0, 0.5, 1]);
  }
});

test("default seed is 1 for random", () => {
  const result1 = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.1,
    order: "random",
  });

  const result2 = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 1,
  });

  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
  if (result1.ok && result2.ok) {
    assert.deepEqual(result1.starts, result2.starts);
  }
});

test("count 1 with total: span is 0 because every start is identical", () => {
  const result = solveStagger({
    count: 1,
    startTime: 2,
    total: 1,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.starts, [2]);
    assert.equal(result.span, 0);
  }
});
