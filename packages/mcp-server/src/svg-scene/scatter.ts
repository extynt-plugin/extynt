// data-scatter on a top-level group copies its drawn mark N times at seeded pseudo-random positions, sizes and opacities
// inside an area, as real shapes in the one layer: a starfield, dust or particles, which an AE Repeater cannot scatter.
import { dotRow, parseOpacityValues, REPEAT_LIMITS, type Warn } from "./repeat.js";
import { pathBounds, transformPath } from "./shapes.js";
import { applyPoint, numbersIn, type Matrix, type Point } from "./transform.js";
import type { DrawnShape } from "./walk.js";
import type { SvgElement } from "./xml.js";

type Box = [number, number, number, number];

const DEFAULT_SIZE: Point = [0.5, 1.5];
const DEFAULT_OPACITY: Point = [0.35, 1];
const DOT_PIXELS = 16;

interface ScatterLimits { readonly shapes: number; readonly vertices: number }

interface Scattered { readonly leaves: DrawnShape[]; readonly count: number }

interface ScatterInput {
  readonly element: SvgElement;
  readonly leaves: readonly DrawnShape[];
  readonly rootMatrix: Matrix;
  readonly canvas: Point;
  readonly limits: ScatterLimits;
  readonly name: string;
  readonly warn: Warn;
}

interface Request { readonly count: number; readonly opacity?: Point; readonly fromRow: boolean }
interface Ranges { readonly area: Box; readonly size: Point; readonly opacity: Point }
interface Placement { readonly center: Point; readonly size: number; readonly opacity: number }
interface Plan { readonly count: number; readonly ranges: Ranges; readonly seed: number }

function seedOf(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193) >>> 0;
  return hash;
}

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296);
  };
}

function sortedPair(values: readonly number[]): Point {
  const [first = 0, second = first] = values;
  return [Math.min(first, second), Math.max(first, second)];
}

function sizeRange(element: SvgElement, name: string, warn: Warn): Point {
  const text = element.attributes["data-scatter-size"];
  if (text === undefined) return DEFAULT_SIZE;
  const values = numbersIn(text);
  if ((values.length === 1 || values.length === 2) && values.every((value) => value > 0)) return sortedPair(values);
  warn(`"${name}": data-scatter-size "${text}" is not "min max" size multipliers above 0; the default ${DEFAULT_SIZE[0]} ${DEFAULT_SIZE[1]} was used.`);
  return DEFAULT_SIZE;
}

function opacityRange(element: SvgElement, name: string, warn: Warn, fallback: Point): Point {
  const text = element.attributes["data-scatter-opacity"];
  if (text === undefined) return fallback;
  const values = parseOpacityValues(text);
  if (values) return sortedPair(values.map((value) => value / 100));
  warn(`"${name}": data-scatter-opacity "${text}" is not "min max" opacities from 0 to 1 (or 0 to 100 percent); the default was used.`);
  return fallback;
}

function areaRect(values: readonly number[]): Box | undefined {
  const [x = 0, y = 0, width = 0, height = 0] = values;
  return values.length === 4 && width > 0 && height > 0 ? [x, y, width, height] : undefined;
}

function areaOf(input: ScatterInput): Box {
  const { element, rootMatrix, canvas, name, warn } = input;
  const whole: Box = [0, 0, canvas[0], canvas[1]];
  const text = element.attributes["data-scatter-area"];
  if (text === undefined) return whole;
  const rect = areaRect(numbersIn(text));
  if (!rect) {
    warn(`"${name}": data-scatter-area "${text}" is not "x y w h" with a positive width and height; the whole canvas was used.`);
    return whole;
  }
  const first = applyPoint(rootMatrix, [rect[0], rect[1]]), second = applyPoint(rootMatrix, [rect[0] + rect[2], rect[1] + rect[3]]);
  return [Math.min(first[0], second[0]), Math.min(first[1], second[1]), Math.abs(second[0] - first[0]), Math.abs(second[1] - first[1])];
}

function markBounds(leaves: readonly DrawnShape[]): Box | undefined {
  return pathBounds(leaves.map((leaf) => ({ paths: leaf.paths, pad: leaf.stroke ? leaf.stroke.width / 2 : 0 })));
}

