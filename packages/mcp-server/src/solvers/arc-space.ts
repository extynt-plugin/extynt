// Carries an arc solved in composition pixels into a layer's parent space, so its keys are right for a parented layer.
import { applyLinear, applyMatrix, invertMatrix } from "./matrix.js";
import type { Matrix2D } from "./matrix.js";
import type { ArcPathResult } from "./path.js";
import { round3 } from "./types.js";
import type { SolvedKeyframe, Vec2 } from "./types.js";

/** The arc's keys in parent space, with the caveats that apply to them. */
export interface ArcInParentSpace {
  readonly result: ArcPathResult;
  readonly caveats: ReadonlyArray<string>;
}

const DEGREES_PER_RADIAN = 180 / Math.PI;
const NEAR = 1e-9;
const NOT_INVERTIBLE = "A parent's scale is zero, so its space cannot be solved into; the keys are left in composition pixels.";
const UNEVEN_PARENT = "A parent's scale is not uniform, so the path is exact but its on-screen speed varies a little along it.";

function rounded(point: Vec2): Vec2 {
  return [round3(point[0]), round3(point[1])];
}

function normalizeAngle(angle: number): number {
  const wrapped = angle % 360;
  if (wrapped > 180) return wrapped - 360;
  return wrapped <= -180 ? wrapped + 360 : wrapped;
}

function headingOf(vector: Vec2): number {
  return Math.atan2(vector[1], vector[0]) * DEGREES_PER_RADIAN;
}

function isIdentity(matrix: Matrix2D): boolean {
  const [a, b, c, d, e, f] = matrix;
  return [a - 1, b, c, d - 1, e, f].every((value) => Math.abs(value) < NEAR);
}

function keepsShape(matrix: Matrix2D): boolean {
  const [a, b, c, d] = matrix;
  const rotates = Math.abs(a - d) < NEAR && Math.abs(b + c) < NEAR;
  const mirrors = Math.abs(a + d) < NEAR && Math.abs(b - c) < NEAR;
  return rotates || mirrors;
}

function scaledEase(keyframe: SolvedKeyframe, factor: number): Pick<SolvedKeyframe, "ease"> {
  if (!keyframe.ease) return {};
  const scaled = (side: { readonly speed: number; readonly influence: number }): typeof side => ({ ...side, speed: round3(side.speed * factor) });
  return { ease: { in: scaled(keyframe.ease.in), out: scaled(keyframe.ease.out) } };
}

function lengthOf(vector: Vec2): number {
  return Math.hypot(vector[0], vector[1]);
}

function mappedKeyframe(fromComp: Matrix2D, keyframe: SolvedKeyframe): SolvedKeyframe {
  if (typeof keyframe.value === "number" || !keyframe.spatial) return keyframe;
  const { inTangent, outTangent } = keyframe.spatial;
  const spatial = { ...keyframe.spatial, inTangent: rounded(applyLinear(fromComp, inTangent)), outTangent: rounded(applyLinear(fromComp, outTangent)) };
  const direction = travelDirection(keyframe);
  const stretch = lengthOf(direction) > 0 ? lengthOf(applyLinear(fromComp, direction)) / lengthOf(direction) : 1;
  return { ...keyframe, value: rounded(applyMatrix(fromComp, keyframe.value)), spatial, ...scaledEase(keyframe, stretch) };
}

function travelDirection(keyframe: SolvedKeyframe | undefined): Vec2 {
  const spatial = keyframe?.spatial;
  if (!spatial) return [1, 0];
  const [x, y] = spatial.outTangent;
  return x !== 0 || y !== 0 ? spatial.outTangent : [-spatial.inTangent[0], -spatial.inTangent[1]];
}

function parentRotations(fromComp: Matrix2D, position: ReadonlyArray<SolvedKeyframe>, rotation: ReadonlyArray<SolvedKeyframe>): ReadonlyArray<number> {
  const values: number[] = [];
  rotation.forEach((keyframe, index) => {
    const direction = travelDirection(position[index]);
    const offset = normalizeAngle(headingOf(applyLinear(fromComp, direction)) - headingOf(direction));
    const raw = (typeof keyframe.value === "number" ? keyframe.value : 0) + offset;
    const previous = values[index - 1];
    values.push(previous === undefined ? raw : previous + normalizeAngle(raw - previous));
  });
  return values;
}

function mappedRotation(fromComp: Matrix2D, result: ArcPathResult): Pick<ArcPathResult, "rotation"> {
  if (!result.rotation) return {};
  const values = parentRotations(fromComp, result.position.keyframes, result.rotation.keyframes);
  const [a, b, c, d] = fromComp;
  const turning = Math.sign(a * d - b * c);
  const keyframes = result.rotation.keyframes.map((keyframe, index) => ({ ...keyframe, value: round3(values[index] ?? 0), ...scaledEase(keyframe, turning) }));
  return { rotation: { ...result.rotation, keyframes } };
}

/**
 * The arc's Position (and Rotation) keys carried from composition pixels into the parent space whose `toComp` matrix is given. Bézier paths map
 * exactly under an affine matrix, so the path is unchanged on screen; Rotation follows the mapped direction of travel, so mirrored parents work too.
 * The measured fields (radius, angles, endPoint, arcLength) stay in composition pixels.
 */
export function arcInParentSpace(result: ArcPathResult, toComp: Matrix2D): ArcInParentSpace {
  if (isIdentity(toComp)) return { result, caveats: [] };
  const fromComp = invertMatrix(toComp);
  if (!fromComp) return { result, caveats: [NOT_INVERTIBLE] };
  const position = { ...result.position, keyframes: result.position.keyframes.map((keyframe) => mappedKeyframe(fromComp, keyframe)) };
  return { result: { ...result, position, ...mappedRotation(fromComp, result) }, caveats: keepsShape(toComp) ? [] : [UNEVEN_PARENT] };
}
