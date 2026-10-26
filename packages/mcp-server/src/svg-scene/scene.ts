// Compiles a scene drawn as SVG into After Effects shape layers: one layer per top-level group, bottom to top in document order,
// each with its anchor at the part's centre (or where data-anchor puts it) and its paths drawn relative to that anchor.
import type { ShapePath, VectorShape, VectorShapeFill, VectorShapeStroke } from "@extynt/action-plan";
import type { Rgb } from "./color.js";
import type { ScenePath } from "./path.js";
import { elementPaths, pathBounds, SHAPE_ELEMENTS, transformPath, type Bounds } from "./shapes.js";
import { computeStyle, declaredProperties, DEFAULT_STYLE, ownOpacity, parseStyleSheets } from "./style.js";
import { collectGradients } from "./gradients.js";
import { collectClipPaths, collectFilters, effectScale, filterDescription, mapBlendMode, referenceId, resolveFilter, unsupportedFilterReason, type ClipPathDefinition } from "./effects.js";
import { applyPoint, multiply, parseTransform, type Matrix, type Point } from "./transform.js";
import { liftedAnchorAt, liftedPosition, liftLayerTransform, type LayerLift } from "./lift.js";
import { collectLeaves, enter, isRendering, leafName, ownMatrix, type DrawnShape, type Inherited, type WalkContext } from "./walk.js";
import { layerRepeat, type SceneLayerRepeat } from "./repeat.js";
import { scatterLeaves } from "./scatter.js";
import { parseSvgDocument, SvgSceneError, type SvgElement } from "./xml.js";

export const SCENE_LIMITS = { maxLayers: 48, maxShapesPerLayer: 256, maxVerticesPerLayer: 12_000, maxPathVertices: 1_000, maxPathsPerShape: 64 } as const;

interface SceneLayerRamp { readonly kind: "linear" | "radial"; readonly start: Point; readonly end: Point; readonly startColor: Rgb; readonly endColor: Rgb }
interface SceneLayerClipPath { readonly paths: ShapePath[] }
interface SceneLayerEffect { readonly kind: "gaussian-blur" | "drop-shadow" | "glow"; readonly blur?: { readonly stdDeviation: number }; readonly shadow?: { readonly dx: number; readonly dy: number; readonly stdDeviation: number; readonly floodColor: Rgb; readonly floodOpacity: number }; readonly glow?: { readonly stdDeviation: number } }
export interface CompiledSceneLayer {
  readonly name: string;
  readonly anchor: Point;
  readonly position?: Point;
  readonly rotation?: number;
  readonly scale?: number;
  readonly bounds: Bounds;
  readonly opacity: number;
  readonly shapes: VectorShape[];
  readonly ramp?: SceneLayerRamp;
  readonly clipPath?: SceneLayerClipPath;
  readonly effect?: SceneLayerEffect;
  readonly blendMode?: string;
  readonly repeat?: SceneLayerRepeat;
  readonly scatter?: number;
}
export interface CompiledScene { readonly width: number; readonly height: number; readonly layers: CompiledSceneLayer[]; readonly warnings: string[] }
export type SceneCompileResult = { ok: true; scene: CompiledScene } | { ok: false; code: string; message: string };
interface SceneCompileOptions { readonly width?: number; readonly height?: number }

type Box = [number, number, number, number];

const round = (value: number): number => Math.round(value * 100) / 100 || 0;
const roundPoint = (point: Point): Point => [round(point[0]), round(point[1])];

