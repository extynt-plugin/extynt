// Measures where a layer really sits in composition space, parents included, from a project snapshot.
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot } from "@extynt/project-graph";
import { applyMatrix, layerMatrix, multiplyMatrix } from "./matrix.js";
import type { LayerTransform2D, Matrix2D } from "./matrix.js";
import { readLayerTransform } from "./transform-reader.js";
import type { ComponentFlags, TransformRead } from "./transform-reader.js";
import { round3, solverFailure } from "./types.js";
import type { SolverFailure, Vec2 } from "./types.js";

interface LayerBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
  readonly center: Vec2;
}

/**
 * A layer's placement in composition space. `time` is the composition time the values were read at; `anchorInComp` is where the anchor point lands (the point Position moves);
 * `matrix` maps layer space to composition space, parents included; `rotationInComp` sums the rotations along the chain (degrees); `scaleInComp` is the component-wise product of scales along the chain in percent (approximate when rotations and non-uniform scales mix);
 * `parentChain` lists the parent ids nearest first; `size` is the layer's own width and height in layer pixels, or null when it has no fixed size; `bounds` is the axis-aligned composition-space box around the transformed [0,0]-[w,h] rectangle, null when size is null;
 * `corners` are the four transformed corners in order (0,0), (w,0), (w,h), (0,h), or null; `caveats` are plain-English limits of the answer, empty when there are none.
 */
export interface LayerMeasurement {
  readonly ok: true;
  readonly compositionId: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly time: number | null;
  readonly anchorInComp: Vec2;
  readonly matrix: Matrix2D;
  readonly rotationInComp: number;
  readonly scaleInComp: Vec2;
  readonly parentChain: ReadonlyArray<string>;
  readonly size: Vec2 | null;
  readonly bounds: LayerBounds | null;
  readonly corners: ReadonlyArray<Vec2> | null;
  readonly caveats: ReadonlyArray<string>;
}

interface ChainState {
  readonly matrix: Matrix2D;
  readonly rotationInComp: number;
  readonly scaleInComp: Vec2;
  readonly caveats: ReadonlyArray<string>;
}

const MAX_PARENT_DEPTH = 64;
const NO_FIXED_SIZE_CAVEAT = "Text, shape and null-like layers have no fixed size here. For motion that needs the rendered extent (a slide in from off-frame, a fit), compute it in an expression with sourceRectAtTime, or move by at least the composition width; capture a frame only to judge appearance.";

function findLayer(composition: CompositionSnapshot, layerId: string): LayerSnapshot | undefined {
  return composition.layers.find((layer) => layer.id === layerId);
}

function transformOf(read: TransformRead): LayerTransform2D {
  return { anchor: read.anchor.value, position: read.position.value, scale: read.scale.value, rotation: read.rotation.value };
}

function flagsOf(read: TransformRead): ReadonlyArray<ComponentFlags> {
  return [read.anchor, read.position, read.scale, read.rotation];
}

function positiveSize(width: number | undefined, height: number | undefined): Vec2 | null {
  if (width === undefined || height === undefined) return null;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? [width, height] : null;
}

function layerSize(snapshot: ProjectSnapshot, layer: LayerSnapshot): Vec2 | null {
  const precomp = snapshot.compositions.find((composition) => composition.id === layer.compositionSourceId);
  if (precomp) return [precomp.width, precomp.height];
  const source = snapshot.sources?.find((candidate) => candidate.id === layer.sourceId);
  return positiveSize(source?.width, source?.height);
}

function cornersOf(matrix: Matrix2D, size: Vec2): ReadonlyArray<Vec2> {
  return [applyMatrix(matrix, [0, 0]), applyMatrix(matrix, [size[0], 0]), applyMatrix(matrix, size), applyMatrix(matrix, [0, size[1]])];
}

function boundsOf(corners: ReadonlyArray<Vec2>): LayerBounds {
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    left: round3(left),
    top: round3(top),
    right: round3(right),
    bottom: round3(bottom),
    width: round3(right - left),
    height: round3(bottom - top),
    center: [round3((left + right) / 2), round3((top + bottom) / 2)],
  };
}

function parentChainOf(composition: CompositionSnapshot, layerId: string): ReadonlyArray<string> | SolverFailure {
  const chain: string[] = [];
  const seen = new Set<string>();
  for (let parent = findLayer(composition, layerId)?.parentId; parent; parent = findLayer(composition, parent)?.parentId) {
    if (seen.has(parent)) return solverFailure(`Layer ${layerId} has a parent cycle.`);
    seen.add(parent);
    if (chain.length > MAX_PARENT_DEPTH) return solverFailure(`Layer ${layerId} has parent depth > 64.`);
    chain.push(parent);
  }
  return chain;
}

