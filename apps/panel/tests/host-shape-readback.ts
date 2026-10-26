/** Pure comparison of the bounded native shape state the host reads back after a write against what the plan asked for. */
import { isFiniteNumber, type JsonObject, type JsonValue } from "@extynt/decode";
import { fieldOf, isRecord, type Found } from "./json-narrow.js";
import { listOf, numberMatches, pathMismatchField, readAll, readPath, rgbMatches, vectorExpectation, type ShapePath } from "./host-shape-geometry.js";

type ShapeComparator = (operation: JsonObject, readback: JsonObject) => boolean | null;
type Bounds = Readonly<Record<"left" | "top" | "width" | "height", number>>;

const BOUNDS_TOLERANCE = 1;
const BOUNDS_KEYS = ["left", "top", "width", "height"] as const;
const FILL = "ADBE Vector Graphic - Fill";
const STROKE = "ADBE Vector Graphic - Stroke";
const SHAPE_GROUP = "ADBE Vector Shape - Group";
const VECTOR_GROUP = "ADBE Vector Group";

function transformMatches(observed: Found, opacity: Found): boolean {
  if (!isRecord(observed)) return observed === undefined;
  const expected: ReadonlyArray<readonly [string, JsonValue]> = [
    ["anchor", [0, 0]],
    ["position", [0, 0]],
    ["scale", [100, 100]],
    ["rotation", 0],
    ["opacity", opacity === undefined ? 100 : opacity],
  ];
  return expected.every(([key, want]) => {
    const seen = fieldOf(observed, key);
    return seen === null || seen === undefined || valueMatches(seen, want);
  });
}

function valueMatches(observed: Found, expected: Found): boolean {
  const wanted = listOf(expected);
  if (!wanted) return numberMatches(observed, expected);
  const seen = listOf(observed);
  if (!seen || seen.length < wanted.length) return false;
  return wanted.every((entry, index) => numberMatches(seen[index], entry));
}

function childMatchNames(observed: Found): ReadonlyArray<Found> | null {
  const children = listOf(fieldOf(observed, "children"));
  if (!children || fieldOf(observed, "count") !== children.length) return null;
  return children.map((child) => fieldOf(child, "matchName"));
}

function childrenMatch(observed: Found, matchNames: ReadonlyArray<string>): boolean {
  const observedNames = observed === undefined ? matchNames : childMatchNames(observed);
  if (!observedNames || observedNames.length !== matchNames.length) return false;
  return matchNames.every((name, index) => observedNames[index] === name);
}

function groupMatches(operation: JsonObject, readback: JsonObject): boolean {
  const ordinal = fieldOf(readback, "ordinal");
  const named = fieldOf(readback, "matchName") === VECTOR_GROUP && fieldOf(readback, "name") === fieldOf(operation, "name");
  if (!named || !isFiniteNumber(ordinal) || ordinal < 1) return false;
  return childrenMatch(fieldOf(readback, "contents"), []) && transformMatches(fieldOf(readback, "transform"), undefined);
}

function pathMatches(operation: JsonObject, readback: JsonObject): boolean | null {
  const path = readPath(fieldOf(operation, "path"));
  if (!path || path.closed === undefined) return null;
  return fieldOf(readback, "matchName") === "ADBE Vector Shape" && pathMismatchField(readback, path) === null;
}

function opacityMatches(operation: JsonObject, readback: JsonObject): boolean {
  return fieldOf(operation, "opacity") === undefined || numberMatches(fieldOf(readback, "opacity"), fieldOf(operation, "opacity"));
}

function fillMatches(operation: JsonObject, readback: JsonObject): boolean {
  const checks = [fieldOf(readback, "matchName") === FILL, rgbMatches(fieldOf(readback, "color"), fieldOf(operation, "color")), opacityMatches(operation, readback)];
  return checks.every(Boolean);
}

function strokeMatches(operation: JsonObject, readback: JsonObject): boolean {
  const checks = [
    fieldOf(readback, "matchName") === STROKE,
    rgbMatches(fieldOf(readback, "color"), fieldOf(operation, "color")),
    numberMatches(fieldOf(readback, "width"), fieldOf(operation, "width")),
    opacityMatches(operation, readback),
  ];
  return checks.every(Boolean);
}

function optionalNumberMatches(observed: Found, expected: Found): boolean {
  return expected === undefined || numberMatches(observed, expected);
}

function optionalMenuMatches(observed: Found, expected: Found): boolean {
  return expected === undefined || observed === expected;
}

function vectorFillMatches(observed: Found, fill: Found): boolean {
  if (!isRecord(fill)) return observed === null;
  const checks = [
    isRecord(observed),
    fieldOf(observed, "matchName") === FILL,
    rgbMatches(fieldOf(observed, "color"), fieldOf(fill, "color")),
    optionalNumberMatches(fieldOf(observed, "opacity"), fieldOf(fill, "opacity")),
    optionalMenuMatches(fieldOf(observed, "rule"), fieldOf(fill, "rule")),
  ];
  return checks.every(Boolean);
}

function vectorStrokeMatches(observed: Found, stroke: Found): boolean {
  if (!isRecord(stroke)) return observed === null;
  const checks = [
    isRecord(observed),
    fieldOf(observed, "matchName") === STROKE,
    rgbMatches(fieldOf(observed, "color"), fieldOf(stroke, "color")),
    numberMatches(fieldOf(observed, "width"), fieldOf(stroke, "width")),
    optionalNumberMatches(fieldOf(observed, "opacity"), fieldOf(stroke, "opacity")),
    optionalMenuMatches(fieldOf(observed, "cap"), fieldOf(stroke, "cap")),
    optionalMenuMatches(fieldOf(observed, "join"), fieldOf(stroke, "join")),
    optionalNumberMatches(fieldOf(observed, "miterLimit"), fieldOf(stroke, "miterLimit")),
  ];
  return checks.every(Boolean);
}