function positive(value: string | undefined): number | undefined {
  const parsed = value === undefined ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function numberPair(text: string): Point | undefined {
  const values = text.trim().split(/[\s,]+/u).map(Number);
  return values.length === 2 && values.every(Number.isFinite) ? [values[0] ?? 0, values[1] ?? 0] : undefined;
}

function finiteQuad(values: readonly number[]): Box | undefined {
  return values.length === 4 && values.every(Number.isFinite) ? [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0] : undefined;
}

function viewBoxOf(root: SvgElement): Box | undefined {
  const box = finiteQuad((root.attributes.viewBox ?? root.attributes.viewbox ?? "").trim().split(/[\s,]+/u).map(Number));
  return box && box[2] > 0 && box[3] > 0 ? box : undefined;
}

function alignOffset(alignment: string, available: number, used: number): number {
  if (alignment === "min") return 0;
  return alignment === "max" ? available - used : (available - used) / 2;
}

function ownSize(root: SvgElement, box: Box | undefined): [number | undefined, number | undefined] {
  return [positive(root.attributes.width) ?? box?.[2], positive(root.attributes.height) ?? box?.[3]];
}

function canvasBoxes(root: SvgElement, options: SceneCompileOptions): { width: number; height: number; user: Box } {
  const box = viewBoxOf(root);
  const [ownWidth, ownHeight] = ownSize(root, box);
  const width = options.width ?? ownWidth ?? 1920, height = options.height ?? ownHeight ?? 1080;
  return { width, height, user: box ?? [0, 0, ownWidth ?? width, ownHeight ?? height] };
}

function aspectMatrix(ratio: string, user: Box, size: Point): Matrix {
  const [width, height] = size;
  if (ratio.startsWith("none")) return [width / user[2], 0, 0, height / user[3], -user[0] * width / user[2], -user[1] * height / user[3]];
  const scale = (ratio.endsWith("slice") ? Math.max : Math.min)(width / user[2], height / user[3]);
  const align = /x(min|mid|max)y(min|mid|max)/u.exec(ratio) ?? ["", "mid", "mid"];
  return [scale, 0, 0, scale, alignOffset(align[1], width, user[2] * scale) - user[0] * scale, alignOffset(align[2], height, user[3] * scale) - user[1] * scale];
}

function canvasOf(root: SvgElement, options: SceneCompileOptions): { width: number; height: number; matrix: Matrix; viewport: Point } {
  const { width, height, user } = canvasBoxes(root, options);
  const ratio = (root.attributes.preserveAspectRatio ?? "xMidYMid meet").trim().toLowerCase();
  return { width, height, matrix: aspectMatrix(ratio, user, [width, height]), viewport: [user[2], user[3]] };
}

function collectIds(element: SvgElement, into: Map<string, SvgElement>): void {
  if (element.attributes.id && !into.has(element.attributes.id)) into.set(element.attributes.id, element);
  for (const child of element.children) collectIds(child, into);
}

function named(element: SvgElement): boolean {
  return ["id", "data-name", "inkscape:label", "aria-label"].some((key) => !!element.attributes[key]?.trim());
}

interface LayerSource { readonly element: SvgElement; readonly parent: Inherited }

function renderingChildren(element: SvgElement, state: Inherited, context: WalkContext): SvgElement[] {
  return element.children.filter((child) => isRendering(child) && enter(child, state, context, "wrapper") !== undefined);
}

function wrapperHasLayerFeatures(element: SvgElement, context: WalkContext): boolean {
  const declared = declaredProperties(element, context.rules);
  const features = ["filter", "clip-path", "mix-blend-mode", "mask", "stroke-dasharray"];
  return ownOpacity(declared) < 1 || features.some((property) => {
    const value = declared[property]?.trim().toLowerCase();
    return !!value && value !== "none" && value !== "normal";
  });
}

function wrapperEntry(container: SvgElement, state: Inherited, context: WalkContext): { element: SvgElement; state: Inherited } | undefined {
  const children = renderingChildren(container, state, context);
  const only = children.length === 1 ? children[0] : undefined;
  if (!only || only.name !== "g" || named(only) || wrapperHasLayerFeatures(only, context) || renderingChildren(only, state, context).length < 2) return undefined;
  const entered = enter(only, state, context, "wrapper");
  return entered && { element: only, state: entered };
}

function layerSources(root: SvgElement, rootState: Inherited, context: WalkContext): LayerSource[] {
  let container = root, state = rootState;
  for (let depth = 0; depth < 4; depth += 1) {
    const inner = wrapperEntry(container, state, context);
    if (!inner) break;
    container = inner.element;
    state = inner.state;
  }
  return renderingChildren(container, state, context).map((element) => ({ element, parent: state }));
}

const ANCHOR_KEYWORDS: Readonly<Record<string, Point>> = {
  center: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5],
  "top-left": [0, 0], "top-right": [1, 0], "bottom-left": [0, 1], "bottom-right": [1, 1],
  "top-center": [0.5, 0], "bottom-center": [0.5, 1], "center-left": [0, 0.5], "center-right": [1, 0.5], "left-center": [0, 0.5], "right-center": [1, 0.5],
};