function layerCaveats(layer: LayerSnapshot, composition: CompositionSnapshot, read: TransformRead, size: Vec2 | null): ReadonlyArray<string> {
  const flags = flagsOf(read);
  const names = ["anchor", "position", "scale", "rotation"];
  const defaulted = names.filter((_, index) => flags[index]?.defaulted);
  const time = composition.currentTime ?? "unknown";
  return [
    ...(flags.some((flag) => flag.animated) ? [`Transform is animated; values are the snapshot's, read at the current time ${time}s.`] : []),
    ...(flags.some((flag) => flag.has3d) ? ["Layer looks 3D; z, X/Y rotation and orientation are ignored, and a camera would change the result."] : []),
    ...(defaulted.length > 0 ? [`Layer ${layer.id} is missing or invalid transform properties: ${defaulted.join(", ")}.`] : []),
    ...(size === null ? [NO_FIXED_SIZE_CAVEAT] : []),
  ];
}

function parentCaveats(parentId: string, read: TransformRead): ReadonlyArray<string> {
  const flags = flagsOf(read);
  return [
    ...(flags.some((flag) => flag.animated) ? [`Parent ${parentId} is animated; its values are the snapshot's.`] : []),
    ...(flags.some((flag) => flag.has3d) ? [`Parent ${parentId} looks 3D; its z, X/Y rotation and orientation are ignored.`] : []),
  ];
}

function withParent(state: ChainState, parentId: string, read: TransformRead): ChainState {
  return {
    matrix: multiplyMatrix(layerMatrix(transformOf(read)), state.matrix),
    rotationInComp: state.rotationInComp + read.rotation.value,
    scaleInComp: [(state.scaleInComp[0] * read.scale.value[0]) / 100, (state.scaleInComp[1] * read.scale.value[1]) / 100],
    caveats: [...state.caveats, ...parentCaveats(parentId, read)],
  };
}

function accumulateParents(composition: CompositionSnapshot, chain: ReadonlyArray<string>, start: ChainState): ChainState {
  let state = start;
  for (const parentId of chain) {
    const parent = findLayer(composition, parentId);
    if (!parent) {
      const missing = `Parent ${parentId} is not in the snapshot; the result is in that parent's space, not the composition's.`;
      return { ...state, caveats: [...state.caveats, missing] };
    }
    state = withParent(state, parentId, readLayerTransform(parent));
  }
  return state;
}

function startState(read: TransformRead, caveats: ReadonlyArray<string>): ChainState {
  return { matrix: layerMatrix(transformOf(read)), rotationInComp: read.rotation.value, scaleInComp: read.scale.value, caveats };
}

function roundedPoint(point: Vec2): Vec2 {
  return [round3(point[0]), round3(point[1])];
}

function roundedMatrix(matrix: Matrix2D): Matrix2D {
  const [a, b, c, d, e, f] = matrix;
  return [round3(a), round3(b), round3(c), round3(d), round3(e), round3(f)];
}

interface Placement {
  readonly layer: LayerSnapshot;
  readonly composition: CompositionSnapshot;
  readonly anchor: Vec2;
  readonly parentChain: ReadonlyArray<string>;
  readonly size: Vec2 | null;
  readonly state: ChainState;
}

function measurementOf({ layer, composition, anchor, parentChain, size, state }: Placement): LayerMeasurement {
  const corners = size ? cornersOf(state.matrix, size) : null;
  return {
    ok: true,
    compositionId: composition.id,
    layerId: layer.id,
    layerName: layer.name,
    time: composition.currentTime ?? null,
    anchorInComp: roundedPoint(applyMatrix(state.matrix, anchor)),
    matrix: roundedMatrix(state.matrix),
    rotationInComp: round3(state.rotationInComp),
    scaleInComp: roundedPoint(state.scaleInComp),
    parentChain,
    size: size ? roundedPoint(size) : null,
    bounds: corners ? boundsOf(corners) : null,
    corners: corners ? corners.map(roundedPoint) : null,
    caveats: state.caveats,
  };
}

/** Where the layer's anchor, box and corners land in composition space, or the reason it cannot be measured. */
export function measureLayer(snapshot: ProjectSnapshot, compositionId: string, layerId: string): LayerMeasurement | SolverFailure {
  const composition = snapshot.compositions.find((candidate) => candidate.id === compositionId);
  if (!composition) return solverFailure(`Composition ${compositionId} is not in the snapshot.`);
  const layer = findLayer(composition, layerId);
  if (!layer) return solverFailure(`Layer ${layerId} is not in composition ${compositionId}.`);
  const parentChain = parentChainOf(composition, layerId);
  if ("ok" in parentChain) return parentChain;
  const read = readLayerTransform(layer);
  const size = layerSize(snapshot, layer);
  const start = startState(read, layerCaveats(layer, composition, read, size));
  return measurementOf({ layer, composition, anchor: read.anchor.value, parentChain, size, state: accumulateParents(composition, parentChain, start) });
}
