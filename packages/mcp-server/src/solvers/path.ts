// The arc-path solver: position (and optional rotation) keyframes that carry a layer around a circle or an ellipse at a chosen speed profile.
import { keyTimesProblem, orientProblem, resolveCircle, resolveSegments, motionProblem } from "./arc-validation.js";
import type { CircleArgs, MotionArgs } from "./arc-validation.js";
import { ellipseArcLength, isCircle, pointOnEllipse, tangentOnEllipse } from "./ellipse.js";
import type { Ellipse } from "./ellipse.js";
import { round3, solverFailure } from "./types.js";
import type { SolvedKeyframe, SolverFailure, SpeedProfile, Vec2 } from "./types.js";

/** Everything the arc-path solver accepts; see the field notes on the two parts. */
export type ArcPathInput = CircleArgs & MotionArgs;

/**
 * The solved keyframes plus the arc's measured radius, angles, end point and length. For an ellipse, `radiusY` and `axisRotation` are present too,
 * the angles are parametric and `arcLength` is measured numerically.
 */
export interface ArcPathResult {
  readonly ok: true;
  readonly position: { readonly propertyPath: "ADBE Transform Group/ADBE Position"; readonly keyframes: ReadonlyArray<SolvedKeyframe> };
  readonly rotation?: { readonly propertyPath: "ADBE Transform Group/ADBE Rotate Z"; readonly keyframes: ReadonlyArray<SolvedKeyframe> };
  readonly radius: number;
  readonly radiusY?: number;
  readonly axisRotation?: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly endPoint: Vec2;
  readonly arcLength: number;
}