function anchorOf(value: string | undefined, bounds: Bounds, rootMatrix: Matrix, warn: (message: string) => void): Point {
  const keyword = ANCHOR_KEYWORDS[(value ?? "center").trim().toLowerCase()];
  if (keyword) return [bounds[0] + bounds[2] * keyword[0], bounds[1] + bounds[3] * keyword[1]];
  const pair = numberPair(value ?? "");
  if (pair) return applyPoint(rootMatrix, pair);
  warn(`data-anchor "${value}" is neither a keyword (center, top, bottom-center, …) nor "x y"; the part's centre was used.`);
  return [bounds[0] + bounds[2] / 2, bounds[1] + bounds[3] / 2];
}

type LiftedAnchorInput = { value: string | undefined; bounds: Bounds; rootMatrix: Matrix; lift: LayerLift; warn: (message: string) => void };

function liftedAnchor({ value, bounds, rootMatrix, lift, warn }: LiftedAnchorInput): Point {
  if (value === undefined) return lift.origin;
  const pair = ANCHOR_KEYWORDS[value.trim().toLowerCase()] ? undefined : numberPair(value);
  return pair ? liftedAnchorAt(lift, applyPoint(rootMatrix, pair)) : anchorOf(value, bounds, rootMatrix, warn);
}

function liftFields(lift: LayerLift | undefined, anchor: Point): Pick<CompiledSceneLayer, "position" | "rotation" | "scale"> {
  if (!lift) return {};
  const position = roundPoint(liftedPosition(lift, anchor)), rotation = round(lift.rotation), scale = round(lift.scale * 100);
  return { ...(position[0] === anchor[0] && position[1] === anchor[1] ? {} : { position }), ...(rotation !== 0 ? { rotation } : {}), ...(scale !== 100 ? { scale } : {}) };
}

function samePoint(left: Point, right: Point): boolean { return Math.abs(left[0] - right[0]) < 0.5 && Math.abs(left[1] - right[1]) < 0.5; }

function layerRamp(leaves: readonly DrawnShape[], anchor: Point, name: string, warnings: Set<string>): SceneLayerRamp | undefined {
  const [firstGradient] = leaves.flatMap((leaf) => [leaf.fill?.gradient, leaf.stroke?.gradient]).flatMap((gradient) => (gradient ? [gradient] : []));
  if (!firstGradient) return undefined;
  const first = firstGradient.ramp;
  const single = leaves.every((leaf) => !leaf.stroke && leaf.fill?.gradient && samePoint(leaf.fill.gradient.ramp.start, first.start) && samePoint(leaf.fill.gradient.ramp.end, first.end) && leaf.fill.gradient.id === firstGradient.id);
  if (!single) {
    warnings.add(`"${name}" mixes a gradient with other paint, so each gradient there was flattened to one colour; give a gradient-filled shape its own top-level group to keep its gradient.`);
    return undefined;
  }
  if (first.translucentStops) warnings.add(`"${name}": gradient stop opacity is not carried; the ramp is opaque.`);
  return { kind: first.kind, start: roundPoint([first.start[0] - anchor[0], first.start[1] - anchor[1]]), end: roundPoint([first.end[0] - anchor[0], first.end[1] - anchor[1]]), startColor: first.startColor, endColor: first.endColor };
}

