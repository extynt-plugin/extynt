// The comparison for draw_vector_shapes: each shape group the host read back against the shape requested, path by path, paint by paint, with the group's transform and the layer's bounds.
import { array, decode, fallback, jsonValue, nullable, number, object, optional, string } from "@extynt/decode";
import type { Infer, JsonObject } from "@extynt/decode";
import { sameNumber, sameRgbColor } from "./compare-values.js";
import type { Reading } from "./compare-values.js";
import { listOf, numberOf, objectOf } from "./json-fields.js";
import { hasCurve, pathExpectation, pathMismatchField, shapePathDecoder } from "./shape-path.js";
import type { ShapePath } from "./shape-path.js";
import type { Request } from "./plan-request.js";

const BOUNDS_TOLERANCE = 1;
const SHAPE_TEXT_LIMIT = 512;
const IDENTITY_TRANSFORM = { anchor: [0, 0], position: [0, 0], scale: [100, 100], rotation: 0 } as const;
const BOUNDS_KEYS = ["left", "top", "width", "height"] as const;

const paint = object({
  color: optional(fallback(jsonValue, undefined)),
  width: optional(fallback(number(), undefined)),
  opacity: optional(fallback(number(), undefined)),
  rule: optional(fallback(jsonValue, undefined)),
  cap: optional(fallback(jsonValue, undefined)),
  join: optional(fallback(jsonValue, undefined)),
  miterLimit: optional(fallback(number(), undefined)),
});

const vectorShape = object({
  name: optional(fallback(string(), undefined)),
  paths: optional(fallback(array(shapePathDecoder), undefined)),
  fill: optional(fallback(nullable(paint), undefined)),
  stroke: optional(fallback(nullable(paint), undefined)),
  opacity: optional(fallback(number(), undefined)),
});

const vectorRequest = object({ shapes: optional(fallback(array(vectorShape), undefined)) });

type VectorShape = Infer<typeof vectorShape>;
type Paint = Infer<typeof paint>;
type ExpectedValue = number | ReadonlyArray<number>;

/** A value a shape mismatch row summarizes: JSON, with fields that may be absent. */
export type TextValue = Reading | { readonly [key: string]: TextValue };

/** The bounded text a shape mismatch row carries for one side of the comparison. */
export function boundedShapeText(value: TextValue): string {
  const serialized = JSON.stringify(value) ?? "null";
  return serialized.length <= SHAPE_TEXT_LIMIT ? serialized : `${serialized.slice(0, SHAPE_TEXT_LIMIT - 3)}...`;
}

function valueMatches(observed: Reading, expected: ExpectedValue): boolean {
  if (typeof expected === "number") return sameNumber(observed, expected);
  const list = listOf(observed);
  return list !== undefined && list.length >= expected.length && expected.every((component, index) => sameNumber(list[index], component));
}

/** Whether a group transform is the identity a fresh group has, with this opacity; a field the host could not read is skipped. */
export function transformMatches(observed: Reading, opacity: number | undefined): boolean {
  if (observed === undefined) return true;
  const transform = objectOf(observed);
  if (!transform) return false;
  const expected: Readonly<Record<string, ExpectedValue>> = { ...IDENTITY_TRANSFORM, opacity: opacity ?? 100 };
  return Object.entries(expected).every(([key, wanted]) => {
    const seen = transform[key];
    return seen === null || seen === undefined || valueMatches(seen, wanted);
  });
}

function childMatchNames(observed: Reading): ReadonlyArray<Reading> | null {
  const contents = objectOf(observed);
  const children = listOf(contents?.children);
  return contents && children && contents.count === children.length ? children.map((child) => objectOf(child)?.matchName) : null;
}

/** Whether a group's Contents list exactly these children, front to back. */
export function childrenMatch(observed: Reading, matchNames: ReadonlyArray<string>): boolean {
  const names = observed === undefined ? matchNames : childMatchNames(observed);
  return names !== null && names.length === matchNames.length && matchNames.every((name, index) => names[index] === name);
}

function optionalNumberMatches(observed: Reading, expected: number | undefined): boolean {
  return expected === undefined || sameNumber(observed, expected);
}

function optionalMenuMatches(observed: Reading, expected: Reading): boolean {
  return expected === undefined || observed === expected;
}

function fillMatches(observed: Reading, fill: Paint | null | undefined): boolean {
  if (!fill) return observed === null;
  const read = objectOf(observed);
  return read?.matchName === "ADBE Vector Graphic - Fill" && sameRgbColor(read.color, fill.color) && optionalNumberMatches(read.opacity, fill.opacity) && optionalMenuMatches(read.rule, fill.rule);
}

function strokeStyleMatches(read: JsonObject, stroke: Paint): boolean {
  return optionalNumberMatches(read.opacity, stroke.opacity) && optionalMenuMatches(read.cap, stroke.cap) && optionalMenuMatches(read.join, stroke.join) && optionalNumberMatches(read.miterLimit, stroke.miterLimit);
}

function strokeMatches(observed: Reading, stroke: Paint | null | undefined): boolean {
  if (!stroke) return observed === null;
  const read = objectOf(observed);
  if (read?.matchName !== "ADBE Vector Graphic - Stroke" || !sameRgbColor(read.color, stroke.color) || !sameNumber(read.width, stroke.width)) return false;
  return strokeStyleMatches(read, stroke);
}

function geometryMatches(group: JsonObject, paths: ReadonlyArray<ShapePath>): boolean {
  const expected = pathExpectation(paths);
  const checksum = numberOf(group.checksum);
  return group.paths === paths.length && group.points === expected.points && group.closedPaths === expected.closedPaths && checksum !== undefined && Math.abs(checksum - expected.sum) <= expected.budget;
}

