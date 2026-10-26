// Resolves the inherited SVG presentation attributes (paints, opacities, stroke geometry) that the converter reads for each element.
import { parseColour } from "./svg-colour.js";
import type { NoteSink, Rgba } from "./svg-convert-types.js";
import type { SvgAttributes, SvgNode } from "./svg-node.js";

export type Paint = { readonly kind: "none" } | { readonly kind: "colour"; readonly colour: Rgba; readonly gradient: boolean };

/** The inherited presentation attributes the converter reads. */
export interface Style {
  readonly fill: Paint;
  readonly stroke: Paint;
  readonly strokeWidth: number;
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
  readonly evenOdd: boolean;
  readonly cap: 1 | 2 | 3;
  readonly join: 1 | 2 | 3;
  readonly miterLimit: number;
  readonly dashed: boolean;
  readonly color: Rgba;
}

/** What paint resolution needs from the document: elements by id, and where to record what it approximates or skips. */
export interface StyleContext {
  readonly ids: ReadonlyMap<string, SvgNode>;
  readonly notes: NoteSink;
}

type Numbers = Pick<Style, "strokeWidth" | "fillOpacity" | "strokeOpacity" | "miterLimit">;
type Keywords = Pick<Style, "evenOdd" | "cap" | "join" | "dashed">;

const BLACK: Rgba = { rgb: [0, 0, 0], alpha: 1 };
const NO_PAINT: Paint = { kind: "none" };
const CAPS: ReadonlyMap<string, 1 | 2 | 3> = new Map<string, 1 | 2 | 3>([["butt", 1], ["round", 2], ["square", 3]]);
const JOINS: ReadonlyMap<string, 1 | 2 | 3> = new Map<string, 1 | 2 | 3>([["miter", 1], ["miter-clip", 1], ["arcs", 1], ["round", 2], ["bevel", 3]]);
const FILL_RULES: ReadonlyMap<string, boolean> = new Map([["evenodd", true], ["nonzero", false]]);
const GRADIENTS = new Set(["lineargradient", "radialgradient"]);
const PAINT_REFERENCE = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/iu;
const MAX_HREF_DEPTH = 8;
const MAX_MITER_LIMIT = 100;

/** The style at the document root before any element overrides it: black fill, no stroke. */
export const DEFAULT_STYLE: Style = {
  fill: { kind: "colour", colour: BLACK, gradient: false },
  stroke: NO_PAINT,
  strokeWidth: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  evenOdd: false,
  cap: 1,
  join: 1,
  miterLimit: 4,
  dashed: false,
  color: BLACK,
};

/** An opacity as 0-1; a percentage is accepted, anything unparseable is undefined. */
export function parseOpacity(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = text.trim().endsWith("%") ? parseFloat(text) / 100 : Number(text);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function firstStopColour(gradient: SvgNode, style: Style): Rgba | undefined {
  const stop = gradient.children.find((child) => child.name === "stop");
  if (!stop) return undefined;
  const text = stop.attrs["stop-color"] ?? "black";
  const colour = text.trim().toLowerCase() === "currentcolor" ? style.color : parseColour(text);
  return colour ? { rgb: colour.rgb, alpha: colour.alpha * (parseOpacity(stop.attrs["stop-opacity"]) ?? 1) } : undefined;
}

function hrefTarget(node: SvgNode, ids: ReadonlyMap<string, SvgNode>): SvgNode | undefined {
  const href = node.attrs.href;
  return href?.startsWith("#") ? ids.get(href.slice(1)) : undefined;
}

function gradientColour(start: SvgNode, style: Style, ids: ReadonlyMap<string, SvgNode>): Rgba | undefined {
  let node: SvgNode | undefined = start;
  for (let depth = 0; node && GRADIENTS.has(node.name) && depth < MAX_HREF_DEPTH; depth += 1) {
    const own = firstStopColour(node, style);
    if (own) return own;
    node = hrefTarget(node, ids);
  }
  return undefined;
}

function referencedPaint(id: string, fallback: string, style: Style, context: StyleContext): Paint | undefined {
  const target = context.ids.get(id);
  if (target && GRADIENTS.has(target.name)) {
    const colour = gradientColour(target, style, context.ids);
    return colour ? { kind: "colour", colour, gradient: true } : NO_PAINT;
  }
  if (fallback) return parsePaint(fallback, style, context);
  context.notes.skip(target ? `${target.name}-paint` : "missing-paint-reference");
  return NO_PAINT;
}

function parsePaint(text: string, style: Style, context: StyleContext): Paint | undefined {
  const value = text.trim();
  const lower = value.toLowerCase();
  if (lower === "none") return NO_PAINT;
  if (lower === "currentcolor") return { kind: "colour", colour: style.color, gradient: false };
  const reference = PAINT_REFERENCE.exec(value);
  if (reference) return referencedPaint(reference[1] ?? "", (reference[2] ?? "").trim(), style, context);
  const colour = parseColour(value);
  if (!colour) {
    context.notes.approximate("unsupported-colour");
    return undefined;
  }
  return { kind: "colour", colour, gradient: false };
}

function paintAttribute(text: string | undefined, style: Style, context: StyleContext): Paint | undefined {
  return text === undefined ? undefined : parsePaint(text, style, context);
}

function withPaints(parent: Style, attrs: SvgAttributes, context: StyleContext): Style {
  const colorText = attrs.color;
  const color = colorText === undefined ? undefined : parseColour(colorText);
  const base = color ? { ...parent, color } : parent;
  const fill = paintAttribute(attrs.fill, base, context);
  const stroke = paintAttribute(attrs.stroke, base, context);
  return { ...base, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) };
}

function numberAttribute(attrs: SvgAttributes, name: string, min: number): number | undefined {
  const text = attrs[name];
  const value = text === undefined ? NaN : parseFloat(text);
  return Number.isFinite(value) && value >= min ? value : undefined;
}

function numbersOf(style: Style, attrs: SvgAttributes): Numbers {
  const limit = numberAttribute(attrs, "stroke-miterlimit", 1);
  return {
    strokeWidth: numberAttribute(attrs, "stroke-width", 0) ?? style.strokeWidth,
    fillOpacity: parseOpacity(attrs["fill-opacity"]) ?? style.fillOpacity,
    strokeOpacity: parseOpacity(attrs["stroke-opacity"]) ?? style.strokeOpacity,
    miterLimit: limit === undefined ? style.miterLimit : Math.min(MAX_MITER_LIMIT, limit),
  };
}

function keyword(attrs: SvgAttributes, name: string): string {
  return (attrs[name] ?? "").trim().toLowerCase();
}

function keywordsOf(style: Style, attrs: SvgAttributes): Keywords {
  const dashes = attrs["stroke-dasharray"];
  return {
    evenOdd: FILL_RULES.get(keyword(attrs, "fill-rule")) ?? style.evenOdd,
    cap: CAPS.get(keyword(attrs, "stroke-linecap")) ?? style.cap,
    join: JOINS.get(keyword(attrs, "stroke-linejoin")) ?? style.join,
    dashed: dashes === undefined ? style.dashed : !["", "none"].includes(keyword(attrs, "stroke-dasharray")),
  };
}

/** The style an element sees: its parent's, overridden by the element's own presentation attributes. A gradient paint is read as the gradient's first stop, following href to the gradient that carries the stops. */
export function inheritStyle(parent: Style, attrs: SvgAttributes, context: StyleContext): Style {
  const painted = withPaints(parent, attrs, context);
  return { ...painted, ...numbersOf(painted, attrs), ...keywordsOf(painted, attrs) };
}