function relativePath(path: ScenePath, anchor: Point): ShapePath {
  const vertices = path.vertices.map((vertex) => roundPoint([vertex[0] - anchor[0], vertex[1] - anchor[1]]));
  const inTangents = path.inTangents.map(roundPoint), outTangents = path.outTangents.map(roundPoint);
  const curved = [...inTangents, ...outTangents].some((tangent) => tangent[0] !== 0 || tangent[1] !== 0);
  return curved ? { vertices, inTangents, outTangents, closed: path.closed } : { vertices, closed: path.closed };
}

const percent = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10;
const channel = (rgb: Rgb): [number, number, number] => [rgb[0], rgb[1], rgb[2]];

const opacityField = (value: number): { opacity?: number } => value < 0.9995 ? { opacity: percent(value) } : {};

function fillSpec(fill: NonNullable<DrawnShape["fill"]>): VectorShapeFill {
  return { color: channel(fill.color), ...opacityField(fill.opacity), ...(fill.rule === "evenodd" ? { rule: "evenodd" as const } : {}) };
}

function strokeSpec(stroke: NonNullable<DrawnShape["stroke"]>): VectorShapeStroke {
  return { color: channel(stroke.color), width: Math.max(0.01, round(stroke.width)), ...opacityField(stroke.opacity), ...(stroke.cap !== "butt" ? { cap: stroke.cap } : {}), ...(stroke.join !== "miter" ? { join: stroke.join } : {}), ...(stroke.miterLimit !== 4 ? { miterLimit: stroke.miterLimit } : {}) };
}

function keptPaths(leaf: DrawnShape, anchor: Point, warn: (message: string) => void): ShapePath[] {
  const kept = leaf.paths.filter((path) => path.vertices.length <= SCENE_LIMITS.maxPathVertices);
  if (kept.length < leaf.paths.length) warn(`"${leaf.name}" has a path with more than ${SCENE_LIMITS.maxPathVertices} points, which was left out; simplify it.`);
  if (kept.length > SCENE_LIMITS.maxPathsPerShape) warn(`"${leaf.name}" has more than ${SCENE_LIMITS.maxPathsPerShape} subpaths; only the first ${SCENE_LIMITS.maxPathsPerShape} were drawn.`);
  return kept.slice(0, SCENE_LIMITS.maxPathsPerShape).map((path) => relativePath(path, anchor));
}

function vectorShape(leaf: DrawnShape, anchor: Point, warn: (message: string) => void): VectorShape | undefined {
  const paths = keptPaths(leaf, anchor, warn);
  if (!paths.length) return undefined;
  return { name: leaf.name, paths, ...(leaf.fill ? { fill: fillSpec(leaf.fill) } : {}), ...(leaf.stroke ? { stroke: strokeSpec(leaf.stroke) } : {}), ...opacityField(leaf.opacity) };
}

interface LayerDraft { readonly name: string; readonly element: SvgElement; readonly matrix: Matrix; readonly opacity: number; readonly leaves: DrawnShape[]; readonly lift?: LayerLift; readonly source: LayerSource; readonly index: number }

function liftedState(source: LayerSource, entered: Inherited, allowLift: boolean): { state: Inherited; lift: LayerLift | undefined } {
  const lift = allowLift ? liftLayerTransform(ownMatrix(source.element), source.parent.matrix) : undefined;
  return { state: lift ? { ...entered, matrix: lift.matrix } : entered, lift };
}

function warnUndrawn(element: SvgElement, name: string, context: WalkContext): void {
  if (element.name === "g" || element.name === "use") context.warnings.add(`"${name}" draws nothing visible and was left out.`);
}

function draftLayer(source: LayerSource, index: number, context: WalkContext, allowLift = true): LayerDraft | undefined {
  const entered = enter(source.element, source.parent, context, "layer");
  if (!entered) return undefined;
  const { state, lift } = liftedState(source, entered, allowLift);
  const leaves: DrawnShape[] = [];
  collectLeaves(source.element, { ...state, opacity: 1 }, context, leaves);
  const name = leafName(source.element, `Layer ${index + 1}`);
  if (!leaves.length) {
    warnUndrawn(source.element, name, context);
    return undefined;
  }
  return { name, element: source.element, matrix: state.matrix, opacity: source.parent.opacity * ownOpacity(declaredProperties(source.element, context.rules)), leaves, source, index, ...(lift ? { lift } : {}) };
}

