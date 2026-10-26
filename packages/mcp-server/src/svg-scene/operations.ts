// A compiled scene as ae_queue_add operations, and the compact manifest the specialists and the owner work from.
import { jsonOf, objectOf } from "../json.js";
import type { JsonObject, JsonValue } from "@extynt/decode";
import type { Rgb } from "./color.js";
import type { CompiledScene, CompiledSceneLayer } from "./scene.js";
import type { Point } from "./transform.js";

type EffectSpec = { capabilityId: string; effectMatchName: string; effectPath: string };
type LayerTarget = { compositionId: string; layerId: string };
type LayerEffect = NonNullable<CompiledSceneLayer["effect"]>;

const RAMP: EffectSpec = { capabilityId: "adobe.gradient-ramp", effectMatchName: "ADBE Ramp", effectPath: "ADBE Effect Parade/ADBE Ramp" };
const GAUSSIAN_BLUR: EffectSpec = { capabilityId: "adobe.gaussian-blur", effectMatchName: "ADBE Gaussian Blur 2", effectPath: "ADBE Effect Parade/ADBE Gaussian Blur 2" };
const DROP_SHADOW: EffectSpec = { capabilityId: "adobe.drop-shadow", effectMatchName: "ADBE Drop Shadow", effectPath: "ADBE Effect Parade/ADBE Drop Shadow" };
const GLOW: EffectSpec = { capabilityId: "adobe.glow", effectMatchName: "ADBE Glo2", effectPath: "ADBE Effect Parade/ADBE Glo2" };
const BLUR_CONTROL = "ADBE Gaussian Blur 2-0001";
const GLOW_RADIUS_CONTROL = "ADBE Glo2-0003";
const STD_DEVIATION_PER_UNIT = 0.3;

/** Where a scene is built: the composition, its centre and, when known, its size. */
export type SceneBuildTarget = { readonly compositionId: string; readonly center: Point; readonly size?: Point };

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || "layer";
}

/** A placeholder the queue accepts: `__new__:` and at most 128 of [A-Za-z0-9._-]. */
export function designPlaceholder(name: string, index: number): string {
  return `__new__:design-${index + 1}-${slugOf(name)}`;
}

/** A placeholder for the companion solid layer that holds the gradient ramp. */
export function companionSolidPlaceholder(name: string, index: number): string {
  return `${designPlaceholder(name, index)}-gradient`;
}

function companionPlaceholder(name: string, placeholder: string, explicit: string | undefined): string {
  if (explicit) return explicit;
  const match = /^__new__:design-(\d+)-/u.exec(placeholder);
  const index = match ? Number(match[1]) - 1 : -1;
  return index >= 0 ? companionSolidPlaceholder(name, index) : `${placeholder}-gradient`;
}

function compositionSize(build: SceneBuildTarget): Point {
  return build.size ?? [build.center[0] * 2, build.center[1] * 2];
}

function ensureEffect(effect: EffectSpec, target: LayerTarget): JsonObject {
  return { type: "ensure_effect", capabilityId: effect.capabilityId, effectMatchName: effect.effectMatchName, effectPath: effect.effectPath, target: { ...target, effectPath: effect.effectPath } };
}

function effectControl(effect: EffectSpec, target: LayerTarget, control: string, value: JsonValue): JsonObject {
  return { type: "set_effect_control", effectMatchName: effect.effectMatchName, target: { ...target, effectPath: effect.effectPath, propertyPath: `${effect.effectPath}/${control}` }, value };
}

function opaque(rgb: Rgb): JsonValue {
  return [rgb[0], rgb[1], rgb[2], 1];
}

function rampOperations(layer: CompiledSceneLayer, rampTarget: LayerTarget, shapeTarget: LayerTarget): JsonObject[] {
  const ramp = layer.ramp;
  if (!ramp) return [];
  const control = (suffix: string, value: JsonValue) => effectControl(RAMP, rampTarget, `ADBE Ramp-${suffix}`, value);
  const inComposition = (point: Point): Point => [point[0] + layer.anchor[0], point[1] + layer.anchor[1]];
  return [
    ensureEffect(RAMP, rampTarget),
    control("0001", inComposition(ramp.start)), control("0002", opaque(ramp.startColor)), control("0003", inComposition(ramp.end)), control("0004", opaque(ramp.endColor)),
    ...(ramp.kind === "radial" ? [control("0005", 2)] : []),
    { type: "set_track_matte", target: rampTarget, matteLayerId: shapeTarget.layerId, mode: "alpha" },
    { type: "set_layer_parent", target: rampTarget, parentLayerId: shapeTarget.layerId },
  ];
}

