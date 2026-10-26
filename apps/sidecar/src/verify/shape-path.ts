// A bezier path as requested and as the host read it back: every vertex, both tangent arrays and the closed flag, or for a long path its count, weighted digest and first and last points.
import { array, boolean, decode, fallback, jsonValue, number, object, optional, tuple } from "@extynt/decode";
import type { Infer } from "@extynt/decode";
import { readbackTolerance, sameNumber } from "./compare-values.js";
import type { Reading } from "./compare-values.js";
import { listOf, objectOf } from "./json-fields.js";

const PATH_EDGE = 8;
const DIGEST_WEIGHTS = [1, 2, 3, 5, 7, 11];
const ARRAY_KEYS = ["vertices", "inTangents", "outTangents"] as const;
const ORIGIN: Point = [0, 0];

const point = tuple(number(), number());

const requestedPath = object({
  vertices: optional(fallback(array(point), undefined)),
  inTangents: optional(fallback(array(point), undefined)),
  outTangents: optional(fallback(array(point), undefined)),
  closed: optional(fallback(boolean(), undefined)),
});

const readPath = object({
  closed: optional(fallback(boolean(), undefined)),
  vertices: optional(fallback(jsonValue, undefined)),
  inTangents: optional(fallback(jsonValue, undefined)),
  outTangents: optional(fallback(jsonValue, undefined)),
  count: optional(fallback(jsonValue, undefined)),
  digest: optional(fallback(number(), undefined)),
  head: optional(fallback(jsonValue, undefined)),
  tail: optional(fallback(jsonValue, undefined)),
});

type Point = Infer<typeof point>;
type ArrayKey = (typeof ARRAY_KEYS)[number];

/** A requested path: vertices, optional tangents (zero when left out) and whether it closes. */
export type ShapePath = Infer<typeof requestedPath>;

interface PathExpectation {
  readonly points: number;
  readonly closedPaths: number;
  readonly sum: number;
  readonly budget: number;
}

/** Accepts a path as a request writes it; every part of it is optional. */
export const shapePathDecoder = requestedPath;

function tangentsOf(path: ShapePath, key: "inTangents" | "outTangents"): ReadonlyArray<Point> {
  return path[key] ?? (path.vertices ?? []).map(() => ORIGIN);
}

function requestedArray(path: ShapePath, key: ArrayKey): ReadonlyArray<Point> {
  return key === "vertices" ? (path.vertices ?? []) : tangentsOf(path, key);
}

function samePoint(observed: Reading, expected: Point): boolean {
  const list = listOf(observed);
  return list?.length === 2 && sameNumber(list[0], expected[0]) && sameNumber(list[1], expected[1]);
}

function pointsMatch(observed: Reading, expected: ReadonlyArray<Point>): boolean {
  const list = listOf(observed);
  return list !== undefined && list.length === expected.length && expected.every((entry, index) => samePoint(list[index], entry));
}

/** The host's weighted per-point sum, recomputed from the request, with the tolerance each coordinate is allowed. */
export function pathExpectation(paths: ReadonlyArray<ShapePath>): PathExpectation {
  let expectation: PathExpectation = { points: 0, closedPaths: 0, sum: 0, budget: 0 };
  for (const path of paths) {
    const vertices = path.vertices ?? [];
    const ins = tangentsOf(path, "inTangents");
    const outs = tangentsOf(path, "outTangents");
    let { sum, budget } = expectation;
    vertices.forEach((vertex, index) => {
      const values = [...vertex, ...(ins[index] ?? ORIGIN), ...(outs[index] ?? ORIGIN)];
      values.forEach((value, slot) => {
        sum += (DIGEST_WEIGHTS[slot] ?? 0) * value;
        budget += (DIGEST_WEIGHTS[slot] ?? 0) * readbackTolerance(value);
      });
    });
    expectation = { points: expectation.points + vertices.length, closedPaths: expectation.closedPaths + (path.closed ? 1 : 0), sum, budget };
  }
  return expectation;
}

function wholeMismatch(read: Infer<typeof readPath>, path: ShapePath): string | null {
  const wrong = ARRAY_KEYS.find((key) => !pointsMatch(read[key], requestedArray(path, key)));
  return wrong ?? null;
}

function edgeMismatch(read: Infer<typeof readPath>, path: ShapePath, count: number): string | null {
  const head = objectOf(read.head);
  const tail = objectOf(read.tail);
  const edge = Math.min(PATH_EDGE, count);
  const wrong = ARRAY_KEYS.find((key) => {
    const expected = requestedArray(path, key);
    return !head || !pointsMatch(head[key], expected.slice(0, edge)) || !tail || !pointsMatch(tail[key], expected.slice(count - edge));
  });
  return wrong ?? null;
}

function summaryMismatch(read: Infer<typeof readPath>, path: ShapePath): string | null {
  const count = (path.vertices ?? []).length;
  if (read.count !== count) return "count";
  const edge = edgeMismatch(read, path, count);
  if (edge) return edge;
  const expectation = pathExpectation([path]);
  return read.digest !== undefined && Math.abs(read.digest - expectation.sum) <= expectation.budget ? null : "digest";
}

/** The first field where a bounded host path read differs from the requested path (every vertex, both tangent arrays and `closed`, or a long path's count, digest and ends), or null when it matches. */
export function pathMismatchField(observed: Reading, path: ShapePath): string | null {
  const decoded = decode(readPath, observed);
  if (!decoded.ok) return "path";
  const read = decoded.value;
  if (read.closed !== path.closed) return "closed";
  return listOf(read.vertices) ? wholeMismatch(read, path) : summaryMismatch(read, path);
}

/** Whether any segment of the path is curved. */
export function hasCurve(path: ShapePath): boolean {
  return [...tangentsOf(path, "inTangents"), ...tangentsOf(path, "outTangents")].some((tangent) => tangent[0] !== 0 || tangent[1] !== 0);
}
