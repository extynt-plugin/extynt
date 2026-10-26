/** The path a mask or a shape path carries: vertices with their tangents and a closed flag, checked against the host's bounds. */

import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import { isFiniteNumber, refuse, type Field } from "./fake-host-values.js";

/** A path as the snapshot stores it: every point is an `[x, y]` pair and both tangent lists match the vertices. */
export type ShapePath = { vertices: number[][]; inTangents: number[][]; outTangents: number[][]; closed: boolean };

const SHAPE_PATH_KEYS: ReadonlySet<string> = new Set(["vertices", "inTangents", "outTangents", "closed"]);

const MAX_SHAPE_POINTS = 1000;

/** The refusal message for a path that does not fit, saying which operation received it. */
export function shapePathMessage(subject: string): string {
  return `${subject} must be {vertices, inTangents?, outTangents?, closed} with 1-${MAX_SHAPE_POINTS} two-number points.`;
}

/** A list of `[x, y]` pairs of finite numbers, or nothing when the value is any other shape. */
export function pointsOf(value: Field): number[][] | undefined {
  if (!isWireArray(value)) return undefined;
  const points: number[][] = [];
  for (const point of value) {
    if (!isWireArray(point) || point.length !== 2 || !point.every(isFiniteNumber)) return undefined;
    points.push([...point]);
  }
  return points;
}

function boundedPoints(value: Field): number[][] | undefined {
  const points = pointsOf(value);
  return points && points.length >= 1 && points.length <= MAX_SHAPE_POINTS ? points : undefined;
}

function tangentsOf(value: Field, vertices: number[][]): number[][] | undefined {
  if (value === undefined) return vertices.map(() => [0, 0]);
  const tangents = pointsOf(value);
  return tangents?.length === vertices.length ? tangents : undefined;
}

function shapePathOf(value: Field): ShapePath | undefined {
  if (!isWireObject(value) || !Object.keys(value).every((key) => SHAPE_PATH_KEYS.has(key))) return undefined;
  const closed = value.closed, vertices = boundedPoints(value.vertices);
  if (typeof closed !== "boolean" || !vertices) return undefined;
  const inTangents = tangentsOf(value.inTangents, vertices), outTangents = tangentsOf(value.outTangents, vertices);
  return inTangents && outTangents ? { vertices, inTangents, outTangents, closed } : undefined;
}

/** The valid path, or an INVALID_VALUE refusal with `message`. */
export function requireShapePath(value: Field, message: string): ShapePath {
  const path = shapePathOf(value);
  if (!path) refuse("INVALID_VALUE", message);
  return path;
}
