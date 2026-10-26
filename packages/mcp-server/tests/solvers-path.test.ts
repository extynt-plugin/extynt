// Tests for the arc-path solver: keyframe positions, tangents, speed profiles and orientation.
import test from "node:test";
import assert from "node:assert/strict";
import { solveArcPath } from "../src/solvers/path.js";
import { HALF_CIRCLE, keyframeAt, numberOf, pointOf, segmentDurations, solvedArc } from "./solvers-arc-fixtures.js";

test("Half turn clockwise from start [1060,540] around [960,540]", () => {
  const result = solvedArc({ center: [960, 540], start: [1060, 540], sweep: 180, startTime: 0, duration: 1, segments: 3 });
  assert.equal(result.radius, 100);
  assert.equal(result.startAngle, 0);
  assert.equal(result.endAngle, 180);
  assert.deepEqual(result.endPoint, [860, 540]);
  assert.equal(result.position.keyframes.length, 4);
  assert.deepEqual(pointOf(keyframeAt(result.position.keyframes, 0)), [1060, 540]);
  assert.deepEqual(pointOf(keyframeAt(result.position.keyframes, 3)), [860, 540]);
  assert.ok(pointOf(keyframeAt(result.position.keyframes, 1))[1] > 540);
  assert.ok(pointOf(keyframeAt(result.position.keyframes, 2))[1] > 540);
  assert.equal(result.arcLength, 314.159);
});

test("Every keyframe at correct distance from center", () => {
  const result = solvedArc({ center: [500, 300], radius: 150, startAngle: 45, sweep: 270, startTime: 0, duration: 2, segments: 5 });
  for (const keyframe of result.position.keyframes) {
    const [x, y] = pointOf(keyframe);
    const distance = Math.hypot(x - 500, y - 300);
    assert.ok(Math.abs(distance - 150) < 1e-3, `Distance ${distance} not close to 150`);
  }
});

test("Tangent check: 90-degree arc has correct handle length", () => {
  const result = solvedArc({ center: [0, 0], start: [100, 0], sweep: 90, startTime: 0, duration: 1, segments: 1 });
  const spatial = keyframeAt(result.position.keyframes, 0).spatial;
  assert.ok(spatial);
  const handleLength = Math.hypot(spatial.outTangent[0], spatial.outTangent[1]);
  assert.ok(Math.abs(handleLength - (4 / 3) * Math.tan(Math.PI / 8) * 100) < 0.01);
  assert.ok(Math.abs(spatial.outTangent[0]) < 0.01);
  assert.ok(spatial.outTangent[1] > 0);
});

test("Counterclockwise (negative sweep) moves upward first", () => {
  const result = solvedArc({ center: [500, 500], start: [600, 500], sweep: -90, startTime: 0, duration: 1, segments: 2 });
  assert.ok(pointOf(keyframeAt(result.position.keyframes, 1))[1] < 500);
});

test("Speed profile: constant times evenly spaced", () => {
  const result = solvedArc({ ...HALF_CIRCLE, segments: 4, speed: "constant" });
  assert.deepEqual(segmentDurations(result.position.keyframes), [0.25, 0.25, 0.25, 0.25]);
});

test("Speed profile: accelerate has decreasing segment durations", () => {
  const keyframes = solvedArc({ ...HALF_CIRCLE, segments: 4, speed: "accelerate" }).position.keyframes;
  const durations = segmentDurations(keyframes);
  assert.ok(durations.every((duration, index) => index === 0 || duration < (durations[index - 1] ?? 0)));
  assert.equal(keyframeAt(keyframes, 0).time, 0);
  assert.equal(keyframeAt(keyframes, 4).time, 1);
});

test("Speed profile: decelerate has increasing segment durations", () => {
  const keyframes = solvedArc({ ...HALF_CIRCLE, segments: 4, speed: "decelerate" }).position.keyframes;
  const durations = segmentDurations(keyframes);
  assert.ok(durations.every((duration, index) => index === 0 || duration > (durations[index - 1] ?? 0)));
  assert.equal(keyframeAt(keyframes, 0).time, 0);
  assert.equal(keyframeAt(keyframes, 4).time, 1);
});

test("Speed profile: ease-in-out decreases then increases", () => {
  const keyframes = solvedArc({ ...HALF_CIRCLE, segments: 4, speed: "ease-in-out" }).position.keyframes;
  const [first = 0, second = 0, third = 0, fourth = 0] = segmentDurations(keyframes);
  assert.ok(second < first);
  assert.ok(third <= second);
  assert.ok(fourth > third);
  assert.equal(keyframeAt(keyframes, 0).time, 0);
  assert.equal(keyframeAt(keyframes, 4).time, 1);
});

