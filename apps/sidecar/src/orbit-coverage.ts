// What "orbit" must show in the project: a layer that travels around something, not one that spins in place; sits under coverage-features.
import type { LayerSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { isJsonArray, type JsonValue } from "@extynt/decode";
import { expressionsOf, layersOf, propertiesOf, type Evidence } from "./coverage-evidence.js";
import type { AppliedFact, Point } from "./request-applied.js";

const MIN_SWEEP = 180;
const MIN_RADIUS = 40;
const LINE_TOLERANCE = 1;
const MIN_PATH_KEYS = 3;
const POSITION = /(^|\/)ADBE Position$/;
const ANY_POSITION = /(^|\/)ADBE Position(_[01])?$/;
const POSITION_AXIS = /(^|\/)ADBE Position_([01])$/;
const ROTATION = /(^|\/)ADBE Rotate Z$/;
const ANCHOR = /(^|\/)ADBE Anchor Point$/;
const TRIG = /\b(Math\.)?(sin|cos)\s*\(/;
const USES_TIME = /\btime\b/;

type Value = JsonValue | null | undefined;

const isNumber = (value: Value): value is number => typeof value === "number" && Number.isFinite(value);

function pointOf(value: Value): Point | null {
  if (!isJsonArray(value)) return null;
  const [x, y] = value;
  return isNumber(x) && isNumber(y) ? [x, y] : null;
}

const find = (layer: LayerSnapshot, path: RegExp): PropertySnapshot | undefined => propertiesOf(layer).find((property) => path.test(property.path));
const keyValues = (property: PropertySnapshot | undefined): JsonValue[] => (property?.keyframes ?? []).map((key) => key.value);

function curves(points: readonly Point[]): boolean {
  const first = points[0];
  const second = points.find((point) => first !== undefined && (point[0] !== first[0] || point[1] !== first[1]));
  if (!first || !second) return false;
  const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
  return points.some((point) => Math.abs((second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0])) / length > LINE_TOLERANCE);
}

function zipAxes(layer: LayerSnapshot): Point[] {
  const axes = propertiesOf(layer).filter((property) => POSITION_AXIS.test(property.path)).sort((a, b) => a.path.localeCompare(b.path));
  const [x, y] = axes.map((axis) => keyValues(axis).filter(isNumber));
  if (!x || !y) return [];
  return x.slice(0, y.length).flatMap((value, index) => { const other = y[index]; return other === undefined ? [] : [[value, other] as const]; });
}

function positionKeys(layer: LayerSnapshot): Point[] {
  const combined = keyValues(find(layer, POSITION)).map(pointOf).filter((point): point is Point => point !== null);
  return combined.length > 0 ? combined : zipAxes(layer);
}

const expressionOf = (layer: LayerSnapshot, path: RegExp): string => expressionsOf(layer).filter((expression) => expression.enabled && path.test(expression.path)).map((expression) => expression.expression ?? "").join("\n");
const keyedPath = (layer: LayerSnapshot): boolean => { const keys = positionKeys(layer); return keys.length >= MIN_PATH_KEYS && curves(keys); };
const trigPath = (layer: LayerSnapshot): boolean => TRIG.test(expressionOf(layer, ANY_POSITION));

function rotatesAround(layer: LayerSnapshot): boolean {
  const values = keyValues(find(layer, ROTATION)).filter(isNumber);
  return (values.length >= 2 && Math.max(...values) - Math.min(...values) >= MIN_SWEEP) || USES_TIME.test(expressionOf(layer, ROTATION));
}

const placeOf = (property: PropertySnapshot | undefined): Point | null => pointOf(property?.value) ?? pointOf(property?.keyframes?.[0]?.value);

function hasOffsetChild(pivot: LayerSnapshot, layers: readonly LayerSnapshot[]): boolean {
  const anchor = placeOf(find(pivot, ANCHOR)) ?? [0, 0];
  return layers.some((child) => {
    const at = child.parentId === pivot.id ? placeOf(find(child, POSITION)) : null;
    return at !== null && Math.hypot(at[0] - anchor[0], at[1] - anchor[1]) >= MIN_RADIUS;
  });
}

const animatesPosition = (operation: AppliedFact): boolean => operation.type === "animate_property" && (operation.role === "transform.position" || POSITION.test(operation.propertyPath ?? ""));
const appliedPath = (applied: readonly AppliedFact[]): boolean => applied.some((operation) => animatesPosition(operation) && operation.positionKeys.length >= MIN_PATH_KEYS && curves(operation.positionKeys));

/** Whether some layer travels around something: a keyed or sin/cos Position path, a keyed-rotation pivot with a child offset from it, or an executed animate_property whose Position keys leave the straight line. */
export function orbitPresent({ snapshot, applied }: Evidence): boolean {
  const layers = layersOf(snapshot);
  return layers.some((layer) => keyedPath(layer) || trigPath(layer) || (rotatesAround(layer) && hasOffsetChild(layer, layers))) || appliedPath(applied);
}
