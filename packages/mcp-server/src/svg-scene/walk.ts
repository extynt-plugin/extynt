// Walks one layer's SVG subtree and collects every drawable leaf in document
// order (back to front), with its transform, style, opacity and paint already
// resolved into composition pixels.
import type { ClipPathDefinition, FilterDefinition } from "./effects.js";
import { parseColor, type Rgb } from "./color.js";
import { gradientMidColor, paintReference, resolveRamp, type GradientDefinition, type ResolvedRamp } from "./gradients.js";
import type { ScenePath } from "./path.js";
import { elementPaths, pathBounds, SHAPE_ELEMENTS, transformPath } from "./shapes.js";
import { computeStyle, declaredProperties, displayed, ownOpacity, type ComputedStyle, type CssRule } from "./style.js";
import { multiply, parseTransform, strokeScale, translation, type Matrix, type Point } from "./transform.js";
import type { SvgElement } from "./xml.js";

/** What the walk reads from the whole document: style rules, gradient, filter, clip path and id tables, the viewport, and the set the walk adds its warnings to. */
export interface WalkContext {
  readonly rules: readonly CssRule[];
  readonly gradients: ReadonlyMap<string, GradientDefinition>;
  readonly ids: ReadonlyMap<string, SvgElement>;
  readonly viewport: Point;
  readonly warnings: Set<string>;
  readonly filters: ReadonlyMap<string, FilterDefinition>;
  readonly clipPaths: ReadonlyMap<string, ClipPathDefinition>;
}

/** The state an element hands to what it contains: its transform to composition pixels, computed style, accumulated opacity and nesting depth. */
export interface Inherited { readonly matrix: Matrix; readonly style: ComputedStyle; readonly opacity: number; readonly depth: number }

interface DrawnPaint { readonly color: Rgb; readonly opacity: number; readonly gradient?: { readonly id: string; readonly ramp: ResolvedRamp } }
/** One drawable leaf in composition pixels: its paths, fill, stroke and accumulated opacity. */
export interface DrawnShape {
  readonly name: string;
  readonly paths: ScenePath[];
  readonly fill?: DrawnPaint & { readonly rule: ComputedStyle["fillRule"] };
  readonly stroke?: DrawnPaint & { readonly width: number; readonly cap: ComputedStyle["strokeLinecap"]; readonly join: ComputedStyle["strokeLinejoin"]; readonly miterLimit: number };
  readonly opacity: number;
}

const NON_RENDERING = new Set(["defs", "style", "title", "desc", "metadata", "lineargradient", "radialgradient", "clippath", "mask", "pattern", "filter", "symbol", "marker", "script"]);
const CONTAINERS = new Set(["g", "a", "switch", "svg"]);
const UNDRAWN: Readonly<Record<string, string>> = {
  text: "SVG text is not drawn; add titles and labels as After Effects text layers instead.",
  image: "Embedded images are not drawn; a design is vector shapes only.",
  foreignobject: "foreignObject content is not drawn.",
};
const UNSUPPORTED_PROPERTIES: Readonly<Record<string, string>> = {
  mask: "SVG luminance masks are not applied; draw the visible part as its own path instead.",
  "stroke-dasharray": "Dashed strokes are drawn solid.",
};
const LAYER_PROPERTIES = new Set(["clip-path", "filter", "mix-blend-mode"]);

type WarningScope = "inner" | "layer" | "none";

const ENTER_MODES = {
  inner: { countOpacity: true, scope: "inner" },
  wrapper: { countOpacity: true, scope: "none" },
  layer: { countOpacity: false, scope: "layer" },
} as const satisfies Readonly<Record<string, { countOpacity: boolean; scope: WarningScope }>>;

type EnterMode = keyof typeof ENTER_MODES;

/** The name a leaf or layer shows: its data-name, label or id, else the fallback. */
export function leafName(element: SvgElement, fallback: string): string {
  const attributes = element.attributes;
  const named = attributes["data-name"] ?? attributes["inkscape:label"] ?? attributes["aria-label"] ?? attributes.id;
  return (named?.trim() || fallback).replace(/\s+/gu, " ").slice(0, 120);
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && !["none", "normal", ""].includes(value.trim().toLowerCase());
}

function noteUnsupported(declared: Readonly<Record<string, string>>, context: WalkContext, scope: WarningScope): void {
  if (scope === "none") return;
  for (const [property, message] of Object.entries(UNSUPPORTED_PROPERTIES)) {
    if (isSet(declared[property])) context.warnings.add(message);
  }
  if (scope !== "inner") return;
  for (const property of LAYER_PROPERTIES) {
    if (isSet(declared[property])) context.warnings.add(`${property} on an inner SVG element is not applied; give that part its own top-level group to apply it as a layer setting.`);
  }
}

function solidPaint(paint: string, style: ComputedStyle, opacity: number): DrawnPaint | undefined {
  const text = paint.trim().toLowerCase() === "currentcolor" ? style.color : paint;
  const color = parseColor(text);
  return color && color.alpha * opacity > 0 ? { color: color.rgb, opacity: color.alpha * opacity } : undefined;
}

interface PaintInput { readonly opacity: number; readonly userPaths: ScenePath[]; readonly matrix: Matrix; readonly context: WalkContext }

