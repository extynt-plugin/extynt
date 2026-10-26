/** The draw_vector_shapes operation: a whole artwork of grouped paths with fills and strokes, drawn into a shape layer in one step. */

import { isWireArray, isWireObject } from "@extynt/fake-plugin";
import type { PropertySnapshot } from "@extynt/project-graph";
import type { JsonValue } from "@extynt/decode";
import { resolveLayer, type ApplyOutcome, type FixtureApplyContext } from "./fake-host-context.js";
import { childSegment, childrenOf, findChild, group, leaf } from "./fake-host-model.js";
import { pointsOf, requireShapePath, shapePathMessage, type ShapePath } from "./fake-host-shape-path.js";
import { shapeRootOf } from "./fake-host-shapes.js";
import { V, VECTOR_CONTENTS, VECTOR_GROUP } from "./fake-host-tables.js";
import { boundedNumber, escapeSegment, isFiniteNumber, isJsonObject, optionalBounded, optionalObject, own, refuse, required, textOf, tuple3, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

const FILL_RULES: Readonly<Record<string, number>> = { nonzero: 1, evenodd: 2 };
const LINE_CAPS: Readonly<Record<string, number>> = { butt: 1, round: 2, square: 3 };
const LINE_JOINS: Readonly<Record<string, number>> = { miter: 1, round: 2, bevel: 3 };

const MAX_VECTOR_SHAPES = 256;
const MAX_VECTOR_PATHS = 64;
const MAX_VECTOR_POINTS = 12000;

const PERCENT = { min: 0, max: 100 };

const FILL_MEMBERS: Readonly<Record<string, string>> = { color: `${V} Fill Color`, opacity: `${V} Fill Opacity`, rule: `${V} Fill Rule` };

const STROKE_MEMBERS: Readonly<Record<string, string>> = { color: `${V} Stroke Color`, width: `${V} Stroke Width`, opacity: `${V} Stroke Opacity`, cap: `${V} Stroke Line Cap`, join: `${V} Stroke Line Join`, miterLimit: `${V} Stroke Miter Limit` };

const POINT_WEIGHTS = { vertex: [1, 2], into: [3, 5], out: [7, 11] } as const;

interface VectorPaint { color: [number, number, number]; opacity?: number; width?: number; rule?: number; cap?: number; join?: number; miterLimit?: number }

interface VectorShapeSpec { name: string; paths: ShapePath[]; fill?: VectorPaint; stroke?: VectorPaint; opacity?: number }

interface PaintLeaf { matchName: string; displayName: string; valueType: PropertySnapshot["valueType"]; value: JsonValue | undefined }

function menuIndexOf(value: Field, names: Readonly<Record<string, number>>, field: string): number | undefined {
  if (value === undefined) return undefined;
  const named = typeof value === "string" ? own(names, value) : undefined;
  if (named !== undefined) return named;
  const max = Object.keys(names).length;
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1 || value > max) refuse("INVALID_VALUE", `${field} must be one of ${Object.keys(names).join(", ")} or a menu index from 1 to ${max}.`);
  return value;
}

function colorInUnitRange(value: Field, field: string): [number, number, number] {
  const color = tuple3(value, field);
  if (color.some((channel) => channel < 0 || channel > 1)) refuse("INVALID_VALUE", `${field} channels must be from 0 to 1.`);
  return color;
}

function onlyKeys(value: WireObject, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) refuse("INVALID_VALUE", `${label} has no "${unknown}"; it sets ${allowed.join(", ")}.`);
}

function vectorFillOf(value: Field, label: string): VectorPaint | undefined {
  const fill = optionalObject(value, `${label} must be an object.`);
  if (!fill) return undefined;
  onlyKeys(fill, ["color", "opacity", "rule"], label);
  const opacity = optionalBounded(fill.opacity, `${label} opacity`, PERCENT), rule = menuIndexOf(fill.rule, FILL_RULES, `${label} rule`);
  return { color: colorInUnitRange(fill.color, `${label} color`), ...(opacity === undefined ? {} : { opacity }), ...(rule === undefined ? {} : { rule }) };
}

function vectorStrokeOf(value: Field, label: string): VectorPaint | undefined {
  const stroke = optionalObject(value, `${label} must be an object.`);
  if (!stroke) return undefined;
  onlyKeys(stroke, ["color", "width", "opacity", "cap", "join", "miterLimit"], label);
  const width = boundedNumber(stroke.width, `${label} width`, { min: 0, max: 10000 });
  if (width <= 0) refuse("INVALID_VALUE", `${label} width must be greater than 0.`);
  const opacity = optionalBounded(stroke.opacity, `${label} opacity`, PERCENT), cap = menuIndexOf(stroke.cap, LINE_CAPS, `${label} cap`);
  const join = menuIndexOf(stroke.join, LINE_JOINS, `${label} join`), miterLimit = optionalBounded(stroke.miterLimit, `${label} miterLimit`, { min: 1, max: 100 });
  return {
    color: colorInUnitRange(stroke.color, `${label} color`),
    width,
    ...(opacity === undefined ? {} : { opacity }),
    ...(cap === undefined ? {} : { cap }),
    ...(join === undefined ? {} : { join }),
    ...(miterLimit === undefined ? {} : { miterLimit }),
  };
}