function vectorGeometryMatches(group: JsonObject, paths: ReadonlyArray<ShapePath>): boolean {
  const expected = vectorExpectation(paths);
  const checksum = fieldOf(group, "checksum");
  const counts = fieldOf(group, "paths") === paths.length && fieldOf(group, "points") === expected.points && fieldOf(group, "closedPaths") === expected.closedPaths;
  return counts && isFiniteNumber(checksum) && Math.abs(checksum - expected.sum) <= expected.budget;
}

function vectorPathsMatch(values: Found, paths: ReadonlyArray<ShapePath>): boolean {
  if (values === undefined) return true;
  const read = listOf(values);
  if (!read || read.length !== paths.length) return false;
  return paths.every((path, index) => pathMismatchField(read[index], path) === null);
}

function vectorChildOrder(shape: JsonObject, paths: ReadonlyArray<ShapePath>): string[] {
  return [
    ...paths.map(() => SHAPE_GROUP),
    ...(fieldOf(shape, "stroke") ? [STROKE] : []),
    ...(fieldOf(shape, "fill") ? [FILL] : []),
  ];
}

function vectorStructureMatches(group: JsonObject, shape: JsonObject, paths: ReadonlyArray<ShapePath>): boolean {
  const checks = [
    vectorPathsMatch(fieldOf(group, "pathValues"), paths),
    childrenMatch(fieldOf(group, "contents"), vectorChildOrder(shape, paths)),
    transformMatches(fieldOf(group, "transform"), fieldOf(shape, "opacity")),
  ];
  return checks.every(Boolean);
}

function vectorPaints(group: JsonObject, shape: JsonObject): boolean {
  const checks = [
    vectorFillMatches(fieldOf(group, "fill"), fieldOf(shape, "fill")),
    vectorStrokeMatches(fieldOf(group, "stroke"), fieldOf(shape, "stroke")),
    optionalNumberMatches(fieldOf(group, "opacity"), fieldOf(shape, "opacity")),
  ];
  return checks.every(Boolean);
}

function shapePaths(shape: JsonObject): ShapePath[] | null {
  const entries = listOf(fieldOf(shape, "paths"));
  return entries ? readAll(entries, readPath) : null;
}

function vectorGroupMatches(observed: Found, shape: JsonObject): boolean {
  const paths = shapePaths(shape);
  if (!isRecord(observed) || !paths) return false;
  if (fieldOf(observed, "matchName") !== VECTOR_GROUP || fieldOf(observed, "name") !== fieldOf(shape, "name")) return false;
  if (!vectorGeometryMatches(observed, paths) || !vectorStructureMatches(observed, shape, paths)) return false;
  return vectorPaints(observed, shape);
}

function hasCurve(path: ShapePath): boolean {
  return [...path.inTangents, ...path.outTangents].some(([x, y]) => x !== 0 || y !== 0);
}

function allPaths(shapes: ReadonlyArray<Found>): ShapePath[] {
  return shapes.flatMap((shape) => (isRecord(shape) ? shapePaths(shape) ?? [] : []));
}

function expectedBounds(readback: JsonObject, shapes: ReadonlyArray<Found>): Bounds | null {
  const paths = allPaths(shapes);
  if (fieldOf(readback, "existing") !== 0 || paths.length === 0 || paths.some(hasCurve)) return null;
  const vertices = paths.flatMap((path) => path.vertices);
  const xs = vertices.map(([x]) => x);
  const ys = vertices.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function boundsMatch(readback: JsonObject, shapes: ReadonlyArray<Found>): boolean {
  const expected = expectedBounds(readback, shapes);
  const observed = fieldOf(readback, "bounds");
  if (!expected || !isRecord(observed)) return true;
  return BOUNDS_KEYS.every((key) => {
    const seen = fieldOf(observed, key);
    return isFiniteNumber(seen) && Math.abs(seen - expected[key]) <= BOUNDS_TOLERANCE;
  });
}

function vectorShapesMatch(operation: JsonObject, readback: JsonObject): boolean | null {
  const shapes = listOf(fieldOf(operation, "shapes"));
  const groups = listOf(fieldOf(readback, "groups"));
  if (!shapes || !groups) return null;
  if (fieldOf(readback, "matchName") !== "ADBE Root Vectors Group" || groups.length !== shapes.length) return false;
  const everyGroup = shapes.every((shape, index) => isRecord(shape) && vectorGroupMatches(groups[index], shape));
  return everyGroup && boundsMatch(readback, shapes);
}

const COMPARATORS: ReadonlyMap<string, ShapeComparator> = new Map<string, ShapeComparator>([
  ["create_shape_group", groupMatches],
  ["set_shape_path", pathMatches],
  ["ensure_shape_fill", fillMatches],
  ["ensure_shape_stroke", strokeMatches],
  ["draw_vector_shapes", vectorShapesMatch],
]);

/** Null means the host supplied no complete readback, false is a mismatch, and true is a tolerant match to the requested structural state. */
export function shapeReadbackMatches(kind: string, operation: JsonObject, observed: Found): boolean | null {
  const compare = COMPARATORS.get(kind);
  return isRecord(observed) && compare ? compare(operation, observed) : null;
}
