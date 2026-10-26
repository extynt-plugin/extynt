// Walks a parsed SVG in document order, carrying transform, style and opacity down, and emits the converted shapes with a size budget.
import { CONVERTER_LIMITS, type ConvertedShape, type ConvertedStroke, type Matrix, type Rgb } from "./svg-convert-types.js";
import { elementSubpaths, type Viewport } from "./svg-geometry.js";
import { IDENTITY, isUniformScale, meanScale, multiply, parseTransform } from "./svg-matrix.js";
import { elementName, type ContainerNode, type ShapeNode, type SvgNode } from "./svg-node.js";
import { inheritStyle, parseOpacity, type Paint, type Style, type StyleContext } from "./svg-style.js";
import { round4, toShapePath } from "./svg-subpath.js";

interface Budget {
  shapes: number;
  points: number;
  error: string | undefined;
}

/** Everything a walk shares: style lookups, the viewport, the size budget and the count used for default shape names. */
export interface WalkContext extends StyleContext {
  view: Viewport;
  budget: Budget;
  named: number;
}

/** What an element inherits from its ancestors. */
export interface WalkState {
  matrix: Matrix;
  style: Style;
  opacity: number;
}

type DrawnNode = ShapeNode | ContainerNode;
type SolidPaint = { color: Rgb; alpha: number };

const IGNORED_FEATURES = ["clip-path", "mask", "filter"];
const DEFAULT_MITER_LIMIT = 4;
const DEFAULT_JOIN = 1;
const DEFAULT_CAP = 1;

function percent(value: number): number {
  return round4(value * 100);
}

function paintColour(paint: Paint, context: WalkContext): SolidPaint | undefined {
  if (paint.kind === "none" || paint.colour.alpha <= 0) return undefined;
  if (paint.gradient) context.notes.approximate("gradient");
  return { color: paint.colour.rgb, alpha: paint.colour.alpha };
}

function buildFill(style: Style, context: WalkContext): ConvertedShape["fill"] {
  const paint = paintColour(style.fill, context);
  if (!paint) return undefined;
  const opacity = percent(paint.alpha * style.fillOpacity);
  return { color: paint.color, ...(opacity === 100 ? {} : { opacity }), ...(style.evenOdd ? { rule: 2 as const } : {}) };
}

function strokeOptions(style: Style): Pick<ConvertedStroke, "cap" | "join" | "miterLimit"> {
  return {
    ...(style.cap === DEFAULT_CAP ? {} : { cap: style.cap }),
    ...(style.join === DEFAULT_JOIN ? {} : { join: style.join }),
    ...(style.miterLimit === DEFAULT_MITER_LIMIT ? {} : { miterLimit: style.miterLimit }),
  };
}

function buildStroke(style: Style, matrix: Matrix, context: WalkContext): ConvertedShape["stroke"] {
  const width = round4(style.strokeWidth * meanScale(matrix));
  const paint = width > 0 ? paintColour(style.stroke, context) : undefined;
  if (!paint) return undefined;
  if (!isUniformScale(matrix)) context.notes.approximate("non-uniform-stroke-scale");
  if (style.dashed) context.notes.skip("stroke-dasharray");
  const opacity = percent(paint.alpha * style.strokeOpacity);
  return { color: paint.color, width, ...(opacity === 100 ? {} : { opacity }), ...strokeOptions(style) };
}

function shapeName(node: SvgNode, context: WalkContext): string {
  context.named += 1;
  return elementName(node, context.named);
}

function overBudget(shape: ConvertedShape, budget: Budget): string | undefined {
  const vertices = shape.paths.map((path) => path.vertices.length);
  budget.shapes += 1;
  budget.points += vertices.reduce((sum, count) => sum + count, 0);
  if (shape.paths.length > CONVERTER_LIMITS.maxPathsPerShape) return `one element has ${shape.paths.length} subpaths; the limit is ${CONVERTER_LIMITS.maxPathsPerShape}`;
  if (Math.max(...vertices) > CONVERTER_LIMITS.maxVerticesPerPath) return `one subpath has more than ${CONVERTER_LIMITS.maxVerticesPerPath} points`;
  if (budget.shapes > CONVERTER_LIMITS.maxShapes) return `the SVG has more than ${CONVERTER_LIMITS.maxShapes} shapes`;
  return budget.points > CONVERTER_LIMITS.maxPoints ? `the SVG has more than ${CONVERTER_LIMITS.maxPoints} points` : undefined;
}

function buildShape(node: ShapeNode, state: WalkState, context: WalkContext): ConvertedShape | undefined {
  const subpaths = elementSubpaths(node, context.view, context.notes);
  if (subpaths.length === 0) return undefined;
  const fill = node.name === "line" ? undefined : buildFill(state.style, context);
  const stroke = buildStroke(state.style, state.matrix, context);
  if (!fill && !stroke) return undefined;
  return {
    name: shapeName(node, context),
    paths: subpaths.map((sub) => toShapePath(sub, state.matrix)),
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(state.opacity < 1 ? { opacity: percent(state.opacity) } : {}),
  };
}

function emitShape(node: ShapeNode, state: WalkState, context: WalkContext, out: ConvertedShape[]): void {
  const shape = buildShape(node, state, context);
  if (!shape) return;
  context.budget.error ??= overBudget(shape, context.budget);
  out.push(shape);
}

function noteIgnoredFeatures(node: SvgNode, context: WalkContext): void {
  for (const feature of IGNORED_FEATURES) if (node.attrs[feature] !== undefined && node.attrs[feature] !== "none") context.notes.skip(feature);
}

function ownTransform(node: SvgNode, context: WalkContext): Matrix {
  const text = node.attrs.transform;
  if (text === undefined) return IDENTITY;
  const transform = parseTransform(text);
  if (!transform) context.notes.skip("invalid-transform");
  return transform ?? IDENTITY;
}

function childState(node: DrawnNode, state: WalkState, context: WalkContext): WalkState | undefined {
  if (node.attrs.display?.trim() === "none") return undefined;
  const transform = ownTransform(node, context);
  const opacity = parseOpacity(node.attrs.opacity) ?? 1;
  if (node.kind === "container" && opacity < 1) context.notes.approximate("group-opacity");
  return { matrix: multiply(state.matrix, transform), style: inheritStyle(state.style, node.attrs, context), opacity: state.opacity * opacity };
}

function describeElement(node: DrawnNode, state: WalkState, context: WalkContext, out: ConvertedShape[]): void {
  noteIgnoredFeatures(node, context);
  if (node.name === "svg") context.notes.approximate("nested-svg");
  if (node.kind === "shape" && node.attrs.visibility?.trim() !== "hidden") emitShape(node, state, context, out);
}

/** Appends the shapes of one element and everything inside it, in document order (first is rearmost). */
export function walkElement(node: SvgNode, parent: WalkState, context: WalkContext, out: ConvertedShape[]): void {
  if (context.budget.error) return;
  if (node.kind === "other") return;
  if (node.kind === "text") {
    context.notes.skip("text");
    return;
  }
  const state = childState(node, parent, context);
  if (!state) return;
  describeElement(node, state, context, out);
  for (const child of node.children) walkElement(child, state, context, out);
}
