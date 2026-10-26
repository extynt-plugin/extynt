// SVG gradients reduced to what After Effects can script: a two-colour ramp
// (Gradient Ramp) with its start and end in composition pixels. Shape-layer
// gradient colour stops cannot be written by script, so a gradient keeps its
// first and last stop, and a flattened fallback keeps its midpoint colour.
import { mixRgb, parseColor, type Rgb } from "./color.js";
import type { Bounds } from "./shapes.js";
import { applyPoint, IDENTITY, multiply, parseTransform, type Matrix, type Point } from "./transform.js";
import type { SvgElement } from "./xml.js";

interface GradientStop { readonly offset: number; readonly color: Rgb; readonly opacity: number }

/** A gradient with its href chain resolved: kind, units, geometry attributes, transform and stops. */
export interface GradientDefinition {
  readonly id: string;
  readonly kind: "linear" | "radial";
  readonly boundingBoxUnits: boolean;
  readonly attributes: Readonly<Record<string, string>>;
  readonly transform: Matrix;
  readonly stops: readonly GradientStop[];
}

/** A gradient reduced to a two-colour ramp in composition pixels. */
export interface ResolvedRamp { readonly kind: "linear" | "radial"; readonly start: Point; readonly end: Point; readonly startColor: Rgb; readonly endColor: Rgb; readonly translucentStops: boolean }

const GRADIENT_ATTRIBUTES = ["x1", "y1", "x2", "y2", "cx", "cy", "r", "gradientUnits", "gradientTransform"] as const;

function hrefOf(element: SvgElement): string | undefined {
  const reference = element.attributes.href ?? element.attributes["xlink:href"];
  return reference?.startsWith("#") ? reference.slice(1) : undefined;
}

function unitInterval(text: string, fallback: number): number {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, text.trim().endsWith("%") ? value / 100 : value));
}

function stopOf(element: SvgElement): GradientStop | undefined {
  const style = element.attributes.style ? parseStopStyle(element.attributes.style) : {};
  const property = (name: string, fallback: string) => style[name] ?? element.attributes[name] ?? fallback;
  const color = parseColor(property("stop-color", "black"));
  if (!color) return undefined;
  return { offset: unitInterval(element.attributes.offset ?? "0", 0), color: color.rgb, opacity: unitInterval(property("stop-opacity", "1"), 1) * color.alpha };
}

function parseStopStyle(text: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of text.split(";")) { const colon = part.indexOf(":"); if (colon > 0) declarations[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim(); }
  return declarations;
}

function collectGradientElements(element: SvgElement, into: Map<string, SvgElement>): void {
  if ((element.name === "lineargradient" || element.name === "radialgradient") && element.attributes.id) into.set(element.attributes.id, element);
  for (const child of element.children) collectGradientElements(child, into);
}

function hrefChain(id: string, elements: ReadonlyMap<string, SvgElement>): SvgElement[] {
  const chain: SvgElement[] = [];
  let next: string | undefined = id;
  while (next && chain.length < 8) {
    const element = elements.get(next);
    if (!element || chain.includes(element)) break;
    chain.push(element);
    next = hrefOf(element);
  }
  return chain;
}

function chainAttributes(chain: readonly SvgElement[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const name of GRADIENT_ATTRIBUTES) {
    const value = chain.map((element) => element.attributes[name]).find((held) => held !== undefined);
    if (value !== undefined) attributes[name] = value;
  }
  return attributes;
}

function resolveGradient(id: string, elements: ReadonlyMap<string, SvgElement>): GradientDefinition | undefined {
  const chain = hrefChain(id, elements);
  const own = chain[0];
  if (!own) return undefined;
  const attributes = chainAttributes(chain);
  const stopsHolder = chain.find((element) => element.children.some((child) => child.name === "stop"));
  const stops = (stopsHolder?.children ?? []).filter((child) => child.name === "stop").map(stopOf).filter((stop): stop is GradientStop => !!stop);
  return { id, kind: own.name === "radialgradient" ? "radial" : "linear", boundingBoxUnits: attributes.gradientUnits !== "userSpaceOnUse", attributes, transform: parseTransform(attributes.gradientTransform), stops };
}

