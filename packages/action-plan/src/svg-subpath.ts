// The converter's working path form, vertices with absolute Bézier handles, and its projection into an After Effects shape path.
import type { ShapePath } from "./plan-types.js";
import { applyMatrix } from "./svg-matrix.js";
import type { Matrix, Point } from "./svg-convert-types.js";

interface PathNode {
  p: Point;
  inHandle: Point;
  outHandle: Point;
}

/** A vertex list with absolute in and out handles; a handle equal to its vertex is a straight side. */
export interface Subpath {
  nodes: PathNode[];
  closed: boolean;
}

const EPSILON = 1e-9;

export function startSubpath(p: Point): Subpath {
  return { nodes: [{ p, inHandle: p, outHandle: p }], closed: false };
}

export function lineTo(sub: Subpath, p: Point): void {
  sub.nodes.push({ p, inHandle: p, outHandle: p });
}

export function curveTo(sub: Subpath, c1: Point, c2: Point, p: Point): void {
  const last = sub.nodes.at(-1);
  if (last) last.outHandle = c1;
  sub.nodes.push({ p, inHandle: c2, outHandle: p });
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

/** Closes the subpath; closing on the start point merges the duplicate end vertex into the first one, so the loop has no zero-length side. */
export function closeSubpath(sub: Subpath): void {
  sub.closed = true;
  const first = sub.nodes[0];
  const last = sub.nodes.at(-1);
  if (sub.nodes.length > 1 && first && last && samePoint(first.p, last.p)) {
    first.inHandle = last.inHandle;
    sub.nodes.pop();
  }
}

export function round4(value: number): number {
  const rounded = Math.round(value * 1e4) / 1e4;
  return rounded === 0 ? 0 : rounded;
}

function roundedPoint(point: Point): Point {
  return [round4(point[0]), round4(point[1])];
}

function isZero(point: Point): boolean {
  return point[0] === 0 && point[1] === 0;
}

function projectNode(node: PathNode, matrix: Matrix): { vertex: Point; inTangent: Point; outTangent: Point } {
  const vertex = applyMatrix(matrix, node.p);
  const tangent = (handle: Point): Point => {
    const moved = applyMatrix(matrix, handle);
    return roundedPoint([moved[0] - vertex[0], moved[1] - vertex[1]]);
  };
  return { vertex: roundedPoint(vertex), inTangent: tangent(node.inHandle), outTangent: tangent(node.outHandle) };
}

/** The subpath under `matrix` as an After Effects path: vertices plus in and out tangents relative to each vertex, omitted when every side is straight. */
export function toShapePath(sub: Subpath, matrix: Matrix): ShapePath {
  const projected = sub.nodes.map((node) => projectNode(node, matrix));
  const vertices = projected.map((node) => node.vertex);
  const inTangents = projected.map((node) => node.inTangent);
  const outTangents = projected.map((node) => node.outTangent);
  const straight = inTangents.every(isZero) && outTangents.every(isZero);
  return straight ? { vertices, closed: sub.closed } : { vertices, inTangents, outTangents, closed: sub.closed };
}
