// Decoders for the drawings saved in workflow handoffs: they validate the compiled scene, its design and its manifest and keep the geometry exactly as saved.

import type { ShapePath, VectorShape, VectorShapeFill, VectorShapeStroke } from "@extynt/action-plan";
import { array, boolean, literal, map, nullable, number, object, optional, string, tuple, type Decoder } from "@extynt/decode";
import type { CompiledScene, CompiledSceneLayer, SceneManifestLayer } from "@extynt/mcp-server";
import type { SceneDesign, SceneManifest } from "./workflow-design-compile.js";

type Point = [number, number];
type Color = [number, number, number];
type Bounds = [number, number, number, number];

function list<T>(item: Decoder<T>): Decoder<T[]> {
  return map(array(item), (items) => [...items]);
}

const strings = list(string());
const point: Decoder<Point> = map(tuple(number(), number()), ([x, y]): Point => [x, y]);
const color: Decoder<Color> = map(tuple(number(), number(), number()), ([red, green, blue]): Color => [red, green, blue]);
const bounds: Decoder<Bounds> = map(tuple(number(), number(), number(), number()), ([left, top, right, bottom]): Bounds => [left, top, right, bottom]);

const shapePath: Decoder<ShapePath> = object({ vertices: list(point), closed: boolean(), inTangents: optional(list(point)), outTangents: optional(list(point)) });

const shapeFill: Decoder<VectorShapeFill> = object({ color, opacity: optional(number()), rule: optional(literal("nonzero", "evenodd")) });

const shapeStroke: Decoder<VectorShapeStroke> = object({
  color,
  width: number(),
  opacity: optional(number()),
  miterLimit: optional(number()),
  cap: optional(literal("butt", "round", "square")),
  join: optional(literal("miter", "round", "bevel")),
});

const vectorShape: Decoder<VectorShape> = object({ name: string(), paths: list(shapePath), fill: optional(shapeFill), stroke: optional(shapeStroke), opacity: optional(number()) });

const deviation = object({ stdDeviation: number() });

const sceneLayerRamp: Decoder<NonNullable<CompiledSceneLayer["ramp"]>> = object({
  kind: literal("linear", "radial"),
  start: point,
  end: point,
  startColor: color,
  endColor: color,
});

const sceneLayerEffect: Decoder<NonNullable<CompiledSceneLayer["effect"]>> = object({
  kind: literal("gaussian-blur", "drop-shadow", "glow"),
  blur: optional(deviation),
  shadow: optional(object({ dx: number(), dy: number(), stdDeviation: number(), floodColor: color, floodOpacity: number() })),
  glow: optional(deviation),
});

const sceneLayerRepeat: Decoder<NonNullable<CompiledSceneLayer["repeat"]>> = object({
  copies: number(),
  position: point,
  scale: optional(point),
  rotation: optional(number()),
  startOpacity: optional(number()),
  endOpacity: optional(number()),
});

const sceneLayer: Decoder<CompiledSceneLayer> = object({
  name: string(),
  anchor: point,
  position: optional(point),
  rotation: optional(number()),
  scale: optional(number()),
  bounds,
  opacity: number(),
  shapes: list(vectorShape),
  ramp: optional(sceneLayerRamp),
  clipPath: optional(object({ paths: list(shapePath) })),
  effect: optional(sceneLayerEffect),
  blendMode: optional(string()),
  repeat: optional(sceneLayerRepeat),
  scatter: optional(number()),
});

const scene: Decoder<CompiledScene> = object({ width: number(), height: number(), layers: list(sceneLayer), warnings: strings });

const manifestLayer: Decoder<SceneManifestLayer> = object({
  name: string(),
  position: point,
  rotation: optional(number()),
  scale: optional(number()),
  bounds,
  shapes: number(),
  colors: strings,
  opacity: optional(number()),
  gradient: optional(string()),
  companion: optional(string()),
  effects: optional(strings),
  blendMode: optional(string()),
  repeater: optional(string()),
  scattered: optional(string()),
});

/** A saved drawing: the SVG, its compiled scene and the composition it was drawn for. */
export const handoffDesign: Decoder<SceneDesign> = object({ svg: string(), scene, compositionId: nullable(string()), targetCompositionPlaceholder: optional(string()), compiledAt: string() });

/** A saved scene manifest: the canvas and its layers bottom to top. */
export const handoffManifest: Decoder<SceneManifest> = object({ canvas: point, order: literal("bottom-to-top"), layers: list(manifestLayer), warnings: strings });
