// Turns each drawable SVG element (rect, circle, ellipse, line, polyline, polygon, path) into subpaths in its own user space.
import { parseNumbers } from "./svg-matrix.js";
import { parsePathData } from "./svg-path.js";
import { closeSubpath, curveTo, lineTo, startSubpath, type Subpath } from "./svg-subpath.js";
import type { NoteSink, Point } from "./svg-convert-types.js";
import type { ShapeNode } from "./svg-node.js";

/** The width and height that percentage lengths resolve against. */
export interface Viewport {
  width: number;
  height: number;
}

interface RoundedRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  ry: number;
}

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const KAPPA = 0.5522847498307936;
const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|%)?\s*$/iu;
const UNIT_PX: ReadonlyMap<string, number> = new Map([["px", 1], ["pt", 4 / 3], ["pc", 16], ["mm", 96 / 25.4], ["cm", 96 / 2.54], ["in", 96]]);

/** A CSS length in user units; a percentage is of `basis`. Anything else (em, calc, junk) is undefined. */
export function parseLength(text: string | undefined, basis: number): number | undefined {
  const match = text === undefined ? null : LENGTH.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  return unit === "%" ? (value * basis) / 100 : value * (UNIT_PX.get(unit) ?? 1);
}

function coordinate(node: ShapeNode, name: string, basis: number): number {
  return parseLength(node.attrs[name], basis) ?? 0;
}

function ellipsePath({ cx, cy, rx, ry }: Ellipse): Subpath {
  const sub = startSubpath([cx + rx, cy]);
  curveTo(sub, [cx + rx, cy + KAPPA * ry], [cx + KAPPA * rx, cy + ry], [cx, cy + ry]);
  curveTo(sub, [cx - KAPPA * rx, cy + ry], [cx - rx, cy + KAPPA * ry], [cx - rx, cy]);
  curveTo(sub, [cx - rx, cy - KAPPA * ry], [cx - KAPPA * rx, cy - ry], [cx, cy - ry]);
  curveTo(sub, [cx + KAPPA * rx, cy - ry], [cx + rx, cy - KAPPA * ry], [cx + rx, cy]);
  closeSubpath(sub);
  return sub;
}

function roundedRectPath({ x, y, w, h, rx, ry }: RoundedRect): Subpath {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  const right = x + w;
  const bottom = y + h;
  const sub = startSubpath([x + rx, y]);
  lineTo(sub, [right - rx, y]);
  curveTo(sub, [right - rx + kx, y], [right, y + ry - ky], [right, y + ry]);
  lineTo(sub, [right, bottom - ry]);
  curveTo(sub, [right, bottom - ry + ky], [right - rx + kx, bottom], [right - rx, bottom]);
  lineTo(sub, [x + rx, bottom]);
  curveTo(sub, [x + rx - kx, bottom], [x, bottom - ry + ky], [x, bottom - ry]);
  lineTo(sub, [x, y + ry]);
  curveTo(sub, [x, y + ry - ky], [x + rx - kx, y], [x + rx, y]);
  closeSubpath(sub);
  return sub;
}

function plainRectPath(x: number, y: number, w: number, h: number): Subpath {
  const sub = startSubpath([x, y]);
  lineTo(sub, [x + w, y]);
  lineTo(sub, [x + w, y + h]);
  lineTo(sub, [x, y + h]);
  closeSubpath(sub);
  return sub;
}

function cornerRadii(node: ShapeNode, w: number, h: number, view: Viewport): [number, number] {
  const rx = parseLength(node.attrs.rx, view.width);
  const ry = parseLength(node.attrs.ry, view.height);
  return [Math.min(Math.max(rx ?? ry ?? 0, 0), w / 2), Math.min(Math.max(ry ?? rx ?? 0, 0), h / 2)];
}

function rectShape(node: ShapeNode, view: Viewport): Subpath[] {
  const w = coordinate(node, "width", view.width);
  const h = coordinate(node, "height", view.height);
  if (!(w > 0) || !(h > 0)) return [];
  const x = coordinate(node, "x", view.width);
  const y = coordinate(node, "y", view.height);
  const [rx, ry] = cornerRadii(node, w, h, view);
  return [rx > 0 && ry > 0 ? roundedRectPath({ x, y, w, h, rx, ry }) : plainRectPath(x, y, w, h)];
}

function circleShape(node: ShapeNode, view: Viewport): Subpath[] {
  const r = coordinate(node, "r", Math.hypot(view.width, view.height) / Math.SQRT2);
  if (!(r > 0)) return [];
  return [ellipsePath({ cx: coordinate(node, "cx", view.width), cy: coordinate(node, "cy", view.height), rx: r, ry: r })];
}

function ellipseShape(node: ShapeNode, view: Viewport): Subpath[] {
  const rx = coordinate(node, "rx", view.width);
  const ry = coordinate(node, "ry", view.height);
  if (!(rx > 0 && ry > 0)) return [];
  return [ellipsePath({ cx: coordinate(node, "cx", view.width), cy: coordinate(node, "cy", view.height), rx, ry })];
}

function lineShape(node: ShapeNode, view: Viewport): Subpath[] {
  const sub = startSubpath([coordinate(node, "x1", view.width), coordinate(node, "y1", view.height)]);
  lineTo(sub, [coordinate(node, "x2", view.width), coordinate(node, "y2", view.height)]);
  return [sub];
}

function pointPairs(numbers: readonly number[]): Point[] {
  return Array.from({ length: Math.floor(numbers.length / 2) }, (_, pair): Point => [numbers[2 * pair] ?? 0, numbers[2 * pair + 1] ?? 0]);
}

function pointsShape(node: ShapeNode, closed: boolean): Subpath[] {
  const [first, ...rest] = pointPairs(parseNumbers(node.attrs.points ?? "") ?? []);
  if (!first || rest.length === 0) return [];
  const sub = startSubpath(first);
  for (const point of rest) lineTo(sub, point);
  if (closed) closeSubpath(sub);
  return [sub];
}

function pathShape(node: ShapeNode, notes: NoteSink): Subpath[] {
  const parsed = parsePathData(node.attrs.d ?? "");
  if (parsed.malformed) notes.approximate("malformed-path-data");
  return parsed.subpaths;
}

/** The subpaths of one drawable element in its own user space; a malformed path is cut short and noted. */
export function elementSubpaths(node: ShapeNode, view: Viewport, notes: NoteSink): Subpath[] {
  switch (node.name) {
    case "rect": return rectShape(node, view);
    case "circle": return circleShape(node, view);
    case "ellipse": return ellipseShape(node, view);
    case "line": return lineShape(node, view);
    case "polyline": return pointsShape(node, false);
    case "polygon": return pointsShape(node, true);
    case "path": return pathShape(node, notes);
  }
}
