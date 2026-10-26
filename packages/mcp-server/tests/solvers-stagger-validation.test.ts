// Tests for the stagger solver argument checks.
import test from "node:test";
import assert from "node:assert/strict";
import { solveStagger } from "../src/solvers/stagger.js";

test("failure: both step and total", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.1,
    total: 1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("exactly one of step or total"));
  }
});

test("failure: neither step nor total", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("exactly one of step or total"));
  }
});

test("failure: count 0", () => {
  const result = solveStagger({
    count: 0,
    startTime: 0,
    step: 0.1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("count"));
  }
});

test("failure: count 1001", () => {
  const result = solveStagger({
    count: 1001,
    startTime: 0,
    step: 0.1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("count"));
  }
});

test("failure: count 2.5 (not integer)", () => {
  const result = solveStagger({
    count: 2.5,
    startTime: 0,
    step: 0.1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("count"));
  }
});

test("failure: negative step", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: -0.1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("step"));
  }
});

test("failure: negative startTime", () => {
  const result = solveStagger({
    count: 5,
    startTime: -1,
    step: 0.1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("startTime"));
  }
});

test("failure: span > 3600", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: 1000,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("3600"));
  }
});

test("failure: negative itemDuration", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.1,
    itemDuration: -0.5,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("itemDuration"));
  }
});

test("failure: zero itemDuration", () => {
  const result = solveStagger({
    count: 5,
    startTime: 0,
    step: 0.1,
    itemDuration: 0,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert(result.error.message.includes("itemDuration"));
  }
});

test("failure: negative seed", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: -1,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /seed: must be between 0 and 4294967295/);
});

test("failure: seed 2^32 would collide with seed 0", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 4294967296,
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /seed: must be between 0 and 4294967295/);
});

test("seed 4294967295 is accepted", () => {
  const result = solveStagger({
    count: 3,
    startTime: 0,
    step: 0.1,
    order: "random",
    seed: 4294967295,
  });

  assert.equal(result.ok, true);
});
