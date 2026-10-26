// The arc-path solver: position (and optional rotation) keyframes that carry a layer around a circle at a chosen speed profile.
import { keyTimesProblem, orientProblem, resolveCircle, resolveSegments, motionProblem } from "./arc-validation.js";
import type { Circle, CircleArgs, MotionArgs } from "./arc-validation.js";
import { round3, solverFailure } from "./types.js";
import type { SolvedKeyframe, SolverFailure, SpeedProfile, Vec2 } from "./types.js";

/** Everything the arc-path solver accepts; see the field notes on the two parts. */
export type ArcPathInput = CircleArgs & MotionArgs;

/** The solved keyframes plus the arc's measured radius, angles, end point and length. */
export interface ArcPathResult {
  readonly ok: true;
  readonly position: { readonly propertyPath: "ADBE Transform Group/ADBE Position"; readonly keyframes: ReadonlyArray<SolvedKeyframe> };
  readonly rotation?: { readonly propertyPath: "ADBE Transform Group/ADBE Rotate Z"; readonly keyframes: ReadonlyArray<SolvedKeyframe> };
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly endPoint: Vec2;
  readonly arcLength: number;
}

interface Arc {
  readonly circle: Circle;
  readonly sweep: number;
  readonly segments: number;
  readonly times: ReadonlyArray<number>;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
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

function pointOnCircle(circle: Circle, angleDegrees: number): Vec2 {
  const radians = angleDegrees * RADIANS_PER_DEGREE;
  return [circle.center[0] + circle.radius * Math.cos(radians), circle.center[1] + circle.radius * Math.sin(radians)];
}

function roundedPoint(point: Vec2): Vec2 {
  return [round3(point[0]), round3(point[1])];
}

function outTangent(arc: Arc, angleDegrees: number): Vec2 {
  const turn = arc.sweep / arc.segments;
  const handleLength = (4 / 3) * Math.tan((Math.abs(turn) * RADIANS_PER_DEGREE) / 4) * arc.circle.radius;
  const radians = angleDegrees * RADIANS_PER_DEGREE;
  const direction = Math.sign(arc.sweep);
  return [direction * handleLength * -Math.sin(radians), direction * handleLength * Math.cos(radians)];
}

function spatialAt(arc: Arc, index: number, angleDegrees: number): NonNullable<SolvedKeyframe["spatial"]> {
  const out = outTangent(arc, angleDegrees);
  const into: Vec2 = [-out[0], -out[1]];
  if (index === 0) return { inTangent: ZERO_TANGENT, outTangent: roundedPoint(out), continuous: false };
  if (index === arc.segments) return { inTangent: roundedPoint(into), outTangent: ZERO_TANGENT, continuous: false };
  return { inTangent: roundedPoint(into), outTangent: roundedPoint(out), continuous: true };
}

function angleAt(arc: Arc, index: number): number {
  return arc.circle.startAngle + (arc.sweep / arc.segments) * index;
}

function positionKeyframes(arc: Arc): ReadonlyArray<SolvedKeyframe> {
  return arc.times.map((time, index) => {
    const angle = angleAt(arc, index);
    return { time, value: roundedPoint(pointOnCircle(arc.circle, angle)), interpolation: LINEAR_BOTH, spatial: spatialAt(arc, index, angle) };
  });
}

function rotationKeyframes(arc: Arc, forwardAngle: number): ReadonlyArray<SolvedKeyframe> {
  const heading = arc.circle.startAngle + 90 * Math.sign(arc.sweep) - forwardAngle;
  const start = normalizeAngle(heading);
  const turn = arc.sweep / arc.segments;
  return arc.times.map((time, index) => ({ time, value: round3(start + turn * index), interpolation: LINEAR_BOTH }));
}

function describeArc(input: ArcPathInput, arc: Arc): Omit<ArcPathResult, "ok" | "position" | "rotation"> {
  const endAngle = arc.circle.startAngle + input.sweep;
  return {
    radius: round3(arc.circle.radius),
    startAngle: round3(arc.circle.startAngle),
    endAngle: round3(endAngle),
    endPoint: roundedPoint(pointOnCircle(arc.circle, endAngle)),
    arcLength: round3(arc.circle.radius * Math.abs(input.sweep * RADIANS_PER_DEGREE)),
  };
}

function keyTimes(input: ArcPathInput, segments: number): ReadonlyArray<number> {
  const fraction = TIME_FRACTION[input.speed ?? "constant"];
  return Array.from({ length: segments + 1 }, (_, index) => round3(input.startTime + input.duration * fraction(index / segments)));
}

function prepareArc(input: ArcPathInput): Arc | string {
  const circle = resolveCircle(input);
  if (typeof circle === "string") return circle;
  const problem = motionProblem(input);
  if (problem) return problem;
  const segments = resolveSegments(input.sweep, input.segments);
  if (typeof segments === "string") return segments;
  const times = keyTimes(input, segments);
  const trailing = keyTimesProblem(times) ?? orientProblem(input.orient);
  return trailing ?? { circle, sweep: input.sweep, segments, times };
}

/** Position keyframes (and rotation keyframes when `orient` is given) that move a layer along the requested arc, or the reason the arguments cannot describe one. */
export function solveArcPath(input: ArcPathInput): ArcPathResult | SolverFailure {
  const arc = prepareArc(input);
  if (typeof arc === "string") return solverFailure(arc);
  const position = { propertyPath: "ADBE Transform Group/ADBE Position", keyframes: positionKeyframes(arc) } as const;
  const rotation = input.orient ? { propertyPath: "ADBE Transform Group/ADBE Rotate Z", keyframes: rotationKeyframes(arc, input.orient.forwardAngle ?? 0) } as const : undefined;
  return { ok: true, position, ...describeArc(input, arc), ...(rotation ? { rotation } : {}) };
}
