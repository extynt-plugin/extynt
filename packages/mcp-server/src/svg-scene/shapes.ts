// SVG basic shapes as path data, and geometry helpers over the AE path form.
import { parsePathData, type ScenePath } from "./path.js";
import { applyPoint, applyVector, numbersIn, type Matrix, type Point } from "./transform.js";
import type { SvgElement } from "./xml.js";

/** A bounding box as [x, y, width, height]. */
export type Bounds = [number, number, number, number];

type Attributes = Readonly<Record<string, string>>;
interface Extent { min: Point; max: Point }
interface Cubic { readonly from: Point; readonly c1: Point; readonly c2: Point; readonly to: Point }

function length(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cornerRadii(attributes: Attributes, width: number, height: number): Point {
  const rxRaw = attributes.rx ?? attributes.ry, ryRaw = attributes.ry ?? attributes.rx;
  return [Math.min(Math.max(0, length(rxRaw)), width / 2), Math.min(Math.max(0, length(ryRaw)), height / 2)];
}

function rectData(attributes: Attributes): string | undefined {
  const x = length(attributes.x), y = length(attributes.y), width = length(attributes.width), height = length(attributes.height);
  if (width <= 0 || height <= 0) return undefined;
  const [rx, ry] = cornerRadii(attributes, width, height);
  if (rx === 0 || ry === 0) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  const arc = (dx: number, dy: number) => `A${rx} ${ry} 0 0 1 ${dx} ${dy}`;
  return `M${x + rx} ${y}H${x + width - rx}${arc(x + width, y + ry)}V${y + height - ry}${arc(x + width - rx, y + height)}H${x + rx}${arc(x, y + height - ry)}V${y + ry}${arc(x + rx, y)}Z`;
}

function ellipseData(cx: number, cy: number, rx: number, ry: number): string | undefined {
  if (rx <= 0 || ry <= 0) return undefined;
  return `M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`;
}

function pointsData(points: string | undefined, closed: boolean): string | undefined {
  const numbers = numbersIn(points ?? "");
  if (numbers.length < 4) return undefined;
  const pairs: string[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) pairs.push(`${numbers[index]} ${numbers[index + 1]}`);
  return `M${pairs.join("L")}${closed ? "Z" : ""}`;
}

function circleData(attributes: Attributes): string | undefined {
  const r = length(attributes.r);
  return ellipseData(length(attributes.cx), length(attributes.cy), r, r);
}

function ellipseElementData(attributes: Attributes): string | undefined {
  return ellipseData(length(attributes.cx), length(attributes.cy), length(attributes.rx, length(attributes.ry)), length(attributes.ry, length(attributes.rx)));
}

const SHAPE_DATA: Readonly<Record<string, (attributes: Attributes) => string | undefined>> = {
  path: (attributes) => attributes.d,
  rect: rectData,
  circle: circleData,
  ellipse: ellipseElementData,
  line: (attributes) => `M${length(attributes.x1)} ${length(attributes.y1)}L${length(attributes.x2)} ${length(attributes.y2)}`,
  polyline: (attributes) => pointsData(attributes.points, false),
  polygon: (attributes) => pointsData(attributes.points, true),
};

/** The names of the SVG elements that draw a shape. */
export const SHAPE_ELEMENTS: ReadonlySet<string> = new Set(Object.keys(SHAPE_DATA));

/** The element's subpaths in its own user space, or none when it draws nothing. */
export function elementPaths(element: SvgElement): ScenePath[] {
  const data = SHAPE_DATA[element.name]?.(element.attributes);
  return data ? parsePathData(data).filter((path) => path.vertices.length > 1 || path.closed) : [];
}

/** The path with every vertex and tangent moved through the matrix. */
export function transformPath(path: ScenePath, matrix: Matrix): ScenePath {
  return {
    vertices: path.vertices.map((vertex) => applyPoint(matrix, vertex)),
    inTangents: path.inTangents.map((tangent) => applyVector(matrix, tangent)),
    outTangents: path.outTangents.map((tangent) => applyVector(matrix, tangent)),
    closed: path.closed,
  };
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b].filter((t) => t > 0 && t < 1);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter((t) => t > 0 && t < 1);
}

function cubicAt(cubic: Cubic, axis: 0 | 1, t: number): number {
  const u = 1 - t;
  return u * u * u * cubic.from[axis] + 3 * u * u * t * cubic.c1[axis] + 3 * u * t * t * cubic.c2[axis] + t * t * t * cubic.to[axis];
}

function includePoint(extent: Extent, point: Point): void {
  extent.min = [Math.min(extent.min[0], point[0]), Math.min(extent.min[1], point[1])];
  extent.max = [Math.max(extent.max[0], point[0]), Math.max(extent.max[1], point[1])];
}

function includeSegment(extent: Extent, cubic: Cubic): void {
  for (const axis of [0, 1] as const) {
    for (const t of cubicExtrema(cubic.from[axis], cubic.c1[axis], cubic.c2[axis], cubic.to[axis])) {
      const value = cubicAt(cubic, axis, t);
      extent.min[axis] = Math.min(extent.min[axis], value);
      extent.max[axis] = Math.max(extent.max[axis], value);
    }
  }
}

function cubicsOf(path: ScenePath): Cubic[] {
  const count = path.vertices.length, segments = path.closed ? count : count - 1;
  const cubics: Cubic[] = [];
  for (let index = 0; index < segments; index += 1) {
    const from = path.vertices[index], to = path.vertices[(index + 1) % count];
    const out = path.outTangents[index], into = path.inTangents[(index + 1) % count];
    if (from && to && out && into) cubics.push({ from, c1: [from[0] + out[0], from[1] + out[1]], c2: [to[0] + into[0], to[1] + into[1]], to });
  }
  return cubics;
}

function emptyExtent(): Extent {
  return { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
}

function includePath(extent: Extent, path: ScenePath): void {
  for (const vertex of path.vertices) includePoint(extent, vertex);
  for (const cubic of cubicsOf(path)) includeSegment(extent, cubic);
}

/** The exact bounds of the curves, not of their control points; `pad` grows it by half a stroke. */
export function pathBounds(entries: readonly { paths: readonly ScenePath[]; pad: number }[]): Bounds | undefined {
  const total = emptyExtent();
  for (const entry of entries) {
    for (const path of entry.paths) {
      const own = emptyExtent();
      includePath(own, path);
      includePoint(total, [own.min[0] - entry.pad, own.min[1] - entry.pad]);
      includePoint(total, [own.max[0] + entry.pad, own.max[1] + entry.pad]);
    }
  }
  return Number.isFinite(total.min[0]) ? [total.min[0], total.min[1], total.max[0] - total.min[0], total.max[1] - total.min[1]] : undefined;
}