function pathsMatch(values: Reading, paths: ReadonlyArray<ShapePath>): boolean {
  if (values === undefined) return true;
  const list = listOf(values);
  return list !== undefined && list.length === paths.length && paths.every((path, index) => pathMismatchField(list[index], path) === null);
}

function childOrder(shape: VectorShape, paths: ReadonlyArray<ShapePath>): ReadonlyArray<string> {
  const order = paths.map(() => "ADBE Vector Shape - Group");
  return [...order, ...(shape.stroke ? ["ADBE Vector Graphic - Stroke"] : []), ...(shape.fill ? ["ADBE Vector Graphic - Fill"] : [])];
}

function structureMatches(group: JsonObject, shape: VectorShape, paths: ReadonlyArray<ShapePath>): boolean {
  return pathsMatch(group.pathValues, paths) && childrenMatch(group.contents, childOrder(shape, paths)) && transformMatches(group.transform, shape.opacity);
}

function groupNamed(group: JsonObject | undefined, shape: VectorShape): group is JsonObject {
  return group?.matchName === "ADBE Vector Group" && group.name === shape.name;
}

function groupMatches(observed: Reading, shape: VectorShape): boolean {
  const group = objectOf(observed);
  const paths = shape.paths;
  if (!groupNamed(group, shape) || !paths) return false;
  if (!geometryMatches(group, paths) || !structureMatches(group, shape, paths)) return false;
  return fillMatches(group.fill, shape.fill) && strokeMatches(group.stroke, shape.stroke) && optionalNumberMatches(group.opacity, shape.opacity);
}

type Bounds = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

function expectedBounds(readback: JsonObject, shapes: ReadonlyArray<VectorShape>): Bounds | null {
  const paths = shapes.flatMap((shape) => shape.paths ?? []);
  if (readback.existing !== 0 || paths.length === 0 || paths.some(hasCurve)) return null;
  const vertices = paths.flatMap((path) => path.vertices ?? []);
  const xs = vertices.map((vertex) => vertex[0]);
  const ys = vertices.map((vertex) => vertex[1]);
  const left = xs.reduce((least, x) => Math.min(least, x), Number.POSITIVE_INFINITY);
  const top = ys.reduce((least, y) => Math.min(least, y), Number.POSITIVE_INFINITY);
  const right = xs.reduce((most, x) => Math.max(most, x), Number.NEGATIVE_INFINITY);
  const bottom = ys.reduce((most, y) => Math.max(most, y), Number.NEGATIVE_INFINITY);
  return vertices.length > 0 ? { left, top, width: right - left, height: bottom - top } : null;
}

function boundsMatch(readback: JsonObject, shapes: ReadonlyArray<VectorShape>): boolean {
  const expected = expectedBounds(readback, shapes);
  const observed = objectOf(readback.bounds);
  if (!expected || !observed) return true;
  return BOUNDS_KEYS.every((key) => {
    const seen = numberOf(observed[key]);
    return seen !== undefined && Math.abs(seen - expected[key]) <= BOUNDS_TOLERANCE;
  });
}

function requestedShapes(request: Request): ReadonlyArray<VectorShape> | undefined {
  const decoded = decode(vectorRequest, request.row);
  return decoded.ok ? decoded.value.shapes : undefined;
}

/** Whether the groups the host read back are the shapes requested; null when the request or the read carries no shapes to compare. */
export function vectorShapesMatch(request: Request, readback: JsonObject): boolean | null {
  const shapes = requestedShapes(request);
  const groups = listOf(readback.groups);
  if (!shapes || !groups) return null;
  if (readback.matchName !== "ADBE Root Vectors Group" || groups.length !== shapes.length) return false;
  return shapes.every((shape, index) => groupMatches(groups[index], shape)) && boundsMatch(readback, shapes);
}

interface EvidenceText {
  readonly expectedValue: string;
  readonly observedValue: string;
}

function shapeSummary(request: Request, shape: VectorShape, index: number): string {
  const raw = objectOf(listOf(request.row.shapes)?.[index]);
  return boundedShapeText({ shapeIndex: index, name: raw?.name, ...pathExpectation(shape.paths ?? []), fill: raw?.fill, stroke: raw?.stroke, opacity: raw?.opacity });
}

function layerEvidence(shapes: ReadonlyArray<VectorShape>, readback: JsonObject, groupCount: number): EvidenceText {
  if (!boundsMatch(readback, shapes)) return { expectedValue: boundedShapeText({ bounds: expectedBounds(readback, shapes) }), observedValue: boundedShapeText({ bounds: readback.bounds }) };
  return { expectedValue: boundedShapeText({ matchName: "ADBE Root Vectors Group", shapeGroups: shapes.length }), observedValue: boundedShapeText({ matchName: readback.matchName, shapeGroups: groupCount }) };
}

/** The expected and observed text of the first shape group that differs, else of the layer's bounds, for a repair row. */
export function vectorMismatchEvidence(request: Request, readback: JsonObject | undefined): EvidenceText {
  const shapes = requestedShapes(request) ?? [];
  const observed = readback ?? {};
  const groups = listOf(observed.groups) ?? [];
  if (shapes.length !== groups.length) return { expectedValue: boundedShapeText({ shapeGroups: shapes.length }), observedValue: boundedShapeText({ shapeGroups: groups.length }) };
  const index = shapes.findIndex((shape, position) => !groupMatches(groups[position], shape));
  const first = shapes[index];
  if (!first) return layerEvidence(shapes, observed, groups.length);
  return { expectedValue: shapeSummary(request, first, index), observedValue: boundedShapeText({ shapeIndex: index, group: objectOf(groups[index]) ?? null }) };
}