function vectorPaintOf(value: WireObject, label: string): { fill?: VectorPaint; stroke?: VectorPaint } {
  if (value.fill === undefined && value.stroke === undefined) refuse("INVALID_VALUE", `${label} needs a fill, a stroke, or both.`);
  const fill = vectorFillOf(value.fill, `${label} fill`), stroke = vectorStrokeOf(value.stroke, `${label} stroke`);
  return { ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
}

function vectorShapeOf(value: Field, index: number): VectorShapeSpec {
  const label = `draw_vector_shapes shape ${index}`;
  if (!isWireObject(value)) refuse("INVALID_VALUE", `${label} must be an object.`);
  onlyKeys(value, ["name", "paths", "fill", "stroke", "opacity"], label);
  const name = textOf(value.name, `${label} name`, { min: 1, max: 256 });
  const paths = value.paths;
  if (!isWireArray(paths) || paths.length < 1 || paths.length > MAX_VECTOR_PATHS) refuse("INVALID_VALUE", `${label} needs 1-${MAX_VECTOR_PATHS} paths.`);
  const paint = vectorPaintOf(value, label), opacity = optionalBounded(value.opacity, `${label} opacity`, PERCENT);
  return { name, paths: paths.map((path) => requireShapePath(path, shapePathMessage("A shape path"))), ...paint, ...(opacity === undefined ? {} : { opacity }) };
}

function vectorShapesOf(value: Field): VectorShapeSpec[] {
  if (!isWireArray(value) || value.length < 1 || value.length > MAX_VECTOR_SHAPES) refuse("INVALID_VALUE", `draw_vector_shapes requires 1-${MAX_VECTOR_SHAPES} shapes.`);
  const shapes = value.map(vectorShapeOf);
  const points = shapes.reduce((total, shape) => total + shape.paths.reduce((sum, path) => sum + path.vertices.length, 0), 0);
  if (points > MAX_VECTOR_POINTS) refuse("INVALID_VALUE", `draw_vector_shapes may draw at most ${MAX_VECTOR_POINTS} path points in one step.`);
  return shapes;
}

function addPaintItem(contents: PropertySnapshot, identity: { matchName: string; displayName: string }, leaves: readonly PaintLeaf[]): void {
  const item = group(`${contents.path}/${childSegment(contents, identity.matchName)}`, identity.matchName, identity.displayName);
  childrenOf(contents).push(item);
  for (const { matchName, displayName, valueType, value } of leaves) {
    childrenOf(item).push(leaf({ path: `${item.path}/${escapeSegment(matchName)}`, matchName, displayName, valueType, value: value ?? null }));
  }
}

function strokeLeaves(stroke: VectorPaint): PaintLeaf[] {
  return [
    { matchName: `${V} Stroke Color`, displayName: "Color", valueType: "color", value: stroke.color },
    { matchName: `${V} Stroke Width`, displayName: "Stroke Width", valueType: "number", value: stroke.width },
    { matchName: `${V} Stroke Opacity`, displayName: "Opacity", valueType: "number", value: stroke.opacity },
    { matchName: `${V} Stroke Line Cap`, displayName: "Line Cap", valueType: "number", value: stroke.cap },
    { matchName: `${V} Stroke Line Join`, displayName: "Line Join", valueType: "number", value: stroke.join },
    { matchName: `${V} Stroke Miter Limit`, displayName: "Miter Limit", valueType: "number", value: stroke.miterLimit },
  ];
}

function fillLeaves(fill: VectorPaint): PaintLeaf[] {
  return [
    { matchName: `${V} Fill Color`, displayName: "Color", valueType: "color", value: fill.color },
    { matchName: `${V} Fill Opacity`, displayName: "Opacity", valueType: "number", value: fill.opacity },
    { matchName: `${V} Fill Rule`, displayName: "Fill Rule", valueType: "number", value: fill.rule },
  ];
}

function addShapePath(contents: PropertySnapshot, path: ShapePath): void {
  const pathGroup = group(`${contents.path}/${childSegment(contents, `${V} Shape - Group`)}`, `${V} Shape - Group`, "Path");
  childrenOf(contents).push(pathGroup);
  childrenOf(pathGroup).push(leaf({ path: `${pathGroup.path}/${V} Shape`, matchName: `${V} Shape`, displayName: "Path", valueType: "unknown", value: path }));
}

function drawVectorGroup(root: PropertySnapshot, shape: VectorShapeSpec): void {
  const created = group(`${root.path}/${childSegment(root, VECTOR_GROUP)}`, VECTOR_GROUP, shape.name);
  childrenOf(root).push(created);
  const contents = group(`${created.path}/${VECTOR_CONTENTS}`, VECTOR_CONTENTS, "Contents");
  const transform = group(`${created.path}/${V} Transform Group`, `${V} Transform Group`, "Transform");
  childrenOf(transform).push(leaf({ path: `${transform.path}/${V} Group Opacity`, matchName: `${V} Group Opacity`, displayName: "Opacity", valueType: "number", value: shape.opacity ?? 100 }));
  childrenOf(created).push(contents, transform);
  for (const path of shape.paths) addShapePath(contents, path);
  if (shape.stroke) addPaintItem(contents, { matchName: `${V} Graphic - Stroke`, displayName: "Stroke" }, strokeLeaves(shape.stroke));
  if (shape.fill) addPaintItem(contents, { matchName: `${V} Graphic - Fill`, displayName: "Fill" }, fillLeaves(shape.fill));
}

function valueAt(node: PropertySnapshot, matchName: string): JsonValue {
  return findChild(node, matchName)?.value ?? null;
}

function paintReadback(contents: PropertySnapshot | undefined, matchName: string, members: Readonly<Record<string, string>>): WireObject | null {
  const item = contents ? findChild(contents, matchName) : undefined;
  if (!item) return null;
  const read: Record<string, JsonValue> = { matchName };
  for (const [key, leafMatchName] of Object.entries(members)) read[key] = valueAt(item, leafMatchName);
  return read;
}

function weighted(point: number[] | undefined, [x, y]: readonly [number, number]): number { return (point?.[0] ?? 0) * x + (point?.[1] ?? 0) * y; }

function pathDigest(value: JsonValue): { points: number; closed: boolean; sum: number } {
  const path = isJsonObject(value) ? value : {};
  const vertices = pointsOf(path.vertices) ?? [],
    into = pointsOf(path.inTangents) ?? [],
    out = pointsOf(path.outTangents) ?? [];
  const sum = vertices.reduce(
    (total, vertex, index) =>
      total + weighted(vertex, POINT_WEIGHTS.vertex) + weighted(into[index], POINT_WEIGHTS.into) + weighted(out[index], POINT_WEIGHTS.out),
    0,
  );
  return { points: vertices.length, closed: path.closed === true, sum };
}

function pathTotals(contents: PropertySnapshot | undefined): { paths: number; points: number; closedPaths: number; checksum: number } {
  const totals = { paths: 0, points: 0, closedPaths: 0, checksum: 0 };
  for (const item of contents?.children ?? []) {
    if (item.matchName !== `${V} Shape - Group`) continue;
    const digest = pathDigest(valueAt(item, `${V} Shape`));
    totals.paths += 1; totals.points += digest.points; totals.checksum += digest.sum;
    if (digest.closed) totals.closedPaths += 1;
  }
  return totals;
}

function groupReadback(vectorGroup: PropertySnapshot, ordinal: number): WireObject {
  const contents = findChild(vectorGroup, VECTOR_CONTENTS), transform = findChild(vectorGroup, `${V} Transform Group`);
  return {
    ordinal, matchName: vectorGroup.matchName, name: vectorGroup.displayName, ...pathTotals(contents),
    fill: paintReadback(contents, `${V} Graphic - Fill`, FILL_MEMBERS),
    stroke: paintReadback(contents, `${V} Graphic - Stroke`, STROKE_MEMBERS),
    opacity: transform ? valueAt(transform, `${V} Group Opacity`) : null,
  };
}

/** Draws every shape into the layer's contents in one step: the first shape sits at the back, so the host adds the last one first. */
export function applyDrawVectorShapes(context: FixtureApplyContext, operation: WireObject): ApplyOutcome {
  const { layer } = resolveLayer(context, operation, "draw_vector_shapes");
  const root = shapeRootOf(layer);
  const shapes = vectorShapesOf(operation.shapes);
  const existing = childrenOf(root).length;
  for (const shape of [...shapes].reverse()) drawVectorGroup(root, shape);
  const groups = shapes.map((_, index) => {
    const ordinal = existing + shapes.length - index;
    return groupReadback(required(childrenOf(root)[ordinal - 1], "a drawn vector group"), ordinal);
  });
  context.evidence = { readback: { matchName: root.matchName, existing, total: childrenOf(root).length, groups } };
  return `drew ${shapes.length} vector shape${shapes.length === 1 ? "" : "s"} on layer ${layer.id}`;
}
