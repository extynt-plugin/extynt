// Argument checks for the arc-path solver: range checks on already-typed numbers, each refusal naming the offending argument.
import { firstProblem } from "./types.js";
import type { Ellipse } from "./ellipse.js";
import type { SpeedProfile, Vec2 } from "./types.js";

/**
 * Where the arc is drawn, around `center`: either a circle from `start` (radius and startAngle are derived from it, so they must not also be passed),
 * or from `radius` with `startAngle`. With the second form, `radiusY` (default `radius`) and `axisRotation` (degrees, default 0) make it an ellipse;
 * startAngle and sweep are then parametric angles on it, as in SVG.
 */
export interface CircleArgs {
  readonly center: Vec2;
  readonly start?: Vec2;
  readonly radius?: number;
  readonly startAngle?: number;
  readonly radiusY?: number;
  readonly axisRotation?: number;
}

/**
 * How the layer travels along the arc and for how long. `sweep` is the degrees to travel (positive clockwise on screen, negative counterclockwise; 0 < |sweep| <= 3600).
 * `segments` is the path segment count (keyframes = segments + 1; default max(2, ceil(|sweep| / 30)), integer 1..64, each segment turning at most 90 degrees).
 * `orient` also solves Rotation so the layer faces its direction of travel; forwardAngle is where the artwork points at rotation 0 (0 right, the default; 90 down; -90 up; 180 left).
 */
export interface MotionArgs {
  readonly sweep: number;
  readonly startTime: number;
  readonly duration: number;
  readonly speed?: SpeedProfile;
  readonly segments?: number;
  readonly orient?: { readonly forwardAngle?: number };
}

const MAX_SWEEP_DEGREES = 3600;
const MAX_SEGMENT_DEGREES = 90;
const DEFAULT_SEGMENT_DEGREES = 30;
const MAX_SEGMENTS = 64;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function finitePointProblem(point: Vec2, name: string): string | undefined {
  return point.every(Number.isFinite) ? undefined : `${name} must contain 2 finite numbers`;
}

function lengthProblem(value: number, name: string): string | undefined {
  if (!Number.isFinite(value)) return `${name} must be a finite number`;
  return value <= 0 ? `${name} must be > 0` : undefined;
}

function angleProblem(value: number, name: string): string | undefined {
  return Number.isFinite(value) ? undefined : `${name} must be a finite number`;
}

function circleFromStart(center: Vec2, start: Vec2): Ellipse | string {
  const dx = start[0] - center[0];
  const dy = start[1] - center[1];
  const radius = Math.hypot(dx, dy);
  if (radius === 0) return "start cannot equal center (radius must be > 0)";
  return { center, radius, radiusY: radius, axisRotation: 0, startAngle: Math.atan2(dy, dx) * DEGREES_PER_RADIAN };
}

function ellipseFromRadius(args: CircleArgs, radius: number, startAngle: number): Ellipse | string {
  const radiusY = args.radiusY ?? radius;
  const axisRotation = args.axisRotation ?? 0;
  const problem = firstProblem([
    () => lengthProblem(radius, "radius"),
    () => angleProblem(startAngle, "startAngle"),
    () => lengthProblem(radiusY, "radiusY"),
    () => angleProblem(axisRotation, "axisRotation"),
  ]);
  return problem ?? { center: args.center, radius, radiusY, axisRotation, startAngle };
}

function ellipseFromStart(args: CircleArgs, start: Vec2): Ellipse | string {
  if (args.radius !== undefined || args.startAngle !== undefined) return "cannot pass both start and radius/startAngle";
  if (args.radiusY !== undefined || args.axisRotation !== undefined) return "radiusY and axisRotation describe an ellipse: pass them with radius and startAngle, not with start";
  return circleFromStart(args.center, start);
}

function ellipseFromParts(args: CircleArgs): Ellipse | string {
  if (args.start !== undefined) return ellipseFromStart(args, args.start);
  if (args.radius === undefined || args.startAngle === undefined) return "must pass either start or both radius and startAngle";
  return ellipseFromRadius(args, args.radius, args.startAngle);
}

/** The circle or ellipse the arc runs on, or the message explaining why the arguments do not describe one. */
export function resolveCircle(args: CircleArgs): Ellipse | string {
  const problem = firstProblem([
    () => finitePointProblem(args.center, "center"),
    () => (args.start === undefined ? undefined : finitePointProblem(args.start, "start")),
  ]);
  return problem ?? ellipseFromParts(args);
}

function sweepProblem(sweep: number): string | undefined {
  if (!Number.isFinite(sweep)) return "sweep must be a finite number";
  if (sweep === 0) return "sweep must be non-zero";
  return Math.abs(sweep) > MAX_SWEEP_DEGREES ? "sweep must satisfy |sweep| <= 3600" : undefined;
}

function startTimeProblem(startTime: number): string | undefined {
  if (!Number.isFinite(startTime)) return "startTime must be a finite number";
  return startTime < 0 ? "startTime must be >= 0" : undefined;
}

function durationProblem(duration: number): string | undefined {
  if (!Number.isFinite(duration)) return "duration must be a finite number";
  return duration <= 0 ? "duration must be > 0" : undefined;
}

/** The message for a sweep, start time or duration out of range, or `undefined` when all three are usable. */
export function motionProblem({ sweep, startTime, duration }: MotionArgs): string | undefined {
  return firstProblem([() => sweepProblem(sweep), () => startTimeProblem(startTime), () => durationProblem(duration)]);
}

function segmentCountProblem(segments: number): string | undefined {
  if (!Number.isInteger(segments)) return "segments must be an integer";
  return segments < 1 || segments > MAX_SEGMENTS ? "segments must be an integer 1..64" : undefined;
}

function segmentTurnProblem(sweep: number, segments: number): string | undefined {
  const turn = Math.abs(sweep);
  if (turn / segments <= MAX_SEGMENT_DEGREES) return undefined;
  return `segments must be at least ${Math.ceil(turn / MAX_SEGMENT_DEGREES)} for a ${turn} degree sweep; each segment may turn at most 90 degrees.`;
}

/** The segment count to use: the one given or a default from the sweep, or the message explaining why it cannot be used. */
export function resolveSegments(sweep: number, requested: number | undefined): number | string {
  const segments = requested ?? Math.min(MAX_SEGMENTS, Math.max(2, Math.ceil(Math.abs(sweep) / DEFAULT_SEGMENT_DEGREES)));
  return segmentCountProblem(segments) ?? segmentTurnProblem(sweep, segments) ?? segments;
}

/** The message for key times that do not strictly increase, or `undefined` when they do. */
export function keyTimesProblem(times: ReadonlyArray<number>): string | undefined {
  const crowded = times.some((time, index) => index > 0 && time <= (times[index - 1] ?? Number.NEGATIVE_INFINITY));
  return crowded ? `duration is too short for ${times.length - 1} segments; use fewer segments or a longer duration.` : undefined;
}

/** The message for an orientation angle that is not finite, or `undefined`. */
export function orientProblem(orient: MotionArgs["orient"]): string | undefined {
  if (orient?.forwardAngle === undefined) return undefined;
  return Number.isFinite(orient.forwardAngle) ? undefined : "orient.forwardAngle must be finite";
}
