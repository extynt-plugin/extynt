/** The rectangles a composition's visible layers cover: a crude stand-in for the rendered frame the real panel captures (boxes, not glyphs or paths). */
import { flattenProperties, type CompositionSnapshot, type LayerSnapshot, type ProjectSnapshot, type PropertySnapshot } from "@extynt/project-graph";
import { isJsonObject, type JsonValue } from "@extynt/decode";
import { POSITION_PATH, SCALE_PATH, TEXT_DOCUMENT_PATH } from "./fake-host-tables.js";
import type { SceneRect } from "./fake-plugin-frame.js";

type Rgb = readonly [number, number, number];

const SKIPPED = new Set(["null", "camera", "light", "adjustment"]);
const DEFAULT_SHAPE: Rgb = [1, 0.5, 0.2];
const DEFAULT_SOLID: Rgb = [0.6, 0.6, 0.6];
const FONT_SIZE = 72;

type Key = { time: number; value: number[] };

function numbers(value: JsonValue | null | undefined): number[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((entry): entry is number => typeof entry === "number") ? value : undefined;
}

function colorOf(property: PropertySnapshot | undefined): Rgb | undefined {
  const [red, green, blue] = numbers(property?.value) ?? [];
  return red !== undefined && green !== undefined && blue !== undefined ? [red, green, blue] : undefined;
}

const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

function keyVectors(property: PropertySnapshot | undefined): Key[] {
  const keys = (property?.keyframes ?? []).flatMap((key) => {
    const value = numbers(key.value);
    return value ? [{ time: key.time, value }] : [];
  });
  return keys.sort((a, b) => a.time - b.time);
}

function interpolate(keys: readonly Key[], time: number, fallback: number[]): number[] {
  for (let at = 1; at < keys.length; at += 1) {
    const from = keys[at - 1], to = keys[at];
    if (!from || !to || time > to.time) continue;
    const mix = (time - from.time) / (to.time - from.time || 1);
    return from.value.map((entry, index) => entry + ((to.value[index] ?? entry) - entry) * mix);
  }
  return fallback;
}

function vectorAt(property: PropertySnapshot | undefined, time: number): number[] | undefined {
  const keys = keyVectors(property), first = keys[0], last = keys.at(-1);
  if (!first || !last) return numbers(property?.value);
  if (time <= first.time) return first.value;
  return time >= last.time ? last.value : interpolate(keys, time, last.value);
}

function textOf(property: PropertySnapshot | undefined): string {
  const value = property?.value;
  if (typeof value === "string") return value;
  const text = isJsonObject(value) ? value.text : undefined;
  return typeof text === "string" ? text : "";
}

type Box = { width: number; height: number; rgb: Rgb };
type NamedProperty = (match: string) => PropertySnapshot | undefined;

function textBox(all: readonly PropertySnapshot[], named: NamedProperty): Box {
  const length = Math.max(1, textOf(all.find((property) => property.path === TEXT_DOCUMENT_PATH)).length);
  return { width: 0.6 * FONT_SIZE * length, height: FONT_SIZE, rgb: colorOf(named("ADBE Text Fill Color")) ?? [1, 1, 1] };
}

function shapeSize(comp: CompositionSnapshot, named: NamedProperty): [number, number] {
  const size = numbers(named("ADBE Vector Rect Size")?.value) ?? numbers(named("ADBE Vector Ellipse Size")?.value), side = 0.3 * Math.min(comp.width, comp.height);
  return size ? [size[0] ?? side, size[1] ?? size[0] ?? side] : [side, side];
}

function shapeBox(comp: CompositionSnapshot, named: NamedProperty): Box {
  const [width, height] = shapeSize(comp, named);
  return { width, height, rgb: colorOf(named("ADBE Vector Fill Color")) ?? colorOf(named("ADBE Vector Stroke Color")) ?? DEFAULT_SHAPE };
}

function avBox(layer: LayerSnapshot, comp: CompositionSnapshot, project: ProjectSnapshot): Box {
  const precomp = layer.compositionSourceId ? project.compositions.find((candidate) => candidate.id === layer.compositionSourceId) : undefined,
    source = (project.sources ?? []).find((candidate) => candidate.id === layer.sourceId);
  const extent = (axis: "width" | "height"): number => precomp?.[axis] ?? source?.[axis] ?? comp[axis];
  return { width: extent("width"), height: extent("height"), rgb: source?.type === "solid" || !source ? DEFAULT_SOLID : [0.5, 0.5, 0.7] };
}

function boxOf(layer: LayerSnapshot, comp: CompositionSnapshot, project: ProjectSnapshot): Box | undefined {
  const all = flattenProperties(layer.properties), named: NamedProperty = (match) => all.find((property) => property.matchName === match);
  if (layer.type === "text") return textBox(all, named);
  if (layer.type === "shape") return shapeBox(comp, named);
  return layer.type === "av" ? avBox(layer, comp, project) : undefined;
}

const visibleAt = (layer: LayerSnapshot, time: number): boolean =>
  layer.enabled && !layer.shy && !SKIPPED.has(layer.type) && time >= layer.inPoint && time < layer.outPoint;

function placementOf(layer: LayerSnapshot, comp: CompositionSnapshot, time: number): { x: number; y: number; scaleX: number; scaleY: number } {
  const all = flattenProperties(layer.properties),
    position = vectorAt(
      all.find((property) => property.path === POSITION_PATH),
      time,
    ) ?? [comp.width / 2, comp.height / 2],
    scale = vectorAt(
      all.find((property) => property.path === SCALE_PATH),
      time,
    ) ?? [100, 100];
  const scaleX = scale[0] ?? 100;
  return { x: position[0] ?? comp.width / 2, y: position[1] ?? comp.height / 2, scaleX, scaleY: scale[1] ?? scaleX };
}

function rectOf(
  layer: LayerSnapshot,
  input: { comp: CompositionSnapshot; project: ProjectSnapshot; time: number; sx: number; sy: number },
): SceneRect | undefined {
  const { comp, project, time, sx, sy } = input,
    box = boxOf(layer, comp, project);
  if (!box) return undefined;
  const at = placementOf(layer, comp, time);
  const w = box.width * at.scaleX / 100 * sx, h = box.height * at.scaleY / 100 * sy, cx = at.x * sx, cy = at.y * sy;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rgb: [channel(box.rgb[0]), channel(box.rgb[1]), channel(box.rgb[2])] };
}

/**
 * The background and rectangles (capture pixels, bottom layer first) for the composition `compositionId` at `time`; undefined when the project
 * has no such composition.
 */
export function sceneOf(input: {
  project: ProjectSnapshot;
  compositionId: string;
  time: number;
  width: number;
  height: number;
}): { background: Rgb; rects: SceneRect[] } | undefined {
  const { project, time, width, height } = input,
    comp = project.compositions.find((candidate) => candidate.id === input.compositionId);
  if (!comp) return undefined;
  const view = { comp, project, time, sx: width / comp.width, sy: height / comp.height };
  const rects = [...comp.layers]
    .sort((a, b) => b.index - a.index)
    .filter((layer) => visibleAt(layer, time))
    .flatMap((layer) => {
      const rect = rectOf(layer, view);
      return rect ? [rect] : [];
    });
  const [r, g, b] = comp.backgroundColor ?? [0, 0, 0];
  return { background: [channel(r), channel(g), channel(b)], rects };
}
