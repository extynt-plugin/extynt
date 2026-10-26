// Affine transforms for the SVG converter: matrix algebra, number lists and the transform attribute.
import type { Matrix, Point } from "./svg-convert-types.js";

type Builder = (args: readonly number[]) => Matrix | undefined;

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu;
const TRANSFORM_CALL = /^([A-Za-z]+)\s*\(([^)]*)\)[\s,]*/u;
const DEGREES_TO_RADIANS = Math.PI / 180;

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The matrix that applies `inner` first and then `outer`. */
export function multiply(outer: Matrix, inner: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

export function applyMatrix(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f];
}

/** Mean linear scale of the matrix, the factor a stroke width grows by. */
export function meanScale(matrix: Matrix): number {
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

export function isUniformScale(matrix: Matrix): boolean {
  const horizontal = Math.hypot(matrix[0], matrix[1]);
  const vertical = Math.hypot(matrix[2], matrix[3]);
  return Math.abs(horizontal - vertical) <= 0.01 * Math.max(horizontal, vertical, 1e-12);
}

/** Every number in a list separated only by whitespace and commas, or undefined when anything else is in the text. */
export function parseNumbers(text: string): number[] | undefined {
  const values = [...text.matchAll(NUMBER)].map((match) => Number(match[0]));
  return /^[\s,]*$/u.test(text.replace(NUMBER, "")) && values.every(Number.isFinite) ? values : undefined;
}

function isSixNumbers(args: readonly number[]): args is Matrix {
  return args.length === 6;
}

function rotation(degrees: number): Matrix {
  const angle = degrees * DEGREES_TO_RADIANS;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, 0, 0];
}

function rotateAround(args: readonly number[]): Matrix | undefined {
  if (args.length !== 1 && args.length !== 3) return undefined;
  const [angle = 0, cx = 0, cy = 0] = args;
  return multiply(multiply([1, 0, 0, 1, cx, cy], rotation(angle)), [1, 0, 0, 1, -cx, -cy]);
}

function translate(args: readonly number[]): Matrix | undefined {
  const [x = 0, y = 0] = args;
  return args.length === 1 || args.length === 2 ? [1, 0, 0, 1, x, y] : undefined;
}

function scale(args: readonly number[]): Matrix | undefined {
  const [x = 1, y = x] = args;
  return args.length === 1 || args.length === 2 ? [x, 0, 0, y, 0, 0] : undefined;
}

function skewX(args: readonly number[]): Matrix | undefined {
  return args.length === 1 ? [1, 0, Math.tan((args[0] ?? 0) * DEGREES_TO_RADIANS), 1, 0, 0] : undefined;
}

function skewY(args: readonly number[]): Matrix | undefined {
  return args.length === 1 ? [1, Math.tan((args[0] ?? 0) * DEGREES_TO_RADIANS), 0, 1, 0, 0] : undefined;
}

const BUILDERS: ReadonlyMap<string, Builder> = new Map<string, Builder>([
  ["matrix", (args) => (isSixNumbers(args) ? args : undefined)],
  ["translate", translate],
  ["scale", scale],
  ["rotate", rotateAround],
  ["skewx", skewX],
  ["skewy", skewY],
]);

function nextTransform(rest: string): { matrix: Matrix; length: number } | undefined {
  const match = TRANSFORM_CALL.exec(rest);
  if (!match) return undefined;
  const build = BUILDERS.get((match[1] ?? "").toLowerCase());
  const args = parseNumbers(match[2] ?? "");
  const matrix = build && args ? build(args) : undefined;
  return matrix && matrix.every(Number.isFinite) ? { matrix, length: match[0].length } : undefined;
}

/** A transform attribute composed left to right, or undefined when any function is unknown or malformed. */
export function parseTransform(text: string): Matrix | undefined {
  let result: Matrix = IDENTITY;
  let rest = text.trim();
  while (rest) {
    const next = nextTransform(rest);
    if (!next) return undefined;
    result = multiply(result, next.matrix);
    rest = rest.slice(next.length);
  }
  return result;
}
