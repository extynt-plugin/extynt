// SVG path data to After Effects shape paths. Every segment becomes a cubic:
// a vertex carries the tangent into it and the tangent out of it, each an
// offset from the vertex, which is exactly how AE stores a Shape.
import type { Point } from "./transform.js";

/** One subpath in After Effects form: vertices with the tangents into and out of each, offsets from the vertex. */
export interface ScenePath { vertices: Point[]; inTangents: Point[]; outTangents: Point[]; closed: boolean }

const EPSILON = 1e-6;
const ORIGIN: Point = [0, 0];

interface Builder {
  paths: ScenePath[];
  current: ScenePath | undefined;
  start: Point;
  point: Point;
  lastCubic: Point | undefined;
  lastQuad: Point | undefined;
}

type Token = string | number;
type Handler = (builder: Builder, values: readonly number[], relative: boolean) => void;
type CommandLetter = "m" | "l" | "h" | "v" | "c" | "s" | "q" | "t" | "a" | "z";

interface ArcSpec { rx: number; ry: number; rotation: number; large: boolean; sweep: boolean; end: Point }
interface Ellipse { center: Point; rx: number; ry: number; start: number; delta: number; cos: number; sin: number }

function tokenize(data: string): Token[] {
  const tokens: Token[] = [];
  for (const match of data.matchAll(/([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gu)) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2] !== undefined) tokens.push(Number(match[2]));
  }
  return tokens;
}

function add(left: Point, right: Point): Point { return [left[0] + right[0], left[1] + right[1]]; }
function near(left: Point, right: Point): boolean { return Math.abs(left[0] - right[0]) < EPSILON && Math.abs(left[1] - right[1]) < EPSILON; }
function arg(values: readonly number[], index: number): number { return values[index] ?? 0; }

function finishOpen(builder: Builder): void {
  if (builder.current && builder.current.vertices.length > 1) builder.paths.push(builder.current);
  builder.current = undefined;
}

function moveTo(builder: Builder, point: Point): ScenePath {
  finishOpen(builder);
  const path: ScenePath = { vertices: [point], inTangents: [[0, 0]], outTangents: [[0, 0]], closed: false };
  builder.current = path;
  builder.start = point;
  builder.point = point;
  builder.lastCubic = undefined;
  builder.lastQuad = undefined;
  return path;
}

function currentPath(builder: Builder): ScenePath {
  return builder.current ?? moveTo(builder, builder.point);
}

function cubicTo(builder: Builder, c1: Point, c2: Point, end: Point): void {
  const path = currentPath(builder);
  path.outTangents[path.vertices.length - 1] = [c1[0] - builder.point[0], c1[1] - builder.point[1]];
  path.vertices.push(end);
  path.inTangents.push([c2[0] - end[0], c2[1] - end[1]]);
  path.outTangents.push([0, 0]);
  builder.point = end;
  builder.lastCubic = c2;
  builder.lastQuad = undefined;
}

function lineTo(builder: Builder, end: Point): void {
  const path = currentPath(builder);
  path.vertices.push(end);
  path.inTangents.push([0, 0]);
  path.outTangents.push([0, 0]);
  builder.point = end;
  builder.lastCubic = undefined;
  builder.lastQuad = undefined;
}

function quadTo(builder: Builder, control: Point, end: Point): void {
  const from = builder.point;
  const c1: Point = [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])];
  const c2: Point = [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])];
  cubicTo(builder, c1, c2, end);
  builder.lastQuad = control;
  builder.lastCubic = undefined;
}

function closePath(builder: Builder): void {
  const path = builder.current;
  if (!path) return;
  if (path.vertices.length > 1 && near(builder.point, builder.start)) {
    const closing = path.inTangents.pop();
    if (closing) path.inTangents[0] = closing;
    path.vertices.pop();
    path.outTangents.pop();
  }
  path.closed = true;
  builder.paths.push(path);
  builder.current = undefined;
  builder.point = builder.start;
  builder.lastCubic = undefined;
  builder.lastQuad = undefined;
}

