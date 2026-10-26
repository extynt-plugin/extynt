// Works out the composition size and the matrix that maps SVG user space into it from the root element's width, height, viewBox and preserveAspectRatio.
import { CONVERTER_LIMITS, type Matrix } from "./svg-convert-types.js";
import { parseLength, type Viewport } from "./svg-geometry.js";
import { parseNumbers } from "./svg-matrix.js";
import type { SvgNode } from "./svg-node.js";

/** Where the SVG lands in the composition: its pixel size, the user-space matrix and the viewport percentage lengths resolve against. */
export interface Frame {
  size: [number, number];
  matrix: Matrix;
  viewport: Viewport;
}

type FrameResult = { ok: true; frame: Frame } | { ok: false; reason: string };

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Size = [number, number];

const ALIGNMENT: ReadonlyMap<string, number> = new Map([["min", 0], ["mid", 0.5], ["max", 1]]);
const DEFAULT_ASPECT = "xMidYMid meet";

function isFour(numbers: readonly number[]): numbers is [number, number, number, number] {
  return numbers.length === 4;
}

function readViewBox(text: string | undefined): ViewBox | undefined {
  const numbers = text === undefined ? undefined : parseNumbers(text);
  if (!numbers || !isFour(numbers)) return undefined;
  const [x, y, width, height] = numbers;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

function absoluteLength(text: string | undefined): number | undefined {
  if (text === undefined || text.includes("%")) return undefined;
  const value = parseLength(text, 0);
  return value !== undefined && value > 0 ? value : undefined;
}

function dimensions(width: number | undefined, height: number | undefined, box: ViewBox | undefined): Size | undefined {
  if (width !== undefined && height !== undefined) return [width, height];
  if (!box) return undefined;
  if (width !== undefined) return [width, (width * box.height) / box.width];
  if (height !== undefined) return [(height * box.width) / box.height, height];
  return [box.width, box.height];
}

function alignmentFactor(align: string, from: number, to: number): number {
  return ALIGNMENT.get(align.slice(from, to)) ?? 0.5;
}

function boxMatrix(box: ViewBox, size: Size, aspect: string | undefined): Matrix {
  const sx = size[0] / box.width;
  const sy = size[1] / box.height;
  const parts = (aspect ?? DEFAULT_ASPECT).trim().split(/\s+/u).filter((part) => part !== "defer");
  const align = (parts[0] ?? "xMidYMid").toLowerCase();
  if (align === "none") return [sx, 0, 0, sy, -box.x * sx, -box.y * sy];
  const scale = parts[1]?.toLowerCase() === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
  const fx = alignmentFactor(align, 1, 4);
  const fy = alignmentFactor(align, 5, 8);
  return [scale, 0, 0, scale, fx * (size[0] - box.width * scale) - box.x * scale, fy * (size[1] - box.height * scale) - box.y * scale];
}

function compSize(raw: Size): Size {
  return [Math.max(1, Math.round(raw[0])), Math.max(1, Math.round(raw[1]))];
}

function frameOf(root: SvgNode, box: ViewBox | undefined, size: Size): Frame {
  return {
    size,
    matrix: box ? boxMatrix(box, size, root.attrs.preserveAspectRatio) : [1, 0, 0, 1, 0, 0],
    viewport: box ? { width: box.width, height: box.height } : { width: size[0], height: size[1] },
  };
}

/** The comp size and the matrix that maps SVG user space into it ("slice" crops at the comp edge, as the SVG viewport would), or the reason the SVG gives no size. */
export function readFrame(root: SvgNode): FrameResult {
  const box = readViewBox(root.attrs.viewBox);
  const raw = dimensions(absoluteLength(root.attrs.width), absoluteLength(root.attrs.height), box);
  if (!raw) return { ok: false, reason: "the SVG has no usable width, height or viewBox, so there is no comp size to draw into" };
  const size = compSize(raw);
  const limit = CONVERTER_LIMITS.maxCompSize;
  if (size[0] > limit || size[1] > limit) return { ok: false, reason: `the SVG size ${size[0]} x ${size[1]} exceeds the ${limit} px comp limit` };
  return { ok: true, frame: frameOf(root, box, size) };
}