function explicitRequest(text: string, name: string, warn: Warn): Request | undefined {
  const count = Number(text.trim());
  if (Number.isInteger(count) && count >= REPEAT_LIMITS.minCopies) return { count, fromRow: false };
  warn(`"${name}": data-scatter "${text}" is not a whole number of copies of at least ${REPEAT_LIMITS.minCopies}; no scatter was applied.`);
  return undefined;
}

function rowRequest(element: SvgElement, bounds: Box): Request | undefined {
  const row = dotRow(element);
  if (!row || bounds[2] > DOT_PIXELS || bounds[3] > DOT_PIXELS) return undefined;
  const opacity = row.opacity ? sortedPair(row.opacity.map((value) => value / 100)) : undefined;
  return { count: row.copies, fromRow: true, ...(opacity ? { opacity } : {}) };
}

function requestOf(input: ScatterInput, bounds: Box): Request | undefined {
  const text = input.element.attributes["data-scatter"];
  return text === undefined ? rowRequest(input.element, bounds) : explicitRequest(text, input.name, input.warn);
}

function clampedCount(count: number, input: ScatterInput): number {
  const { leaves, limits, name, warn } = input;
  const vertices = leaves.reduce((total, leaf) => total + leaf.paths.reduce((sum, path) => sum + path.vertices.length, 0), 0);
  const limit = Math.max(1, Math.min(Math.floor(limits.shapes / leaves.length), Math.floor(limits.vertices / Math.max(1, vertices))));
  if (count <= limit) return count;
  warn(`"${name}": data-scatter ${count} exceeds what one layer can hold; ${limit} copies were drawn.`);
  return limit;
}

function copyOf(leaf: DrawnShape, from: Point, placement: Placement): DrawnShape {
  const { center, size, opacity } = placement;
  const matrix: Matrix = [size, 0, 0, size, center[0] - from[0] * size, center[1] - from[1] * size];
  return {
    ...leaf,
    paths: leaf.paths.map((path) => transformPath(path, matrix)),
    ...(leaf.stroke ? { stroke: { ...leaf.stroke, width: leaf.stroke.width * size } } : {}),
    opacity: leaf.opacity * opacity,
  };
}

function rangesOf(input: ScatterInput, request: Request): Ranges {
  const { element, name, warn } = input;
  return {
    area: areaOf(input),
    size: sizeRange(element, name, warn),
    opacity: opacityRange(element, name, warn, request.opacity ?? DEFAULT_OPACITY),
  };
}

function placeCopies(leaves: readonly DrawnShape[], bounds: Box, plan: Plan): DrawnShape[] {
  const { area, size: [minSize, maxSize], opacity: [minOpacity, maxOpacity] } = plan.ranges;
  const radius = Math.max(bounds[2], bounds[3]) / 2;
  const floor = radius > 0 ? 1 / radius : 0;
  const random = generator(plan.seed);
  const from: Point = [bounds[0] + bounds[2] / 2, bounds[1] + bounds[3] / 2];
  const copies: DrawnShape[] = [];
  for (let index = 0; index < plan.count; index += 1) {
    const center: Point = [area[0] + random() * area[2], area[1] + random() * area[3]];
    const size = Math.max(floor, minSize + random() * (maxSize - minSize));
    const opacity = minOpacity + random() * (maxOpacity - minOpacity);
    for (const leaf of leaves) copies.push(copyOf(leaf, from, { center, size, opacity }));
  }
  return copies;
}

/** The layer's leaves replaced by seeded copies of its mark, or undefined when the group asks for no scatter. */
export function scatterLeaves(input: ScatterInput): Scattered | undefined {
  const { element, leaves, name, warn } = input;
  const bounds = markBounds(leaves);
  const request = bounds ? requestOf(input, bounds) : undefined;
  if (!bounds || !request) return undefined;
  if (request.fromRow) warn(`"${name}": a row of ${request.count} dots was spread into a field; use data-scatter="${request.count}" for scattered stars, particles or dust.`);
  else if (element.attributes["data-repeat"] !== undefined) warn(`"${name}": data-repeat was ignored because data-scatter is set.`);
  const count = clampedCount(request.count, input);
  return { leaves: placeCopies(leaves, bounds, { count, ranges: rangesOf(input, request), seed: seedOf(name) }), count };
}