function vertexCount(shapes: readonly VectorShape[]): number {
  return shapes.reduce((total, shape) => total + shape.paths.reduce((sum, path) => sum + path.vertices.length, 0), 0);
}

interface LayerFeatureInput { readonly declared: Readonly<Record<string, string>>; readonly context: WalkContext; readonly name: string; readonly matrix: Matrix; readonly warn: (message: string) => void }

function tryAddEffect({ declared, context, name, matrix, warn }: LayerFeatureInput): SceneLayerEffect | undefined {
  const filterValue = declared.filter?.trim();
  if (!filterValue || filterValue.toLowerCase() === "none") return undefined;
  const filterId = referenceId(filterValue);
  if (!filterId) { warn(`Layer "${name}" has an unsupported filter value ${JSON.stringify(filterValue)}; only filter="url(#id)" can be mapped.`); return undefined; }
  if (effectScale(matrix) === undefined) { warn(`Layer "${name}" has ${filterDescription(filterId, context.filters)} under a nonuniform or skewed transform; a single After Effects blur radius cannot preserve it.`); return undefined; }
  const resolved = resolveFilter(filterId, context.filters, matrix);
  if (resolved) return resolved;
  const limitation = unsupportedFilterReason(filterId, context.filters);
  if (limitation) { warn(`Layer "${name}" has ${filterDescription(filterId, context.filters)}; ${limitation}.`); return undefined; }
  warn(`Layer "${name}" has ${filterDescription(filterId, context.filters)}; it was not applied because only a SourceGraphic blur, a drop shadow, or the common glow pattern is supported.`);
  return undefined;
}

function clipGeometry(elements: readonly SvgElement[], matrix: Matrix): ScenePath[] {
  return elements.flatMap((element) => {
    const own = multiply(matrix, parseTransform(element.attributes.transform));
    if (SHAPE_ELEMENTS.has(element.name)) return elementPaths(element).map((path) => transformPath(path, own));
    return clipGeometry(element.children, own);
  });
}

function ownClipProblem(element: SvgElement, context: WalkContext): string | undefined {
  const declared = declaredProperties(element, context.rules);
  if (declared["clip-rule"]?.trim().toLowerCase() === "evenodd") return "even-odd clip geometry needs mask modes that this builder cannot preserve";
  if ([declared["clip-path"], declared.mask].some((value) => value && value.trim().toLowerCase() !== "none")) return "nested clipping or masking cannot be preserved";
  if (element.name === "use") return "a referenced <use> element cannot be resolved as a mask";
  if (element.name === "path" && elementPaths(element).length > 1) return "compound path contours may contain holes that additive masks would fill";
  return undefined;
}

function unsupportedClipReason(element: SvgElement, context: WalkContext): string | undefined {
  const own = ownClipProblem(element, context);
  if (own) return own;
  for (const child of element.children) {
    const reason = unsupportedClipReason(child, context);
    if (reason) return reason;
  }
  return undefined;
}

function clipMatrix(definition: ClipPathDefinition, layerMatrix: Matrix, bounds: Bounds): Matrix {
  const transform = parseTransform(definition.element.attributes.transform);
  if (!definition.boundingBoxUnits) return multiply(layerMatrix, transform);
  const box: Matrix = [bounds[2], 0, 0, bounds[3], bounds[0], bounds[1]];
  return multiply(box, transform);
}

interface ClipInput extends LayerFeatureInput { readonly bounds: Bounds; readonly anchor: Point }

