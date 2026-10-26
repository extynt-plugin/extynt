// Converts SVG elliptical arcs into cubic Bézier segments, the only curve the host's path form has.
import type { Point } from "./svg-convert-types.js";

type CubicSegment = [Point, Point, Point];

interface ArcRequest {
  from: Point;
  to: Point;
  rx: number;
  ry: number;
  rotation: number;
  large: boolean;
  sweep: boolean;
}

interface Centre {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  start: number;
  sweep: number;
}

interface Axes {
  cos: number;
  sin: number;
}

const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = 2 * Math.PI;

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const angle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  return Number.isFinite(angle) ? angle : 0;
}

function signedSweep(angle: number, clockwise: boolean): number {
  if (!clockwise && angle > 0) return angle - FULL_TURN;
  return clockwise && angle < 0 ? angle + FULL_TURN : angle;
}

function centreForm(arc: ArcRequest, { cos, sin }: Axes): Centre {
  const halfDx = (arc.from[0] - arc.to[0]) / 2;
  const halfDy = (arc.from[1] - arc.to[1]) / 2;
  const x1 = cos * halfDx + sin * halfDy;
  const y1 = -sin * halfDx + cos * halfDy;
  const lambda = (x1 * x1) / (arc.rx * arc.rx) + (y1 * y1) / (arc.ry * arc.ry);
  const enlarge = lambda > 1 ? Math.sqrt(lambda) : 1;
  const rx = arc.rx * enlarge;
  const ry = arc.ry * enlarge;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coefficient = (arc.large === arc.sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxPrime = (coefficient * rx * y1) / ry;
  const cyPrime = (-coefficient * ry * x1) / rx;
  const ux = (x1 - cxPrime) / rx;
  const uy = (y1 - cyPrime) / ry;
  const vx = (-x1 - cxPrime) / rx;
  const vy = (-y1 - cyPrime) / ry;
  return {
    cx: cos * cxPrime - sin * cyPrime + (arc.from[0] + arc.to[0]) / 2,
    cy: sin * cxPrime + cos * cyPrime + (arc.from[1] + arc.to[1]) / 2,
    rx,
    ry,
    start: vectorAngle(1, 0, ux, uy),
    sweep: signedSweep(vectorAngle(ux, uy, vx, vy), arc.sweep),
  };
}

function ellipsePoint(centre: Centre, { cos, sin }: Axes, x: number, y: number): Point {
  return [centre.cx + centre.rx * x * cos - centre.ry * y * sin, centre.cy + centre.rx * x * sin + centre.ry * y * cos];
}

/**
 * An elliptical arc as cubic Béziers of at most a quarter turn each; a degenerate radius is a straight side.
 * Radii too small to span the endpoints are enlarged, following the endpoint-to-centre conversion in the SVG implementation notes.
 */
export function arcToCubics(arc: ArcRequest): CubicSegment[] {
  if (arc.from[0] === arc.to[0] && arc.from[1] === arc.to[1]) return [];
  const rx = Math.abs(arc.rx);
  const ry = Math.abs(arc.ry);
  if (rx === 0 || ry === 0) return [[arc.from, arc.to, arc.to]];
  const phi = (arc.rotation * Math.PI) / 180;
  const axes: Axes = { cos: Math.cos(phi), sin: Math.sin(phi) };
  const centre = centreForm({ ...arc, rx, ry }, axes);
  const count = Math.max(1, Math.ceil(Math.abs(centre.sweep) / QUARTER_TURN - 1e-9));
  const step = centre.sweep / count;
  const handle = (4 / 3) * Math.tan(step / 4);
  const segments: CubicSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const a = centre.start + index * step;
    const b = a + step;
    const end = index === count - 1 ? arc.to : ellipsePoint(centre, axes, Math.cos(b), Math.sin(b));
    segments.push([
      ellipsePoint(centre, axes, Math.cos(a) - handle * Math.sin(a), Math.sin(a) + handle * Math.cos(a)),
      ellipsePoint(centre, axes, Math.cos(b) + handle * Math.sin(b), Math.sin(b) - handle * Math.cos(b)),
      end,
    ]);
  }
  return segments;
}
