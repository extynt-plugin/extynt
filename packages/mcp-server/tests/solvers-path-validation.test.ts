// Tests for the arc-path solver's argument checks, default segment counts and cubic handle lengths.
import test from "node:test";
import assert from "node:assert/strict";
import { solveArcPath } from "../src/solvers/path.js";

test("Validation: both start and radius fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    start: [100, 0],
    radius: 100,
    sweep: 180,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /cannot pass both start and radius/);
});

test("Validation: missing radius fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /must pass either start or both radius and startAngle/);
});

test("Validation: sweep 0 fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 0,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /sweep must be non-zero/);
});

test("Validation: duration 0 fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 0,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /duration must be > 0/);
});

test("Validation: segments 0 fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
    segments: 0,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /segments must be an integer 1\.\.64/);
});

test("Validation: segments 65 fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
    segments: 65,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /segments must be an integer 1\.\.64/);
});

test("Validation: too-short duration with many segments fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 0.001,
    segments: 50,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /duration is too short/);
});

test("Default segments calculated from sweep", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 45,
    startTime: 0,
    duration: 1,
  });

  assert.ok(result.ok === true);
  if (!result.ok) return;

  assert.equal(result.position.keyframes.length, 3);
});

test("Default segments for large sweep", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 360,
    startTime: 0,
    duration: 1,
  });

  assert.ok(result.ok === true);
  if (!result.ok) return;

  assert.equal(result.position.keyframes.length, 13);
});

test("Default speed is constant", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
    segments: 4,
  });

  assert.ok(result.ok === true);
  if (!result.ok) return;

  const keyframes = result.position.keyframes;
  const diffs: number[] = [];
  for (let i = 1; i < keyframes.length; i++) {
    const curr = keyframes[i];
    const prev = keyframes[i - 1];
    if (curr && prev) {
      diffs.push(curr.time - prev.time);
    }
  }

  for (const diff of diffs) {
    assert.equal(diff, 0.25);
  }
});

test("Start equal to center fails validation", () => {
  const result = solveArcPath({
    center: [100, 100],
    start: [100, 100],
    sweep: 180,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /start cannot equal center/);
});

test("Non-finite center fails", () => {
  const result = solveArcPath({
    center: [NaN, 100],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /center must contain 2 finite numbers/);
});

test("Non-finite radius fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: Infinity,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /radius must be a finite number/);
});

test("Negative radius fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: -100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /radius must be > 0/);
});

test("Negative startTime fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: -1,
    duration: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /startTime must be >= 0/);
});

test("Non-finite forwardAngle fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 180,
    startTime: 0,
    duration: 1,
    orient: { forwardAngle: Infinity },
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /forwardAngle must be finite/);
});

test("Validation: 360 degrees in one segment fails with the minimum segment count", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 360,
    startTime: 0,
    duration: 1,
    segments: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /segments must be at least 4 /);
});

test("Validation: 91 degrees in one segment fails", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 91,
    startTime: 0,
    duration: 1,
    segments: 1,
  });

  assert.ok(!result.ok);
  if (result.ok) return;
  assert.match(result.error.message, /segments must be at least 2 /);
});

function firstHandleLength(result: ReturnType<typeof solveArcPath>): number {
  assert.ok(result.ok);
  if (!result.ok) return Number.NaN;
  const tangent = result.position.keyframes[0]?.spatial?.outTangent ?? [Number.NaN, Number.NaN];
  return Math.hypot(tangent[0], tangent[1]);
}

test("Boundary: 90 degrees in one segment is accepted with the standard arc handle", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 90,
    startTime: 0,
    duration: 1,
    segments: 1,
  });

  const handle = firstHandleLength(result);
  const expected = (4 / 3) * Math.tan(Math.PI / 8) * 100;
  assert.ok(Number.isFinite(handle));
  assert.ok(Math.abs(handle - expected) < 0.01, `handle ${handle} should be ${expected}`);
  assert.ok(Math.abs(handle - 0.5523 * 100) < 0.01);
});

test("Boundary: 360 degrees in four segments is accepted with the same per-segment handle", () => {
  const result = solveArcPath({
    center: [0, 0],
    radius: 100,
    startAngle: 0,
    sweep: 360,
    startTime: 0,
    duration: 1,
    segments: 4,
  });

  const handle = firstHandleLength(result);
  assert.ok(Math.abs(handle - (4 / 3) * Math.tan(Math.PI / 8) * 100) < 0.01);
});
