// Tests for the arc solver's temporal eases: the distance-over-time curve After Effects draws from the keys follows each speed profile smoothly.
import test from "node:test";
import assert from "node:assert/strict";
import { ellipseArcLength } from "../src/solvers/ellipse.js";
import type { ArcPathInput, ArcPathResult } from "../src/solvers/path.js";
import type { SolvedKeyframe, SpeedProfile } from "../src/solvers/types.js";
import { HALF_CIRCLE, keyframeAt, solvedArc } from "./solvers-arc-fixtures.js";

const IDEAL_PROGRESS: Readonly<Record<SpeedProfile, (fraction: number) => number>> = {
  constant: (fraction) => fraction,
  accelerate: (fraction) => fraction ** 2,
  decelerate: (fraction) => 1 - (1 - fraction) ** 2,
  "ease-in-out": (fraction) => (fraction < 0.5 ? 2 * fraction ** 2 : 1 - 2 * (1 - fraction) ** 2),
};

const ELLIPSE: ArcPathInput = { center: [0, 0], radius: 300, radiusY: 80, startAngle: 0, sweep: 270, startTime: 1, duration: 2, segments: 6 };

type Controls = readonly [number, number, number, number];

function cubic([p0, p1, p2, p3]: Controls, u: number): number {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
}

interface Sample {
  readonly time: number;
  readonly distance: number;
}

function segmentSamples(from: SolvedKeyframe, to: SolvedKeyframe, distances: readonly [number, number]): ReadonlyArray<Sample> {
  assert.ok(from.ease && to.ease);
  const span = to.time - from.time;
  const outReach = (from.ease.out.influence / 100) * span;
  const inReach = (to.ease.in.influence / 100) * span;
  const times: Controls = [from.time, from.time + outReach, to.time - inReach, to.time];
  const reached: Controls = [distances[0], distances[0] + from.ease.out.speed * outReach, distances[1] - to.ease.in.speed * inReach, distances[1]];
  return Array.from({ length: 21 }, (_, step) => ({ time: cubic(times, step / 20), distance: cubic(reached, step / 20) }));
}

function travelledAtKeys(input: ArcPathInput, result: ArcPathResult): ReadonlyArray<number> {
  const ellipse = { center: input.center, radius: input.radius ?? 0, radiusY: input.radiusY ?? input.radius ?? 0, axisRotation: 0, startAngle: input.startAngle ?? 0 };
  const segments = result.position.keyframes.length - 1;
  return result.position.keyframes.map((_, index) => ellipseArcLength(ellipse, ellipse.startAngle, ellipse.startAngle + (input.sweep / segments) * index));
}

function largestDrift(input: ArcPathInput, profile: SpeedProfile): number {
  const result = solvedArc({ ...input, speed: profile });
  const travelled = travelledAtKeys(input, result);
  const total = travelled.at(-1) ?? 1;
  const keys = result.position.keyframes;
  const drifts = keys.slice(1).flatMap((keyframe, index) => segmentSamples(keyframeAt(keys, index), keyframe, [travelled[index] ?? 0, travelled[index + 1] ?? 0])
    .map((sample) => Math.abs(sample.distance - total * IDEAL_PROGRESS[profile]((sample.time - input.startTime) / input.duration)) / total));
  return Math.max(...drifts);
}

for (const profile of ["accelerate", "decelerate", "ease-in-out"] as const) {
  test(`Ease (${profile}): the curve between keys follows the profile on a circle and on an ellipse`, () => {
    for (const input of [{ ...HALF_CIRCLE, segments: 4 }, ELLIPSE]) {
      const drift = largestDrift(input, profile);
      assert.ok(drift < 0.005, `${profile} drifts ${(drift * 100).toFixed(3)}% of the path from the ideal`);
    }
  });
}

test("Ease: one segment still accelerates, from rest to twice the average speed", () => {
  const quarter: ArcPathInput = { ...HALF_CIRCLE, sweep: 90, segments: 1 };
  const result = solvedArc({ ...quarter, speed: "accelerate" });
  const average = (Math.PI * 100) / 2;
  assert.equal(keyframeAt(result.position.keyframes, 0).ease?.out.speed, 0);
  assert.ok(Math.abs((keyframeAt(result.position.keyframes, 1).ease?.in.speed ?? 0) - 2 * average) < 0.01);
  assert.ok(largestDrift(quarter, "accelerate") < 1e-4);
});

test("Ease: speed is continuous through each key and keys are BEZIER", () => {
  for (const keyframe of solvedArc({ ...ELLIPSE, speed: "ease-in-out" }).position.keyframes) {
    assert.deepEqual(keyframe.interpolation, { inType: "BEZIER", outType: "BEZIER" });
    assert.equal(keyframe.ease?.in.speed, keyframe.ease?.out.speed);
  }
});

test("Ease: a constant profile keeps plain linear keys", () => {
  for (const keyframe of solvedArc(ELLIPSE).position.keyframes) {
    assert.deepEqual(keyframe.interpolation, { inType: "LINEAR", outType: "LINEAR" });
    assert.equal(keyframe.ease, undefined);
  }
});

test("Ease: Rotation turns in step with the eased motion", () => {
  const result = solvedArc({ ...HALF_CIRCLE, segments: 3, speed: "decelerate", orient: { forwardAngle: 0 } });
  assert.ok(result.rotation);
  const degreesPerPixel = 180 / (Math.PI * 100);
  result.rotation.keyframes.forEach((keyframe, index) => {
    const pathSpeed = keyframeAt(result.position.keyframes, index).ease?.out.speed ?? Number.NaN;
    assert.ok(Math.abs((keyframe.ease?.out.speed ?? Number.NaN) - pathSpeed * degreesPerPixel) < 0.01, `key ${index}`);
  });
});