function reflect(control: Point | undefined, around: Point): Point {
  return control ? [2 * around[0] - control[0], 2 * around[1] - control[1]] : around;
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

function ellipseRadii(spec: ArcSpec, x1: number, y1: number): Point {
  const rx = Math.abs(spec.rx), ry = Math.abs(spec.ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  return lambda > 1 ? [rx * Math.sqrt(lambda), ry * Math.sqrt(lambda)] : [rx, ry];
}

function arcEllipse(from: Point, spec: ArcSpec): Ellipse {
  const phi = spec.rotation * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (from[0] - spec.end[0]) / 2, dy = (from[1] - spec.end[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const [rx, ry] = ellipseRadii(spec, x1, y1);
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (spec.large === spec.sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = factor * (rx * y1) / ry, cy1 = factor * -(ry * x1) / rx;
  const center: Point = [cos * cx1 - sin * cy1 + (from[0] + spec.end[0]) / 2, sin * cx1 + cos * cy1 + (from[1] + spec.end[1]) / 2];
  const start = angleBetween(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  const raw = angleBetween((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  const delta = !spec.sweep && raw > 0 ? raw - 2 * Math.PI : spec.sweep && raw < 0 ? raw + 2 * Math.PI : raw;
  return { center, rx, ry, start, delta, cos, sin };
}

function ellipsePoint(arc: Ellipse, theta: number): Point {
  return [arc.center[0] + arc.rx * Math.cos(theta) * arc.cos - arc.ry * Math.sin(theta) * arc.sin, arc.center[1] + arc.rx * Math.cos(theta) * arc.sin + arc.ry * Math.sin(theta) * arc.cos];
}

function ellipseDerivative(arc: Ellipse, theta: number): Point {
  return [-arc.rx * Math.sin(theta) * arc.cos - arc.ry * Math.cos(theta) * arc.sin, -arc.rx * Math.sin(theta) * arc.sin + arc.ry * Math.cos(theta) * arc.cos];
}

function arcTo(builder: Builder, spec: ArcSpec): void {
  const from = builder.point;
  if (near(from, spec.end)) return;
  if (spec.rx === 0 || spec.ry === 0) {
    lineTo(builder, spec.end);
    return;
  }
  const arc = arcEllipse(from, spec);
  const segments = Math.max(1, Math.ceil(Math.abs(arc.delta) / (Math.PI / 2) - 1e-9));
  const step = arc.delta / segments, kappa = (4 / 3) * Math.tan(step / 4);
  for (let index = 0; index < segments; index += 1) {
    const t0 = arc.start + step * index, t1 = t0 + step;
    const p0 = ellipsePoint(arc, t0), p1 = index === segments - 1 ? spec.end : ellipsePoint(arc, t1);
    const d0 = ellipseDerivative(arc, t0), d1 = ellipseDerivative(arc, t1);
    cubicTo(builder, [p0[0] + kappa * d0[0], p0[1] + kappa * d0[1]], [p1[0] - kappa * d1[0], p1[1] - kappa * d1[1]], p1);
  }
}

function pointAt(builder: Builder, values: readonly number[], index: number, relative: boolean): Point {
  return add(relative ? builder.point : ORIGIN, [arg(values, index), arg(values, index + 1)]);
}

const COMMANDS: Readonly<Record<CommandLetter, { count: number; run: Handler }>> = {
  m: { count: 2, run: (builder, values, relative) => moveTo(builder, pointAt(builder, values, 0, relative)) },
  l: { count: 2, run: (builder, values, relative) => lineTo(builder, pointAt(builder, values, 0, relative)) },
  h: { count: 1, run: (builder, values, relative) => lineTo(builder, [relative ? builder.point[0] + arg(values, 0) : arg(values, 0), builder.point[1]]) },
  v: { count: 1, run: (builder, values, relative) => lineTo(builder, [builder.point[0], relative ? builder.point[1] + arg(values, 0) : arg(values, 0)]) },
  c: { count: 6, run: (builder, values, relative) => cubicTo(builder, pointAt(builder, values, 0, relative), pointAt(builder, values, 2, relative), pointAt(builder, values, 4, relative)) },
  s: { count: 4, run: (builder, values, relative) => cubicTo(builder, reflect(builder.lastCubic, builder.point), pointAt(builder, values, 0, relative), pointAt(builder, values, 2, relative)) },
  q: { count: 4, run: (builder, values, relative) => quadTo(builder, pointAt(builder, values, 0, relative), pointAt(builder, values, 2, relative)) },
  t: { count: 2, run: (builder, values, relative) => quadTo(builder, reflect(builder.lastQuad, builder.point), pointAt(builder, values, 0, relative)) },
  a: { count: 7, run: (builder, values, relative) => arcTo(builder, { rx: arg(values, 0), ry: arg(values, 1), rotation: arg(values, 2), large: arg(values, 3) !== 0, sweep: arg(values, 4) !== 0, end: pointAt(builder, values, 5, relative) }) },
  z: { count: 0, run: (builder) => closePath(builder) },
};

function isCommandLetter(letter: string): letter is CommandLetter {
  return letter in COMMANDS;
}

function readArguments(tokens: readonly Token[], at: number, count: number): number[] | undefined {
  const values: number[] = [];
  for (let index = at; values.length < count; index += 1) {
    const token = tokens[index];
    if (typeof token !== "number") return undefined;
    values.push(token);
  }
  return values;
}

function runCommand(builder: Builder, tokens: readonly Token[], at: number, command: string): number | undefined {
  const letter = command.toLowerCase();
  if (!isCommandLetter(letter)) return undefined;
  const entry = COMMANDS[letter];
  const values = readArguments(tokens, at, entry.count);
  if (!values) return undefined;
  entry.run(builder, values, command !== command.toUpperCase());
  return at + entry.count;
}

function continuation(command: string): string {
  if (command.toLowerCase() !== "m") return command;
  return command === "m" ? "l" : "L";
}

/** Parses path data into closed and open subpaths; malformed trailing data ends the path where it went wrong. */
export function parsePathData(data: string): ScenePath[] {
  const tokens = tokenize(data);
  const builder: Builder = { paths: [], current: undefined, start: [0, 0], point: [0, 0], lastCubic: undefined, lastQuad: undefined };
  let index = 0, command = "";
  while (index < tokens.length) {
    const token = tokens[index];
    const fresh = typeof token === "string";
    if (fresh) {
      command = token;
      index += 1;
    }
    const next = runCommand(builder, tokens, index, command);
    if (next === undefined || (!fresh && next === index)) break;
    index = next;
    command = continuation(command);
  }
  finishOpen(builder);
  return builder.paths;
}
