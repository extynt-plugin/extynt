// Reads a layer's 2D transform out of a snapshot, noting which components are missing, animated or 3D.
import { findProperty } from "@extynt/project-graph";
import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { isFiniteNumber, isJsonArray } from "@extynt/decode";
import type { JsonValue } from "@extynt/decode";
import type { Vec2 } from "./types.js";

/** What reading one transform component revealed beyond its value. */
export interface ComponentFlags {
  readonly defaulted: boolean;
  readonly animated: boolean;
  readonly has3d: boolean;
}

interface VectorComponent extends ComponentFlags {
  readonly value: Vec2;
}

interface RotationComponent extends ComponentFlags {
  readonly value: number;
}

/** All four 2D transform components of a layer. */
export interface TransformRead {
  readonly anchor: VectorComponent;
  readonly position: VectorComponent;
  readonly scale: VectorComponent;
  readonly rotation: RotationComponent;
}

type VectorName = "anchor" | "position" | "scale";

const TRANSFORM_PATH = "ADBE Transform Group";
const VECTOR_PATHS: Readonly<Record<VectorName, string>> = {
  anchor: `${TRANSFORM_PATH}/ADBE Anchor Point`,
  position: `${TRANSFORM_PATH}/ADBE Position`,
  scale: `${TRANSFORM_PATH}/ADBE Scale`,
};
const VECTOR_DEFAULTS: Readonly<Record<VectorName, Vec2>> = { anchor: [0, 0], position: [0, 0], scale: [100, 100] };
const IDENTITY_DEPTH: Readonly<Record<VectorName, number>> = { anchor: 0, position: 0, scale: 100 };
const ROTATION_PATH = `${TRANSFORM_PATH}/ADBE Rotate Z`;

type PropertyValue = JsonValue | undefined;

function finiteNumber(value: PropertyValue): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function pairOf(value: PropertyValue): Vec2 | undefined {
  if (!isJsonArray(value)) return undefined;
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

function valueAt(layer: LayerSnapshot, path: string): PropertyValue {
  return findProperty(layer, { path })?.value;
}

function isAnimated(property: PropertySnapshot | undefined): boolean {
  if (!property) return false;
  return (property.keyframeCount ?? 0) > 0 || property.expressionEnabled === true || (property.keyframes ?? []).length > 0;
}

function hasOffIdentityDepth(value: PropertyValue, identity: number): boolean {
  if (!isJsonArray(value) || value.length <= 2) return false;
  const depth = finiteNumber(value[2]);
  return depth !== undefined && depth !== identity;
}

function hasThreeDRotation(layer: LayerSnapshot): boolean {
  const turned = ["ADBE Rotate X", "ADBE Rotate Y"].some((name) => {
    const angle = finiteNumber(valueAt(layer, `${TRANSFORM_PATH}/${name}`));
    return angle !== undefined && angle !== 0;
  });
  const orientation = valueAt(layer, `${TRANSFORM_PATH}/ADBE Orientation`);
  return turned || (isJsonArray(orientation) && orientation.some((entry) => finiteNumber(entry) !== undefined && entry !== 0));
}

interface PositionSource {
  readonly property: PropertySnapshot | undefined;
  readonly raw: PropertyValue;
}

function separatedPosition(layer: LayerSnapshot): PositionSource | undefined {
  const x = findProperty(layer, { path: `${TRANSFORM_PATH}/ADBE Position_0` });
  const y = findProperty(layer, { path: `${TRANSFORM_PATH}/ADBE Position_1` });
  if (typeof x?.value !== "number" || typeof y?.value !== "number") return undefined;
  return { property: x, raw: [x.value, y.value] };
}

function sourceOf(layer: LayerSnapshot, name: VectorName): PositionSource {
  const property = findProperty(layer, { path: VECTOR_PATHS[name] });
  const direct = { property, raw: property?.value };
  if (name !== "position" || pairOf(direct.raw) !== undefined) return direct;
  return separatedPosition(layer) ?? direct;
}

function readVector(layer: LayerSnapshot, name: VectorName): VectorComponent {
  const { property, raw } = sourceOf(layer, name);
  const pair = pairOf(raw);
  return { value: pair ?? VECTOR_DEFAULTS[name], defaulted: pair === undefined, animated: isAnimated(property), has3d: hasOffIdentityDepth(raw, IDENTITY_DEPTH[name]) };
}

function readRotation(layer: LayerSnapshot): RotationComponent {
  const property = findProperty(layer, { path: ROTATION_PATH });
  const angle = finiteNumber(property?.value);
  return { value: angle ?? 0, defaulted: angle === undefined, animated: isAnimated(property), has3d: hasThreeDRotation(layer) };
}

/** The layer's anchor, position, scale and rotation, with defaults substituted for anything missing or invalid. */
export function readLayerTransform(layer: LayerSnapshot): TransformRead {
  return { anchor: readVector(layer, "anchor"), position: readVector(layer, "position"), scale: readVector(layer, "scale"), rotation: readRotation(layer) };
}