function gradientPaint(id: string, input: PaintInput): DrawnPaint | undefined {
  const gradient = input.context.gradients.get(id);
  const box = pathBounds([{ paths: input.userPaths, pad: 0 }]);
  if (!gradient || !box) return undefined;
  return { color: gradientMidColor(gradient), opacity: input.opacity, gradient: { id, ramp: resolveRamp(gradient, box, input.matrix, input.context.viewport) } };
}

function resolvePaint(paint: string, style: ComputedStyle, input: PaintInput): DrawnPaint | undefined {
  const trimmed = paint.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return undefined;
  const reference = paintReference(trimmed);
  if (!reference) return solidPaint(trimmed, style, input.opacity);
  const gradient = gradientPaint(reference, input);
  if (gradient) return gradient;
  const fallback = trimmed.replace(/^url\([^)]*\)/u, "").trim();
  if (fallback) return solidPaint(fallback, style, input.opacity);
  input.context.warnings.add(`Paint ${trimmed} names no gradient this design defines (patterns are not drawn), so that paint was left out.`);
  return undefined;
}

function drawnLeaf(element: SvgElement, inherited: Inherited, context: WalkContext, name: string): DrawnShape | undefined {
  const userPaths = elementPaths(element);
  if (!userPaths.length || !inherited.style.visible) return undefined;
  const style = inherited.style, matrix = inherited.matrix, shared = { userPaths, matrix, context };
  const fillPaint = resolvePaint(style.fill, style, { ...shared, opacity: style.fillOpacity });
  const strokeWidth = style.strokeWidth * strokeScale(matrix);
  const strokePaint = strokeWidth > 0 ? resolvePaint(style.stroke, style, { ...shared, opacity: style.strokeOpacity }) : undefined;
  if (!fillPaint && !strokePaint) return undefined;
  return {
    name,
    paths: userPaths.map((path) => transformPath(path, matrix)),
    ...(fillPaint ? { fill: { ...fillPaint, rule: style.fillRule } } : {}),
    ...(strokePaint ? { stroke: { ...strokePaint, width: strokeWidth, cap: style.strokeLinecap, join: style.strokeLinejoin, miterLimit: style.strokeMiterlimit } } : {}),
    opacity: inherited.opacity,
  };
}

function useTarget(element: SvgElement, context: WalkContext): SvgElement | undefined {
  const reference = element.attributes.href ?? element.attributes["xlink:href"];
  return reference?.startsWith("#") ? context.ids.get(reference.slice(1)) : undefined;
}

/** The element's own frame: its transform, and for <use> the x/y offset it places its reference at. */
export function ownMatrix(element: SvgElement): Matrix {
  const own = parseTransform(element.attributes.transform);
  if (element.name !== "use") return own;
  const x = Number.parseFloat(element.attributes.x ?? "0"), y = Number.parseFloat(element.attributes.y ?? "0");
  return multiply(own, translation(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0));
}

/** The inherited state an element passes to what it contains, or undefined when it renders nothing. */
export function enter(element: SvgElement, inherited: Inherited, context: WalkContext, mode: EnterMode): Inherited | undefined {
  if (NON_RENDERING.has(element.name)) return undefined;
  const declared = declaredProperties(element, context.rules);
  if (!displayed(declared)) return undefined;
  const { countOpacity, scope } = ENTER_MODES[mode];
  noteUnsupported(declared, context, scope);
  return {
    matrix: multiply(inherited.matrix, ownMatrix(element)),
    style: computeStyle(inherited.style, declared),
    opacity: countOpacity ? inherited.opacity * ownOpacity(declared) : inherited.opacity,
    depth: inherited.depth + 1,
  };
}

function childrenOf(element: SvgElement, context: WalkContext): readonly SvgElement[] {
  if (element.name !== "use") return element.children;
  const target = useTarget(element, context);
  if (target) return target.name === "symbol" ? target.children : [target];
  context.warnings.add(`A <use> references ${element.attributes.href ?? element.attributes["xlink:href"] ?? "nothing"}, which this design does not define.`);
  return [];
}

function collectChildren(element: SvgElement, state: Inherited, context: WalkContext, into: DrawnShape[]): void {
  for (const child of childrenOf(element, context)) {
    const childState = enter(child, state, context, "inner");
    if (childState) collectLeaves(child, childState, context, into);
  }
}

/** Collects the drawable leaves under `element`, whose own state is already `state`. */
export function collectLeaves(element: SvgElement, state: Inherited, context: WalkContext, into: DrawnShape[]): void {
  if (state.depth > 64) return;
  if (SHAPE_ELEMENTS.has(element.name)) {
    const leaf = drawnLeaf(element, state, context, leafName(element, `${element.name} ${into.length + 1}`));
    if (leaf) into.push(leaf);
    return;
  }
  const note = UNDRAWN[element.name];
  if (note) context.warnings.add(note);
  else if (CONTAINERS.has(element.name) || element.name === "use") collectChildren(element, state, context, into);
}

/** Whether the element can draw anything (it is not a definition such as defs, gradients or clip paths). */
export function isRendering(element: SvgElement): boolean {
  return !NON_RENDERING.has(element.name);
}
