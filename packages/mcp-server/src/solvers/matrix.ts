// Affine 2D matrices for layer transforms in composition space.
import type { Vec2 } from "./types.js";

/** Affine 2D matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix2D = readonly [number, number, number, number, number, number];

/** A layer's own 2D transform: anchor and position in pixels, scale in percent (100 = identity), rotation in degrees. */
export interface LayerTransform2D {
  readonly anchor: Vec2;
  readonly position: Vec2;
  readonly scale: Vec2;
  readonly rotation: number;
}

function withoutNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/** Layer space to parent space. */
export function layerMatrix(transform: LayerTransform2D): Matrix2D {
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a = cos * (transform.scale[0] / 100);
  const b = sin * (transform.scale[0] / 100);
  const c = -sin * (transform.scale[1] / 100);
  const d = cos * (transform.scale[1] / 100);
  const e = transform.position[0] - (a * transform.anchor[0] + c * transform.anchor[1]);
  const f = transform.position[1] - (b * transform.anchor[0] + d * transform.anchor[1]);
  return [withoutNegativeZero(a), withoutNegativeZero(b), withoutNegativeZero(c), withoutNegativeZero(d), withoutNegativeZero(e), withoutNegativeZero(f)];
}

/** The matrix that applies `child` first, then `parent`. */
export function multiplyMatrix(parent: Matrix2D, child: Matrix2D): Matrix2D {
  const [pa, pb, pc, pd, pe, pf] = parent;
  const [ca, cb, cc, cd, ce, cf] = child;
  return [pa * ca + pc * cb, pb * ca + pd * cb, pa * cc + pc * cd, pb * cc + pd * cd, pa * ce + pc * cf + pe, pb * ce + pd * cf + pf];
}

/** The point after the matrix is applied. */
export function applyMatrix(matrix: Matrix2D, point: Vec2): Vec2 {
  const [a, b, c, d, e, f] = matrix;
  return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f];
}
