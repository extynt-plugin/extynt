/** Tolerant number, colour and path comparison for shape state read back from the host; the base of host-shape-readback. */
import { isFiniteNumber, type JsonValue } from "@extynt/decode";
import { fieldOf, isRecord, type Found } from "./json-narrow.js";

type ShapePoint = readonly [number, number];

export interface ShapePath {
  readonly vertices: ReadonlyArray<ShapePoint>;
  readonly inTangents: ReadonlyArray<ShapePoint>;
  readonly outTangents: ReadonlyArray<ShapePoint>;
  readonly closed: boolean | undefined;
}

interface VectorExpectation {
  readonly points: number;
  readonly closedPaths: number;
  readonly sum: number;
  readonly budget: number;
}

const ORIGIN: ShapePoint = [0, 0];
const PATH_EDGE = 8;
const DIGEST_WEIGHTS = [1, 2, 3, 5, 7, 11] as const;
const PATH_KEYS = ["vertices", "inTangents", "outTangents"] as const;
const COLOR_TOLERANCE = 0.00001;

function tolerance(expected: number): number {
  return Math.max(0.0005, Math.abs(expected) * 0.00001);
}

/** The array at a JSON value, or null when it is anything else. */
export function listOf(value: Found): ReadonlyArray<JsonValue> | null {
  return Array.isArray(value) ? value : null;
}

/** Per-coordinate match: within 0.0005, or 10 ppm of the expected value, whichever is larger. */
export function numberMatches(observed: Found, expected: Found): boolean {
  return isFiniteNumber(observed) && isFiniteNumber(expected) && Math.abs(observed - expected) <= tolerance(expected);
}

function channelMatches(observed: Found, expected: Found): boolean {
  return isFiniteNumber(observed) && isFiniteNumber(expected) && Math.abs(observed - expected) <= COLOR_TOLERANCE;
}

/** An observed colour carries at least the three expected channels, each within 1e-5. */
export function rgbMatches(observed: Found, expected: Found): boolean {
  const seen = listOf(observed);
  const wanted = listOf(expected);
  if (!seen || !wanted || seen.length < 3 || wanted.length !== 3) return false;
  return wanted.every((channel, index) => channelMatches(seen[index], channel));
}

function pointMatches(observed: Found, expected: ShapePoint): boolean {
  const coordinates = listOf(observed);
  if (!coordinates || coordinates.length !== 2) return false;
  return numberMatches(coordinates[0], expected[0]) && numberMatches(coordinates[1], expected[1]);
}

function pointsMatch(observed: Found, expected: ReadonlyArray<ShapePoint>): boolean {
  const points = listOf(observed);
  if (!points || points.length !== expected.length) return false;
  return expected.every((point, index) => pointMatches(points[index], point));
}

/** Every entry read, or null as soon as one cannot be. */
export function readAll<T>(entries: ReadonlyArray<Found>, read: (entry: Found) => T | null): T[] | null {
  const collected: T[] = [];
  for (const entry of entries) {
    const one = read(entry);
    if (one === null) return null;
    collected.push(one);
  }
  return collected;
}

function pointOf(entry: Found): ShapePoint | null {
  const coordinates = listOf(entry);
  const x = coordinates?.[0];
  const y = coordinates?.[1];
  return coordinates?.length === 2 && typeof x === "number" && typeof y === "number" ? [x, y] : null;
}

function pointListOf(entry: Found): ShapePoint[] | null {
  const entries = listOf(entry);
  return entries ? readAll(entries, pointOf) : null;
}

/** A requested path: vertices required, tangents defaulting to zero as the host writes them. */
export function readPath(entry: Found): ShapePath | null {
  const vertices = pointListOf(fieldOf(entry, "vertices"));
  if (!vertices) return null;
  const closed = fieldOf(entry, "closed");
  return {
    vertices,
    inTangents: pointListOf(fieldOf(entry, "inTangents")) ?? vertices.map(() => ORIGIN),
    outTangents: pointListOf(fieldOf(entry, "outTangents")) ?? vertices.map(() => ORIGIN),
    closed: typeof closed === "boolean" ? closed : undefined,
  };
}

function digestTerms(path: ShapePath): Array<{ sum: number; budget: number }> {
  return path.vertices.flatMap((vertex, index) => {
    const coordinates = [...vertex, ...(path.inTangents[index] ?? ORIGIN), ...(path.outTangents[index] ?? ORIGIN)];
    return coordinates.map((coordinate, slot) => {
      const weight = DIGEST_WEIGHTS[slot] ?? 0;
      return { sum: weight * coordinate, budget: weight * tolerance(coordinate) };
    });
  });
}

/** The host's weighted per-point sum recomputed from the request, with the tolerance each coordinate is allowed. */
export function vectorExpectation(paths: ReadonlyArray<ShapePath>): VectorExpectation {
  const terms = paths.flatMap(digestTerms);
  return {
    points: paths.reduce((total, path) => total + path.vertices.length, 0),
    closedPaths: paths.filter((path) => path.closed).length,
    sum: terms.reduce((total, term) => total + term.sum, 0),
    budget: terms.reduce((total, term) => total + term.budget, 0),
  };
}

function wholePathMismatch(read: Found, path: ShapePath): string | null {
  return PATH_KEYS.find((key) => !pointsMatch(fieldOf(read, key), path[key])) ?? null;
}

function edgeMismatch(read: Found, path: ShapePath, count: number): string | null {
  const head = fieldOf(read, "head");
  const tail = fieldOf(read, "tail");
  const edge = Math.min(PATH_EDGE, count);
  return PATH_KEYS.find((key) => {
    const headMatches = pointsMatch(fieldOf(head, key), path[key].slice(0, edge));
    return !headMatches || !pointsMatch(fieldOf(tail, key), path[key].slice(count - edge));
  }) ?? null;
}

function summaryPathMismatch(read: Found, path: ShapePath): string | null {
  const count = path.vertices.length;
  if (fieldOf(read, "count") !== count) return "count";
  const edge = edgeMismatch(read, path, count);
  if (edge) return edge;
  const expected = vectorExpectation([path]);
  const digest = fieldOf(read, "digest");
  return isFiniteNumber(digest) && Math.abs(digest - expected.sum) <= expected.budget ? null : "digest";
}

/**
 * The first field where a bounded host path read differs from the requested path, or null when every vertex, both
 * tangent arrays and `closed` match. A path past the host's whole-read limit arrives as its count, weighted digest and
 * first and last points; those are compared instead.
 */
export function pathMismatchField(observed: Found, path: ShapePath): string | null {
  if (!isRecord(observed)) return "path";
  if (fieldOf(observed, "closed") !== path.closed) return "closed";
  return Array.isArray(fieldOf(observed, "vertices")) ? wholePathMismatch(observed, path) : summaryPathMismatch(observed, path);
}