/** Every gradient with at least one stop, by id. */
export function collectGradients(root: SvgElement): Map<string, GradientDefinition> {
  const elements = new Map<string, SvgElement>();
  collectGradientElements(root, elements);
  const gradients = new Map<string, GradientDefinition>();
  for (const id of elements.keys()) { const resolved = resolveGradient(id, elements); if (resolved && resolved.stops.length) gradients.set(id, resolved); }
  return gradients;
}

/** The id in a `url(#id)` paint value, or undefined. */
export function paintReference(paint: string): string | undefined {
  return /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/u.exec(paint.trim())?.[1];
}

const FALLBACK_COLOR: Rgb = [0, 0, 0];

function colorOf(stop: GradientStop | undefined): Rgb {
  return stop?.color ?? FALLBACK_COLOR;
}

function colorAt(stops: readonly GradientStop[], offset: number): Rgb {
  const sorted = [...stops].sort((left, right) => left.offset - right.offset);
  const after = sorted.findIndex((stop) => stop.offset >= offset);
  if (after < 0) return colorOf(sorted.at(-1));
  const left = sorted[after - 1], right = sorted[after];
  if (!left || !right) return colorOf(right);
  const span = right.offset - left.offset;
  return mixRgb(left.color, right.color, span > 0 ? (offset - left.offset) / span : 0);
}

/** The single colour a gradient flattens to. */
export function gradientMidColor(gradient: GradientDefinition): Rgb { return colorAt(gradient.stops, 0.5); }

function coordinate(value: string | undefined, fallback: number, boundingBox: boolean, extent: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (value.trim().endsWith("%")) return boundingBox ? parsed / 100 : (parsed / 100) * extent;
  return parsed;
}

interface RampGeometry { start: Point; end: Point }

function rampGeometry(gradient: GradientDefinition, viewport: Point): RampGeometry {
  const box = gradient.boundingBoxUnits, a = gradient.attributes;
  const unit = (key: string, fallback: number, extent: number) => coordinate(a[key], fallback, box, extent);
  if (gradient.kind === "radial") {
    const cx = unit("cx", box ? 0.5 : viewport[0] / 2, viewport[0]), cy = unit("cy", box ? 0.5 : viewport[1] / 2, viewport[1]), r = unit("r", box ? 0.5 : Math.hypot(viewport[0], viewport[1]) / (2 * Math.SQRT2), viewport[0]);
    return { start: [cx, cy], end: [cx + r, cy] };
  }
  return { start: [unit("x1", 0, viewport[0]), unit("y1", 0, viewport[1])], end: [unit("x2", box ? 1 : viewport[0], viewport[0]), unit("y2", 0, viewport[1])] };
}

/** Resolves a gradient for one painted element; `userBox` is its bounds in its own user space and `toCanvas` maps that space to composition pixels. */
export function resolveRamp(gradient: GradientDefinition, userBox: Bounds, toCanvas: Matrix, viewport: Point): ResolvedRamp {
  const geometry = rampGeometry(gradient, viewport);
  const boxMatrix: Matrix = gradient.boundingBoxUnits ? [userBox[2], 0, 0, userBox[3], userBox[0], userBox[1]] : IDENTITY;
  const matrix = multiply(toCanvas, multiply(boxMatrix, gradient.transform));
  const sorted = [...gradient.stops].sort((left, right) => left.offset - right.offset);
  return {
    kind: gradient.kind,
    start: applyPoint(matrix, geometry.start),
    end: applyPoint(matrix, geometry.end),
    startColor: colorOf(sorted[0]),
    endColor: colorOf(sorted.at(-1)),
    translucentStops: sorted.some((stop) => stop.opacity < 0.999),
  };
}
