// SVG affine transforms: [a, b, c, d, e, f] maps (x, y) to (a*x + c*y + e, b*x + d*y + f).

/** A 2D affine transform as the six SVG matrix numbers. */
export type Matrix = readonly [number, number, number, number, number, number];
/** A point or offset in two dimensions. */
export type Point = [number, number];

/** The transform that moves nothing. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** left times right: right applies first, then left. */
export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left, [a2, b2, c2, d2, e2, f2] = right;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

/** Where the matrix sends the point. */
export function applyPoint(matrix: Matrix, point: readonly [number, number]): Point {
  const [a, b, c, d, e, f] = matrix;
  return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f];
}

/** Where the matrix sends an offset: only the linear part applies, which is what a tangent needs. */
export function applyVector(matrix: Matrix, vector: readonly [number, number]): Point {
  const [a, b, c, d] = matrix;
  return [a * vector[0] + c * vector[1], b * vector[0] + d * vector[1]];
}

/** The uniform scale a stroke width takes through this transform. */
export function strokeScale(matrix: Matrix): number {
  const [a, b, c, d] = matrix;
  return Math.sqrt(Math.abs(a * d - b * c));
}

/** A shift by x and y. */
export function translation(x: number, y: number): Matrix { return [1, 0, 0, 1, x, y]; }
function scaling(x: number, y = x): Matrix { return [x, 0, 0, y, 0, 0]; }

function rotation(degrees: number, cx = 0, cy = 0): Matrix {
  const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return multiply(translation(cx, cy), multiply([cos, sin, -sin, cos, 0, 0], translation(-cx, -cy)));
}

function skew(degreesX: number, degreesY: number): Matrix {
  return [1, Math.tan(degreesY * Math.PI / 180), Math.tan(degreesX * Math.PI / 180), 1, 0, 0];
}

/** Every number written in the text, in order. */
export function numbersIn(text: string): number[] {
  return (text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu) ?? []).map(Number).filter(Number.isFinite);
}

const TRANSFORMS: Readonly<Record<string, (values: number[]) => Matrix | undefined>> = {
  matrix: (values) => {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = values;
    return values.length === 6 ? [a, b, c, d, e, f] : undefined;
  },
  translate: ([x = 0, y = 0]) => translation(x, y),
  scale: ([x = 1, y]) => scaling(x, y ?? x),
  rotate: ([degrees = 0, cx = 0, cy = 0]) => rotation(degrees, cx, cy),
  skewx: ([degrees = 0]) => skew(degrees, 0),
  skewy: ([degrees = 0]) => skew(0, degrees),
};

function oneTransform(kind: string, values: number[]): Matrix | undefined {
  return TRANSFORMS[kind]?.(values);
}

/** A transform list, left to right; anything unreadable is left out rather than guessed. */
export function parseTransform(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  let result: Matrix = IDENTITY;
  for (const match of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/gu)) {
    const next = oneTransform((match[1] ?? "").toLowerCase(), numbersIn(match[2] ?? ""));
    if (next) result = multiply(result, next);
  }
  return result;
}
