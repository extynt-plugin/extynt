// Tests for elliptical arcs in the arc-path solver: points on the ellipse, exact handles, distance-based timing, orientation and refusals.
import test from "node:test";
import assert from "node:assert/strict";
import { ellipseArcLength } from "../src/solvers/ellipse.js";
import type { Ellipse } from "../src/solvers/ellipse.js";
import type { ArcPathInput } from "../src/solvers/path.js";
import type { SolvedKeyframe, Vec2 } from "../src/solvers/types.js";
import { HALF_CIRCLE, arcRefusal, keyframeAt, numberOf, pointOf, segmentDurations, solvedArc } from "./solvers-arc-fixtures.js";

const WIDE: ArcPathInput = { center: [960, 540], radius: 200, radiusY: 50, startAngle: 0, sweep: 360, startTime: 0, duration: 12, segments: 12 };
const TILTED: ArcPathInput = { ...WIDE, axisRotation: 30, startAngle: 17, sweep: -250, segments: 9 };

function ellipseOf(input: ArcPathInput): Ellipse {
  return { center: input.center, radius: input.radius ?? 0, radiusY: input.radiusY ?? input.radius ?? 0, axisRotation: input.axisRotation ?? 0, startAngle: input.startAngle ?? 0 };
}

function implicitValue(input: ArcPathInput, point: Vec2): number {
  const ellipse = ellipseOf(input);
  const radians = (-ellipse.axisRotation * Math.PI) / 180;
  const dx = point[0] - ellipse.center[0];
  const dy = point[1] - ellipse.center[1];
  const x = dx * Math.cos(radians) - dy * Math.sin(radians);
  const y = dx * Math.sin(radians) + dy * Math.cos(radians);
  return (x / ellipse.radius) ** 2 + (y / ellipse.radiusY) ** 2;
}

function bezierMidpoint(from: SolvedKeyframe, to: SolvedKeyframe): Vec2 {
  const [p0, p3] = [pointOf(from), pointOf(to)];
  const out = from.spatial?.outTangent ?? [0, 0];
  const into = to.spatial?.inTangent ?? [0, 0];
  const p1: Vec2 = [p0[0] + out[0], p0[1] + out[1]];
  const p2: Vec2 = [p3[0] + into[0], p3[1] + into[1]];
  const at = (axis: 0 | 1): number => (p0[axis] + 3 * p1[axis] + 3 * p2[axis] + p3[axis]) / 8;
  return [at(0), at(1)];
}

test("Ellipse: every keyframe lies on the ellipse, tilted or not", () => {
  for (const input of [WIDE, TILTED]) {
    for (const keyframe of solvedArc(input).position.keyframes) {
      assert.ok(Math.abs(implicitValue(input, pointOf(keyframe)) - 1) < 1e-4, `off the ellipse: ${JSON.stringify(keyframe.value)}`);
    }
  }
});

test("Ellipse: the Bézier between keys stays on the ellipse at its midpoint", () => {
  for (const input of [WIDE, TILTED]) {
    const keyframes = solvedArc(input).position.keyframes;
    keyframes.slice(1).forEach((keyframe, index) => {
      const midpoint = bezierMidpoint(keyframeAt(keyframes, index), keyframe);
      assert.ok(Math.abs(implicitValue(input, midpoint) - 1) < 1e-3, `segment ${index} bulges off the ellipse`);
    });
  }
});

test("Ellipse: a constant speed profile keeps on-screen speed even, so keys bunch where the ellipse is tight", () => {
  const keyframes = solvedArc(WIDE).position.keyframes;
  const ellipse = ellipseOf(WIDE);
  const speeds = segmentDurations(keyframes).map((duration, index) => ellipseArcLength(ellipse, index * 30, (index + 1) * 30) / duration);
  const mean = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  speeds.forEach((speed) => assert.ok(Math.abs(speed / mean - 1) < 0.01, `speed ${speed} vs mean ${mean}`));
  const [nearEnd = 0, , nearSide = 0] = segmentDurations(keyframes);
  assert.ok(nearSide > nearEnd * 2, "the long side of the ellipse should take longer than the tight end");
});

test("Ellipse: the measured length matches Ramanujan's perimeter", () => {
  const result = solvedArc(WIDE);
  const h = ((200 - 50) / (200 + 50)) ** 2;
  const perimeter = Math.PI * (200 + 50) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  assert.ok(Math.abs(result.arcLength / perimeter - 1) < 1e-4, `${result.arcLength} vs ${perimeter}`);
  assert.equal(result.radiusY, 50);
  assert.equal(result.axisRotation, 0);
});

test("Ellipse: axisRotation turns the axes clockwise on screen", () => {
  const result = solvedArc({ ...WIDE, axisRotation: 90, sweep: 90, segments: 1 });
  assert.deepEqual(pointOf(keyframeAt(result.position.keyframes, 0)), [960, 740]);
  assert.deepEqual(result.endPoint, [910, 540]);
});

test("Ellipse: radiusY equal to radius gives exactly the circle's answer", () => {
  assert.deepEqual(solvedArc({ ...HALF_CIRCLE, radiusY: 100, axisRotation: 0, orient: {} }), solvedArc({ ...HALF_CIRCLE, orient: {} }));
});

test("Ellipse: orient faces along the tangent and turns a full circle over a full lap", () => {
  const result = solvedArc({ ...WIDE, orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  const rotations = result.rotation.keyframes.map(numberOf);
  assert.equal(rotations[0], 90);
  assert.equal(rotations[3], 180);
  assert.equal((rotations.at(-1) ?? Number.NaN) - (rotations[0] ?? Number.NaN), 360);
});

test("Ellipse: counterclockwise orient turns the other way", () => {
  const result = solvedArc({ ...WIDE, sweep: -360, orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  const rotations = result.rotation.keyframes.map(numberOf);
  assert.equal(rotations[0], -90);
  assert.equal((rotations.at(-1) ?? Number.NaN) - (rotations[0] ?? Number.NaN), -360);
});

test("Ellipse: refusals name the argument", () => {
  assert.match(arcRefusal({ center: [0, 0], start: [100, 0], radiusY: 50, sweep: 90, startTime: 0, duration: 1 }), /radiusY and axisRotation describe an ellipse/);
  assert.match(arcRefusal({ center: [0, 0], start: [100, 0], axisRotation: 10, sweep: 90, startTime: 0, duration: 1 }), /radiusY and axisRotation describe an ellipse/);
  assert.equal(arcRefusal({ ...WIDE, radiusY: 0 }), "radiusY must be > 0");
  assert.equal(arcRefusal({ ...WIDE, radiusY: Number.NaN }), "radiusY must be a finite number");
  assert.equal(arcRefusal({ ...WIDE, axisRotation: Number.POSITIVE_INFINITY }), "axisRotation must be a finite number");
});