function blurOperations(blur: { readonly stdDeviation: number }, target: LayerTarget): JsonObject[] {
  return [ensureEffect(GAUSSIAN_BLUR, target), effectControl(GAUSSIAN_BLUR, target, BLUR_CONTROL, blur.stdDeviation / STD_DEVIATION_PER_UNIT)];
}

function shadowOperations(shadow: NonNullable<LayerEffect["shadow"]>, target: LayerTarget): JsonObject[] {
  const distance = Math.hypot(shadow.dx, shadow.dy);
  const direction = distance > 0.01 ? (Math.atan2(shadow.dx, -shadow.dy) * 180 / Math.PI + 360) % 360 : 0;
  const control = (index: string, value: JsonValue) => effectControl(DROP_SHADOW, target, `ADBE Drop Shadow-${index}`, value);
  return [
    ensureEffect(DROP_SHADOW, target),
    control("0001", opaque(shadow.floodColor)), control("0002", shadow.floodOpacity * 255), control("0003", direction), control("0004", distance), control("0005", shadow.stdDeviation / STD_DEVIATION_PER_UNIT),
  ];
}

function glowOperations(glow: { readonly stdDeviation: number }, target: LayerTarget): JsonObject[] {
  return [ensureEffect(GLOW, target), effectControl(GLOW, target, GLOW_RADIUS_CONTROL, glow.stdDeviation / STD_DEVIATION_PER_UNIT)];
}

const EFFECT_BUILDERS: Readonly<Record<LayerEffect["kind"], (effect: LayerEffect, target: LayerTarget) => JsonObject[]>> = {
  "gaussian-blur": (effect, target) => (effect.blur ? blurOperations(effect.blur, target) : []),
  "drop-shadow": (effect, target) => (effect.shadow ? shadowOperations(effect.shadow, target) : []),
  glow: (effect, target) => (effect.glow ? glowOperations(effect.glow, target) : []),
};

function effectOperations(layer: CompiledSceneLayer, target: LayerTarget): JsonObject[] {
  return layer.effect ? EFFECT_BUILDERS[layer.effect.kind](layer.effect, target) : [];
}

function clipPathOperations(layer: CompiledSceneLayer, target: LayerTarget): JsonObject[] {
  const paths = layer.clipPath?.paths ?? [];
  return paths.map((path, index) => ({ type: "add_mask", target, newMaskId: `${target.layerId}-mask-${index + 1}`, name: `${layer.name} Clip ${index + 1}`, values: { path: jsonOf(path) } }));
}

function blendModeOperations(layer: CompiledSceneLayer, target: LayerTarget): JsonObject[] {
  return layer.blendMode ? [{ type: "set_layer_attribute", target, role: "blend-mode", value: layer.blendMode }] : [];
}

function repeatOperations(layer: CompiledSceneLayer, target: LayerTarget, placeholder: string): JsonObject[] {
  const repeat = layer.repeat;
  if (!repeat) return [];
  const values = objectOf({ copies: repeat.copies, position: repeat.position, scale: repeat.scale, rotation: repeat.rotation, startOpacity: repeat.startOpacity, endOpacity: repeat.endOpacity });
  return [{ type: "add_shape_item", target, groupId: "root", item: "repeater", newItemId: `${placeholder}-repeater`, name: `${layer.name} Repeater`, values }];
}

function layerProperty(target: LayerTarget, role: string, propertyPath: string, value: JsonValue): JsonObject {
  return { type: "set_layer_property", target, role, propertyPath, value };
}

function movedPosition(layer: CompiledSceneLayer, center: Point): Point | undefined {
  const position = layer.position ?? layer.anchor;
  return Math.abs(position[0] - center[0]) > 0.005 || Math.abs(position[1] - center[1]) > 0.005 ? position : undefined;
}

function reducedOpacity(layer: CompiledSceneLayer): number | undefined {
  return layer.opacity < 100 ? layer.opacity : undefined;
}

function whenPresent<T>(value: T | undefined, make: (present: T) => JsonObject): JsonObject[] {
  return value === undefined ? [] : [make(value)];
}

function transformOperations(layer: CompiledSceneLayer, target: LayerTarget, center: Point): JsonObject[] {
  return [
    ...whenPresent(movedPosition(layer, center), (position) => layerProperty(target, "transform.position", "ADBE Transform Group/ADBE Position", [position[0], position[1], 0])),
    ...whenPresent(layer.rotation, (rotation) => layerProperty(target, "transform.rotation", "ADBE Transform Group/ADBE Rotate Z", rotation)),
    ...whenPresent(layer.scale, (scale) => layerProperty(target, "transform.scale", "ADBE Transform Group/ADBE Scale", [scale, scale])),
    ...whenPresent(reducedOpacity(layer), (opacity) => layerProperty(target, "transform.opacity", "ADBE Transform Group/ADBE Opacity", opacity)),
  ];
}