interface Arc {
  readonly ellipse: Ellipse;
  readonly sweep: number;
  readonly segments: number;
  readonly times: ReadonlyArray<number>;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const LINEAR_BOTH = { inType: "LINEAR", outType: "LINEAR" } as const;
const ZERO_TANGENT: Vec2 = [0, 0];

const TIME_FRACTION: Readonly<Record<SpeedProfile, (progress: number) => number>> = {
  constant: (progress) => progress,
  accelerate: (progress) => Math.sqrt(progress),
  decelerate: (progress) => 1 - Math.sqrt(1 - progress),
  "ease-in-out": (progress) => (progress < 0.5 ? Math.sqrt(progress / 2) : 1 - Math.sqrt((1 - progress) / 2)),
};

function normalizeAngle(angle: number): number {
  const wrapped = angle % 360;
  if (wrapped > 180) return wrapped - 360;
  return wrapped <= -180 ? wrapped + 360 : wrapped;
}

function roundedPoint(point: Vec2): Vec2 {
  return [round3(point[0]), round3(point[1])];
}

function turnPerSegment(input: { readonly sweep: number; readonly segments: number }): number {
  return input.sweep / input.segments;
}

function angleAt(ellipse: Ellipse, sweep: number, segments: number, index: number): number {
  return ellipse.startAngle + turnPerSegment({ sweep, segments }) * index;
}

function outTangent(arc: Arc, angleDegrees: number): Vec2 {
  const handleScale = (4 / 3) * Math.tan((Math.abs(turnPerSegment(arc)) * RADIANS_PER_DEGREE) / 4) * Math.sign(arc.sweep);
  const [dx, dy] = tangentOnEllipse(arc.ellipse, angleDegrees);
  return [handleScale * dx, handleScale * dy];
}

function spatialAt(arc: Arc, index: number, angleDegrees: number): NonNullable<SolvedKeyframe["spatial"]> {
  const out = outTangent(arc, angleDegrees);
  const into: Vec2 = [-out[0], -out[1]];
  if (index === 0) return { inTangent: ZERO_TANGENT, outTangent: roundedPoint(out), continuous: false };
  if (index === arc.segments) return { inTangent: roundedPoint(into), outTangent: ZERO_TANGENT, continuous: false };
  return { inTangent: roundedPoint(into), outTangent: roundedPoint(out), continuous: true };
}

function positionKeyframes(arc: Arc): ReadonlyArray<SolvedKeyframe> {
  return arc.times.map((time, index) => {
    const angle = angleAt(arc.ellipse, arc.sweep, arc.segments, index);
    return { time, value: roundedPoint(pointOnEllipse(arc.ellipse, angle)), interpolation: LINEAR_BOTH, spatial: spatialAt(arc, index, angle) };
  });
}

function circleRotations(arc: Arc, forwardAngle: number): ReadonlyArray<number> {
  const start = normalizeAngle(arc.ellipse.startAngle + 90 * Math.sign(arc.sweep) - forwardAngle);
  return arc.times.map((_, index) => start + turnPerSegment(arc) * index);
}

function headingAt(arc: Arc, index: number): number {
  const [dx, dy] = tangentOnEllipse(arc.ellipse, angleAt(arc.ellipse, arc.sweep, arc.segments, index));
  return Math.atan2(Math.sign(arc.sweep) * dy, Math.sign(arc.sweep) * dx) * DEGREES_PER_RADIAN;
}

function ellipseRotations(arc: Arc, forwardAngle: number): ReadonlyArray<number> {
  const headings = arc.times.map((_, index) => headingAt(arc, index));
  const rotations = [normalizeAngle((headings[0] ?? 0) - forwardAngle)];
  for (let index = 1; index < headings.length; index += 1) {
    const turn = normalizeAngle((headings[index] ?? 0) - (headings[index - 1] ?? 0));
    rotations.push((rotations[index - 1] ?? 0) + turn);
  }
  return rotations;
}

function rotationKeyframes(arc: Arc, forwardAngle: number): ReadonlyArray<SolvedKeyframe> {
  const rotations = isCircle(arc.ellipse) ? circleRotations(arc, forwardAngle) : ellipseRotations(arc, forwardAngle);
  return arc.times.map((time, index) => ({ time, value: round3(rotations[index] ?? 0), interpolation: LINEAR_BOTH }));
}

function ellipseFields(ellipse: Ellipse): Pick<ArcPathResult, "radiusY" | "axisRotation"> {
  return isCircle(ellipse) ? {} : { radiusY: round3(ellipse.radiusY), axisRotation: round3(ellipse.axisRotation) };
}

function describeArc(input: ArcPathInput, ellipse: Ellipse): Omit<ArcPathResult, "ok" | "position" | "rotation"> {
  const endAngle = ellipse.startAngle + input.sweep;
  return {
    radius: round3(ellipse.radius),
    ...ellipseFields(ellipse),
    startAngle: round3(ellipse.startAngle),
    endAngle: round3(endAngle),
    endPoint: roundedPoint(pointOnEllipse(ellipse, endAngle)),
    arcLength: round3(arcLength(ellipse, input.sweep)),
  };
}

function arcLength(ellipse: Ellipse, sweep: number): number {
  if (isCircle(ellipse)) return ellipse.radius * Math.abs(sweep * RADIANS_PER_DEGREE);
  return ellipseArcLength(ellipse, ellipse.startAngle, ellipse.startAngle + sweep);
}

function distanceProgress(ellipse: Ellipse, sweep: number, segments: number): ReadonlyArray<number> {
  if (isCircle(ellipse)) return Array.from({ length: segments + 1 }, (_, index) => index / segments);
  const travelled = [0];
  for (let index = 1; index <= segments; index += 1) {
    const length = ellipseArcLength(ellipse, angleAt(ellipse, sweep, segments, index - 1), angleAt(ellipse, sweep, segments, index));
    travelled.push((travelled[index - 1] ?? 0) + length);
  }
  const total = travelled[segments] ?? 1;
  return travelled.map((distance, index) => (index === segments ? 1 : distance / total));
}

function keyTimes(input: ArcPathInput, ellipse: Ellipse, segments: number): ReadonlyArray<number> {
  const fraction = TIME_FRACTION[input.speed ?? "constant"];
  return distanceProgress(ellipse, input.sweep, segments).map((progress) => round3(input.startTime + input.duration * fraction(progress)));
}

function prepareArc(input: ArcPathInput): Arc | string {
  const ellipse = resolveCircle(input);
  if (typeof ellipse === "string") return ellipse;
  const problem = motionProblem(input);
  if (problem) return problem;
  const segments = resolveSegments(input.sweep, input.segments);
  if (typeof segments === "string") return segments;
  const times = keyTimes(input, ellipse, segments);
  const trailing = keyTimesProblem(times) ?? orientProblem(input.orient);
  return trailing ?? { ellipse, sweep: input.sweep, segments, times };
}

/**
 * Position keyframes (and rotation keyframes when `orient` is given) that move a layer along the requested arc, or the reason the arguments cannot
 * describe one. On an ellipse the key times follow distance along the path, so a constant speed profile stays constant on screen.
 */
export function solveArcPath(input: ArcPathInput): ArcPathResult | SolverFailure {
  const arc = prepareArc(input);
  if (typeof arc === "string") return solverFailure(arc);
  const position = { propertyPath: "ADBE Transform Group/ADBE Position", keyframes: positionKeyframes(arc) } as const;
  const rotation = input.orient ? { propertyPath: "ADBE Transform Group/ADBE Rotate Z", keyframes: rotationKeyframes(arc, input.orient.forwardAngle ?? 0) } as const : undefined;
  return { ok: true, position, ...describeArc(input, arc.ellipse), ...(rotation ? { rotation } : {}) };
}
