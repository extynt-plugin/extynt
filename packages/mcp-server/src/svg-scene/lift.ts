// Lifts a layer element's own translate * rotate * uniform scale out of the
// baked geometry and into the After Effects layer's Position, Rotation and
// Scale, so the AE layer has the same structure as the SVG group: art stays in
// the group's local frame (a vehicle's nose along +x) and its heading is the
// layer's rotation. Anything that is not such a similarity stays baked.
import { applyPoint, multiply, translation, type Matrix, type Point } from "./transform.js";

const EPSILON = 1e-6;

/** What a layer group's transform becomes: `rotation` in degrees clockwise on screen (SVG rotate and AE Rotation agree), `scale` as a uniform factor (1 is 100%), `origin` the group's local origin in composition pixels (the point the SVG rotates and scales about), and `matrix` the parent frame plus only the group's translation, where its leaves are drawn. */
export interface LayerLift {
  readonly rotation: number;
  readonly scale: number;
  readonly origin: Point;
  readonly matrix: Matrix;
}

const near = (left: number, right: number, tolerance = EPSILON): boolean => Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));

function uniformParent([a, b, c, d]: Matrix): boolean { return a > 0 && near(a, d) && Math.abs(b) <= EPSILON * a && Math.abs(c) <= EPSILON * a; }

/** The lift for `own` inside `parent`, or undefined when it is a plain translation, skewed, non-uniform, mirrored, or under a rotated/stretched ancestor. */
export function liftLayerTransform(own: Matrix, parent: Matrix): LayerLift | undefined {
  const [a, b, c, d, e, f] = own;
  const determinant = a * d - b * c, length = Math.hypot(a, b);
  if (!(determinant > EPSILON) || !uniformParent(parent)) return undefined;
  if (!near(length, Math.hypot(c, d)) || Math.abs(a * c + b * d) > EPSILON * length * length) return undefined;
  const rotation = Math.atan2(b, a) * 180 / Math.PI;
  if (near(length, 1) && Math.abs(rotation) <= EPSILON) return undefined;
  const matrix = multiply(parent, translation(e, f));
  return { rotation, scale: length, origin: applyPoint(parent, [e, f]), matrix };
}

/** Where the SVG point `anchor` (in the lifted, unrotated frame) lands on screen once the layer is rotated and scaled about its origin. */
export function liftedPosition(lift: LayerLift, anchor: Point): Point {
  const radians = lift.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = anchor[0] - lift.origin[0], dy = anchor[1] - lift.origin[1];
  return [lift.origin[0] + lift.scale * (cos * dx - sin * dy), lift.origin[1] + lift.scale * (sin * dx + cos * dy)];
}

/** The inverse: the point in the lifted frame that sits at on-screen `point`. */
export function liftedAnchorAt(lift: LayerLift, point: Point): Point {
  const radians = -lift.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = point[0] - lift.origin[0], dy = point[1] - lift.origin[1];
  return [lift.origin[0] + (cos * dx - sin * dy) / lift.scale, lift.origin[1] + (sin * dx + cos * dy) / lift.scale];
}