function artworkOperations(layer: CompiledSceneLayer, target: LayerTarget, placeholder: string, center: Point): JsonObject[] {
  return [
    { type: "create_layer", target, layerType: "shape", name: layer.name },
    { type: "draw_vector_shapes", target, shapes: jsonOf(layer.shapes) },
    ...repeatOperations(layer, target, placeholder),
    ...transformOperations(layer, target, center),
    ...clipPathOperations(layer, target),
  ];
}

type GradientInput = { layer: CompiledSceneLayer; target: LayerTarget; placeholder: string; build: SceneBuildTarget; companionId: string | undefined };

function gradientOperations({ layer, target, placeholder, build, companionId }: GradientInput): JsonObject[] {
  const solidTarget = { compositionId: build.compositionId, layerId: companionPlaceholder(layer.name, placeholder, companionId) };
  const visibleTarget = layer.effect ? { compositionId: build.compositionId, layerId: `${placeholder}-artwork-layer` } : solidTarget;
  const precompose: JsonObject[] = layer.effect
    ? [{ type: "precompose_layers", target: { compositionId: build.compositionId }, layerIds: [target.layerId, solidTarget.layerId], name: layer.name, newCompositionId: `${placeholder}-artwork-comp`, newLayerId: visibleTarget.layerId, moveAllAttributes: true }]
    : [];
  return [
    { type: "create_layer", target: solidTarget, layerType: "solid", name: `${layer.name} Gradient`, color: [0, 0, 0, 1], size: compositionSize(build) },
    { type: "reorder_layer", target, placement: "before", referenceLayerId: solidTarget.layerId },
    ...rampOperations(layer, solidTarget, target),
    ...precompose,
    ...effectOperations(layer, visibleTarget),
    ...blendModeOperations(layer, visibleTarget),
  ];
}

/** Creates the artwork, then applies its gradient, effects, masks, and blend mode. */
export function sceneLayerOperations(layer: CompiledSceneLayer, placeholder: string, build: SceneBuildTarget, companionId?: string): JsonObject[] {
  const target = { compositionId: build.compositionId, layerId: placeholder };
  const artwork = artworkOperations(layer, target, placeholder, build.center);
  if (layer.ramp) return [...artwork, ...gradientOperations({ layer, target, placeholder, build, companionId })];
  return [...artwork, ...effectOperations(layer, target), ...blendModeOperations(layer, target)];
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.slice(0, 3).map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** One built layer as the manifest lists it: where it sits, how big it is and what it looks like. */
export type SceneManifestLayer = {
  readonly name: string;
  readonly position: Point;
  readonly rotation?: number;
  readonly scale?: number;
  readonly bounds: readonly [number, number, number, number];
  readonly shapes: number;
  readonly colors: readonly string[];
  readonly opacity?: number;
  readonly gradient?: string;
  readonly companion?: string;
  readonly effects?: string[];
  readonly blendMode?: string;
  readonly repeater?: string;
  readonly scattered?: string;
};

const EFFECT_NAMES: Readonly<Record<LayerEffect["kind"], string>> = { "gaussian-blur": "Gaussian Blur", "drop-shadow": "Drop Shadow", glow: "Glow" };

function shapeColors(layer: CompiledSceneLayer): string[] {
  const colors = layer.shapes.flatMap((shape) => [shape.fill?.color, shape.stroke?.color]).filter((color): color is [number, number, number] => !!color);
  return [...new Set(colors.map(hex))].slice(0, 6);
}

function manifestLayer(layer: CompiledSceneLayer): SceneManifestLayer {
  const ramp = layer.ramp;
  return {
    name: layer.name,
    position: layer.position ?? layer.anchor,
    ...objectOf({ rotation: layer.rotation, scale: layer.scale }),
    bounds: layer.bounds,
    shapes: layer.shapes.length,
    colors: shapeColors(layer),
    ...objectOf({
      opacity: reducedOpacity(layer),
      gradient: ramp && `${ramp.kind} ${hex(ramp.startColor)}→${hex(ramp.endColor)}`,
      companion: ramp && `${layer.name} Gradient`,
      effects: layer.effect && [EFFECT_NAMES[layer.effect.kind]],
      blendMode: layer.blendMode,
      repeater: layer.repeat && `${layer.repeat.copies} copies`,
      scattered: layer.scatter === undefined ? undefined : `scattered ${layer.scatter}`,
    }),
  };
}

/** What the specialists and the owner need to animate and verify the built scene: names, positions, bounds, palette. */
export function sceneManifest(scene: CompiledScene): { canvas: [number, number]; order: "bottom-to-top"; layers: SceneManifestLayer[]; warnings: string[] } {
  return { canvas: [scene.width, scene.height], order: "bottom-to-top", layers: scene.layers.map(manifestLayer), warnings: scene.warnings.slice(0, 12) };
}