function tryAddClipPath({ declared, context, name, warn, matrix, bounds, anchor }: ClipInput): SceneLayerClipPath | undefined {
  const clipValue = declared["clip-path"]?.trim();
  if (!clipValue || clipValue.toLowerCase() === "none") return undefined;
  const id = referenceId(clipValue);
  if (!id) { warn(`Layer "${name}" has an unsupported clip-path value ${JSON.stringify(clipValue)}; only clip-path="url(#id)" can be mapped.`); return undefined; }
  const definition = context.clipPaths.get(id);
  if (!definition) { warn(`Layer "${name}" references clip path #${id}, but that definition was not found; no mask was added.`); return undefined; }
  const unsupported = unsupportedClipReason(definition.element, context);
  if (unsupported) { warn(`Layer "${name}" references clip path #${id}, but ${unsupported}; no mask was added.`); return undefined; }
  const paths = clipGeometry(definition.children, clipMatrix(definition, matrix, bounds)).map((path) => relativePath(path, anchor));
  if (!paths.length) { warn(`Layer "${name}" references clip path #${id}, but it has no supported shape subpaths; no mask was added.`); return undefined; }
  return { paths };
}

function tryAddBlendMode(declared: Readonly<Record<string, string>>, warn: (msg: string) => void): string | undefined {
  const blendModeValue = declared["mix-blend-mode"]?.trim();
  if (!blendModeValue || blendModeValue.toLowerCase() === "normal") return undefined;
  const mapped = mapBlendMode(blendModeValue);
  if (mapped) return mapped;
  warn(`Layer blend mode "${blendModeValue}" is not supported (supported: multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity).`);
  return undefined;
}

function layerEffect(input: ClipInput): { effect?: SceneLayerEffect; clipPath?: SceneLayerClipPath; blendMode?: string } {
  const effect = tryAddEffect(input);
  const clipPath = tryAddClipPath(input);
  const blendMode = tryAddBlendMode(input.declared, input.warn);
  return { ...(effect ? { effect } : {}), ...(clipPath ? { clipPath } : {}), ...(blendMode ? { blendMode } : {}) };
}

function checkLayerLimits(name: string, shapes: VectorShape[]): void {
  if (shapes.length > SCENE_LIMITS.maxShapesPerLayer) throw new SvgSceneError("SVG_LIMIT_EXCEEDED", `"${name}" draws ${shapes.length} shapes; a layer may hold at most ${SCENE_LIMITS.maxShapesPerLayer}. Merge small parts into compound paths or split the group.`);
  if (vertexCount(shapes) > SCENE_LIMITS.maxVerticesPerLayer) throw new SvgSceneError("SVG_LIMIT_EXCEEDED", `"${name}" has more than ${SCENE_LIMITS.maxVerticesPerLayer} path points; simplify its paths.`);
}

const SCATTER_LIMITS = { shapes: SCENE_LIMITS.maxShapesPerLayer, vertices: SCENE_LIMITS.maxVerticesPerLayer } as const;

type CopiesInput = { draft: LayerDraft; rootMatrix: Matrix; scattered: number | undefined; hasRamp: boolean; warn: (message: string) => void };

function layerCopies({ draft, rootMatrix, scattered, hasRamp, warn }: CopiesInput): { repeat?: SceneLayerRepeat; scatter?: number } {
  if (scattered !== undefined) return { scatter: scattered };
  const repeat = layerRepeat(draft.element, rootMatrix, draft.name, warn);
  if (repeat && hasRamp) warn(`"${draft.name}" has a gradient ramp, which is not repeated; give the repeated part a flat fill.`);
  return repeat ? { repeat } : {};
}

type Placement = { leaves: DrawnShape[]; bounds: Bounds; anchor: Point; count: number | undefined };

function layerPlacement(draft: LayerDraft, rootMatrix: Matrix, canvas: Point, warn: (message: string) => void): Placement {
  const scattered = scatterLeaves({ element: draft.element, leaves: draft.leaves, rootMatrix, canvas, limits: SCATTER_LIMITS, name: draft.name, warn });
  const leaves = scattered?.leaves ?? draft.leaves;
  const bounds = pathBounds(leaves.map((leaf) => ({ paths: leaf.paths, pad: leaf.stroke ? leaf.stroke.width / 2 : 0 }))) ?? [0, 0, 0, 0];
  const anchorValue = draft.element.attributes["data-anchor"];
  const anchor = roundPoint(draft.lift ? liftedAnchor({ value: anchorValue, bounds, rootMatrix, lift: draft.lift, warn }) : anchorOf(anchorValue, bounds, rootMatrix, warn));
  return { leaves, bounds, anchor, count: scattered?.count };
}

