// Shared contract for the motion solvers: pure functions that compute values the model would otherwise do arithmetic for.
// Coordinates are After Effects composition pixels (x right, y down); angles are degrees, positive clockwise on screen.

/** A point or pair of values in composition pixels. */
export type Vec2 = readonly [number, number];

/** The failure every solver returns for an argument it refuses. */
export interface SolverFailure {
  readonly ok: false;
  readonly error: { readonly code: "INVALID_ARGUMENT"; readonly message: string };
}

interface SolvedInterpolation {
  readonly inType: "LINEAR" | "BEZIER";
  readonly outType: "LINEAR" | "BEZIER";
}

interface SolvedSpatial {
  readonly inTangent: Vec2;
  readonly outTangent: Vec2;
  readonly continuous: boolean;
}

/** Exactly the keyframe shape `animate_property` accepts, so a result can be pasted into a plan unchanged. */
export interface SolvedKeyframe {
  readonly time: number;
  readonly value: number | Vec2;
  readonly interpolation?: SolvedInterpolation;
  readonly spatial?: SolvedSpatial;
}

/** How the moving layer's progress along the path relates to time. */
export type SpeedProfile = "constant" | "accelerate" | "decelerate" | "ease-in-out";

/** A refusal with the given message. */
export function solverFailure(message: string): SolverFailure {
  return { ok: false, error: { code: "INVALID_ARGUMENT", message } };
}

/** Rounds to 3 decimals so results are readable and stable in tests; negative zero becomes zero. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

/** The first message among lazily evaluated checks, so a later check may rely on an earlier one having passed. */
export function firstProblem(checks: ReadonlyArray<() => string | undefined>): string | undefined {
  for (const check of checks) {
    const problem = check();
    if (problem !== undefined) return problem;
  }
  return undefined;
}