test("Orient: forwardAngle 0 with clockwise from angle 0 gives rotation_0 = 90", () => {
  const result = solvedArc({ center: [0, 0], start: [100, 0], sweep: 180, startTime: 0, duration: 1, segments: 2, orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  assert.equal(numberOf(keyframeAt(result.rotation.keyframes, 0)), 90);
});

test("Orient: rotation deltas equal sweep segment angle", () => {
  const result = solvedArc({ ...HALF_CIRCLE, segments: 3, orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  const rotations = result.rotation.keyframes.map(numberOf);
  const first = rotations[0] ?? Number.NaN;
  rotations.forEach((rotation, index) => assert.equal(rotation - first, (180 / 3) * index));
});

test("Orient: forwardAngle -90 with clockwise from angle 0 gives rotation_0 = 180", () => {
  const result = solvedArc({ center: [0, 0], start: [100, 0], sweep: 90, startTime: 0, duration: 1, segments: 1, orient: { forwardAngle: -90 } });
  assert.ok(result.rotation);
  assert.equal(numberOf(keyframeAt(result.rotation.keyframes, 0)), 180);
});

test("Orient: 720-degree sweep gives last rotation 720 greater than first", () => {
  const result = solvedArc({ center: [0, 0], start: [100, 0], sweep: 720, startTime: 0, duration: 1, segments: 8, orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  const rotations = result.rotation.keyframes.map(numberOf);
  assert.equal((rotations[rotations.length - 1] ?? Number.NaN) - (rotations[0] ?? Number.NaN), 720);
});

test("radius + startAngle form equals equivalent start form", () => {
  const byStart = solvedArc({ center: [500, 300], start: [600, 400], sweep: 180, startTime: 0, duration: 1, segments: 2 });
  const byAngle = solvedArc({ center: [500, 300], radius: byStart.radius, startAngle: byStart.startAngle, sweep: 180, startTime: 0, duration: 1, segments: 2 });
  assert.equal(byStart.radius, byAngle.radius);
  assert.equal(byStart.startAngle, byAngle.startAngle);
  assert.deepEqual(byStart.endPoint, byAngle.endPoint);
  assert.deepEqual(byStart.position.keyframes.map((key) => key.value), byAngle.position.keyframes.map((key) => key.value));
});

test("Keyframe interpolation is LINEAR for position", () => {
  for (const keyframe of solvedArc({ ...HALF_CIRCLE, segments: 2 }).position.keyframes) {
    assert.deepEqual(keyframe.interpolation, { inType: "LINEAR", outType: "LINEAR" });
  }
});

test("First and last position keyframes have no continuous spatial", () => {
  const keyframes = solvedArc({ ...HALF_CIRCLE, segments: 2 }).position.keyframes;
  const first = keyframeAt(keyframes, 0).spatial;
  const last = keyframeAt(keyframes, 2).spatial;
  assert.ok(first && last);
  assert.deepEqual(first.inTangent, [0, 0]);
  assert.deepEqual(last.outTangent, [0, 0]);
  assert.equal(first.continuous, false);
  assert.equal(last.continuous, false);
});

test("Interior position keyframes are continuous", () => {
  const keyframes = solvedArc({ ...HALF_CIRCLE, segments: 3 }).position.keyframes;
  assert.equal(keyframeAt(keyframes, 1).spatial?.continuous, true);
  assert.equal(keyframeAt(keyframes, 2).spatial?.continuous, true);
});

test("Rotation keyframes are LINEAR with no spatial", () => {
  const result = solvedArc({ ...HALF_CIRCLE, segments: 2, orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  for (const keyframe of result.rotation.keyframes) {
    assert.deepEqual(keyframe.interpolation, { inType: "LINEAR", outType: "LINEAR" });
    assert.equal(keyframe.spatial, undefined);
  }
});

test("No rotation keyframes when orient not provided", () => {
  assert.equal(solvedArc(HALF_CIRCLE).rotation, undefined);
});

test("A sweep over 1920 degrees with no explicit segments clamps the default to 64 instead of failing", () => {
  const result = solveArcPath({ center: [960, 540], start: [1060, 540], sweep: 3600, startTime: 0, duration: 4 });
  assert.ok(result.ok);
  assert.equal(result.position.keyframes.length, 65);
});
