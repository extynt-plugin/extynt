// Ellipse geometry for the arc-path solver: points, tangent directions and arc lengths at parametric angles, in composition pixels (y down).
import type { Vec2 } from "./types.js";

/**
 * An ellipse in composition pixels: `radius` along its own x axis, `radiusY` along its own y axis, both axes turned by `axisRotation` degrees
 * (clockwise on screen). Angles on it are parametric, as in SVG: angle a is the point center + rotate(axisRotation)·(radius·cos a, radiusY·sin a).
 * A circle is the case radius = radiusY, where the parametric angle is the ordinary one.
 */
export interface Ellipse {
  readonly center: Vec2;
  readonly radius: number;
  readonly radiusY: number;
  readonly axisRotation: number;
  readonly startAngle: number;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
const SIMPSON_INTERVALS_PER_QUARTER_TURN = 32;

function turned(ellipse: Ellipse, x: number, y: number): Vec2 {
  const radians = ellipse.axisRotation * RADIANS_PER_DEGREE;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** Whether the ellipse is a circle, so the solver may keep its exact circular formulas. */
export function isCircle(ellipse: Ellipse): boolean {
  return ellipse.radius === ellipse.radiusY;
}

/** The point at a parametric angle in degrees. */
export function pointOnEllipse(ellipse: Ellipse, angleDegrees: number): Vec2 {
  const radians = angleDegrees * RADIANS_PER_DEGREE;
  const [x, y] = turned(ellipse, ellipse.radius * Math.cos(radians), ellipse.radiusY * Math.sin(radians));
  return [ellipse.center[0] + x, ellipse.center[1] + y];
}

/** The derivative of the point with respect to the parametric angle in radians: the direction of travel for increasing angle, scaled by the local speed. */
export function tangentOnEllipse(ellipse: Ellipse, angleDegrees: number): Vec2 {
  const radians = angleDegrees * RADIANS_PER_DEGREE;
  return turned(ellipse, -ellipse.radius * Math.sin(radians), ellipse.radiusY * Math.cos(radians));
}

function speedAt(ellipse: Ellipse, radians: number): number {
  return Math.hypot(ellipse.radius * Math.sin(radians), ellipse.radiusY * Math.cos(radians));
}

/** The distance along the ellipse between two parametric angles in degrees (always positive), by composite Simpson's rule. */
export function ellipseArcLength(ellipse: Ellipse, fromDegrees: number, toDegrees: number): number {
  const span = Math.abs(toDegrees - fromDegrees) * RADIANS_PER_DEGREE;
  const from = Math.min(fromDegrees, toDegrees) * RADIANS_PER_DEGREE;
  const intervals = SIMPSON_INTERVALS_PER_QUARTER_TURN * Math.max(1, Math.ceil(span / (Math.PI / 2)));
  const step = span / intervals;
  let sum = speedAt(ellipse, from) + speedAt(ellipse, from + span);
  for (let index = 1; index < intervals; index += 1) sum += (index % 2 === 0 ? 2 : 4) * speedAt(ellipse, from + step * index);
  return (sum * step) / 3;
}
