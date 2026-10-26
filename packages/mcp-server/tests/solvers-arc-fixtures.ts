// Builders and readers for the arc-path solver tests.
import assert from "node:assert/strict";
import { solveArcPath } from "../src/solvers/path.js";
import type { ArcPathInput, ArcPathResult } from "../src/solvers/path.js";
import type { SolvedKeyframe, Vec2 } from "../src/solvers/types.js";

/** A 180 degree clockwise turn around the origin at radius 100, taking one second. */
export const HALF_CIRCLE: ArcPathInput = { center: [0, 0], radius: 100, startAngle: 0, sweep: 180, startTime: 0, duration: 1 };

/** Solves the input and asserts the solver accepted it. */
export function solvedArc(input: ArcPathInput): ArcPathResult {
  const result = solveArcPath(input);
  assert.ok(result.ok);
  return result;
}

/** The solver's refusal message for the input. */
export function arcRefusal(input: ArcPathInput): string {
  const result = solveArcPath(input);
  assert.ok(!result.ok);
  return result.error.message;
}

/** A keyframe value that is a point. */
export function pointOf(keyframe: SolvedKeyframe): Vec2 {
  assert.ok(typeof keyframe.value !== "number");
  return keyframe.value;
}

/** A keyframe value that is a single number. */
export function numberOf(keyframe: SolvedKeyframe): number {
  assert.ok(typeof keyframe.value === "number");
  return keyframe.value;
}

/** Seconds between each keyframe and the one before it. */
export function segmentDurations(keyframes: ReadonlyArray<SolvedKeyframe>): ReadonlyArray<number> {
  return keyframes.slice(1).map((keyframe, index) => keyframe.time - (keyframes[index]?.time ?? Number.NaN));
}

/** The keyframe at the index, asserted present. */
export function keyframeAt(keyframes: ReadonlyArray<SolvedKeyframe>, index: number): SolvedKeyframe {
  const keyframe = keyframes[index];
  assert.ok(keyframe);
  return keyframe;
}