function finishLayer(draft: LayerDraft, rootMatrix: Matrix, context: WalkContext, canvas: Point): CompiledSceneLayer {
  const warn = (message: string) => context.warnings.add(message);
  const { leaves, bounds, anchor, count } = layerPlacement(draft, rootMatrix, canvas, warn);
  const ramp = layerRamp(leaves, anchor, draft.name, context.warnings);
  const shapes = leaves.map((leaf) => vectorShape(leaf, anchor, warn)).filter((shape): shape is VectorShape => !!shape);
  checkLayerLimits(draft.name, shapes);
  const declared = declaredProperties(draft.element, context.rules);
  const features = layerEffect({ declared, context, name: draft.name, warn, matrix: draft.matrix, bounds, anchor });
  const copies = layerCopies({ draft, rootMatrix, scattered: count, hasRamp: !!ramp, warn });
  return { name: draft.name, anchor, bounds: [round(bounds[0]), round(bounds[1]), round(bounds[2]), round(bounds[3])], opacity: percent(draft.opacity), shapes, ...liftFields(draft.lift, anchor), ...(ramp ? { ramp } : {}), ...features, ...copies };
}

function finishOrBake(draft: LayerDraft, rootMatrix: Matrix, context: WalkContext, canvas: Point): CompiledSceneLayer {
  const layer = finishLayer(draft, rootMatrix, context, canvas);
  if (!draft.lift || !(layer.ramp || layer.effect || layer.scatter)) return layer;
  const source = draft.source;
  const baked = draftLayer(source, draft.index, context, false);
  return baked ? finishLayer(baked, rootMatrix, context, canvas) : layer;
}

function uniqueNames(layers: CompiledSceneLayer[]): CompiledSceneLayer[] {
  const used = new Map<string, number>();
  return layers.map((layer) => {
    const count = (used.get(layer.name) ?? 0) + 1;
    used.set(layer.name, count);
    return count === 1 ? layer : { ...layer, name: `${layer.name} ${count}` };
  });
}

function compileDocument(svg: string, options: SceneCompileOptions): CompiledScene {
  const root = parseSvgDocument(svg);
  const canvas = canvasOf(root, options);
  const ids = new Map<string, SvgElement>();
  collectIds(root, ids);
  const context: WalkContext = { rules: parseStyleSheets(root), gradients: collectGradients(root), filters: collectFilters(root), clipPaths: collectClipPaths(root), ids, viewport: canvas.viewport, warnings: new Set() };
  const rootState: Inherited = { matrix: canvas.matrix, style: computeStyle(DEFAULT_STYLE, declaredProperties(root, context.rules)), opacity: ownOpacity(declaredProperties(root, context.rules)), depth: 0 };
  const drafts = layerSources(root, rootState, context).map((source, index) => draftLayer(source, index, context)).filter((draft): draft is LayerDraft => !!draft);
  if (!drafts.length) throw new SvgSceneError("SVG_EMPTY", "The design draws nothing: no top-level shape or group has a visible fill or stroke.");
  if (drafts.length > SCENE_LIMITS.maxLayers) throw new SvgSceneError("SVG_LIMIT_EXCEEDED", `The design has ${drafts.length} top-level layers; at most ${SCENE_LIMITS.maxLayers}. Group parts that move together.`);
  const layers = uniqueNames(drafts.map((draft) => finishOrBake(draft, canvas.matrix, context, [canvas.width, canvas.height])));
  return { width: canvas.width, height: canvas.height, layers, warnings: [...context.warnings] };
}

/** Compiles a scene design; `width`/`height` are the composition it will be built in. */
export function compileSvgScene(svg: string, options: SceneCompileOptions = {}): SceneCompileResult {
  try {
    return { ok: true, scene: compileDocument(svg, options) };
  } catch (error) {
    if (error instanceof SvgSceneError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}
