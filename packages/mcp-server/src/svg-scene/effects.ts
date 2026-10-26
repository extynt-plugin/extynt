// SVG layer features that become After Effects effects, masks, or switches.
import { ALL_BLEND_MODES } from "@extynt/action-plan";
import { parseColor, type Rgb } from "./color.js";
import { applyVector, type Matrix } from "./transform.js";
import type { SvgElement } from "./xml.js";

/** A `<filter>` element: its id and the primitives inside it. */
export interface FilterDefinition { readonly id: string; readonly children: readonly SvgElement[] }
/** A `<clipPath>` element: its id, its geometry elements and whether its units follow the clipped bounding box. */
export interface ClipPathDefinition { readonly id: string; readonly element: SvgElement; readonly children: readonly SvgElement[]; readonly boundingBoxUnits: boolean }

interface DropShadow { readonly dx: number; readonly dy: number; readonly stdDeviation: number; readonly floodColor: Rgb; readonly floodOpacity: number }

type ResolvedFilter =
  | { readonly kind: "gaussian-blur"; readonly blur: { readonly stdDeviation: number } }
  | { readonly kind: "drop-shadow"; readonly shadow: DropShadow }
  | { readonly kind: "glow"; readonly glow: { readonly stdDeviation: number } };

type AeBlendMode = typeof ALL_BLEND_MODES[number];

const SVG_TO_AE_BLEND_MODES: Readonly<Record<string, AeBlendMode>> = {
  multiply: "MULTIPLY", screen: "SCREEN", overlay: "OVERLAY", darken: "DARKEN", lighten: "LIGHTEN",
  "color-dodge": "COLOR_DODGE", "color-burn": "COLOR_BURN", "hard-light": "HARD_LIGHT", "soft-light": "SOFT_LIGHT",
  difference: "DIFFERENCE", exclusion: "EXCLUSION", hue: "HUE", saturation: "SATURATION", color: "COLOR", luminosity: "LUMINOSITY",
};

function collect(root: SvgElement, name: string, save: (element: SvgElement) => void): void {
  if (root.name === name) save(root);
  for (const child of root.children) collect(child, name, save);
}

/** Every `<filter>` in the document, by id. */
export function collectFilters(root: SvgElement): Map<string, FilterDefinition> {
  const filters = new Map<string, FilterDefinition>();
  collect(root, "filter", (element) => {
    const id = element.attributes.id;
    if (id) filters.set(id, { id, children: element.children });
  });
  return filters;
}

/** Every `<clipPath>` in the document, by id. */
export function collectClipPaths(root: SvgElement): Map<string, ClipPathDefinition> {
  const clipPaths = new Map<string, ClipPathDefinition>();
  collect(root, "clippath", (element) => {
    const id = element.attributes.id;
    if (!id) return;
    const units = element.attributes.clipPathUnits ?? element.attributes.clippathunits;
    clipPaths.set(id, { id, element, children: element.children, boundingBoxUnits: units?.toLowerCase() === "objectboundingbox" });
  });
  return clipPaths;
}

/** The id in a `url(#id)` value that is nothing else, or undefined. */
export function referenceId(value: string): string | undefined {
  return /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/u.exec(value.trim())?.[1];
}

function numberAttribute(element: SvgElement, name: string, fallback = 0): number | undefined {
  const value = Number.parseFloat(element.attributes[name] ?? String(fallback));
  return Number.isFinite(value) ? value : undefined;
}

function stdDeviation(element: SvgElement): number | undefined {
  const values = (element.attributes.stdDeviation?.trim() || "0").split(/[\s,]+/u).map(Number);
  if (values.length < 1 || values.length > 2 || values.some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  return values.length === 2 && values[0] !== values[1] ? undefined : values[0];
}

function anisotropic(child: SvgElement): boolean {
  if (child.name !== "fegaussianblur" && child.name !== "fedropshadow") return false;
  const values = child.attributes.stdDeviation?.trim().split(/[\s,]+/u).map(Number) ?? [];
  return values.length === 2 && values.every(Number.isFinite) && values[0] !== values[1];
}

/** Why a filter cannot be mapped even though it was recognised, or undefined when it has no such flaw. */
export function unsupportedFilterReason(id: string, filters: ReadonlyMap<string, FilterDefinition>): string | undefined {
  const children = filters.get(id)?.children ?? [];
  return children.some(anisotropic) ? "nonuniform stdDeviation needs separate horizontal and vertical blur, which a single After Effects effect cannot preserve" : undefined;
}

function sourceGraphic(element: SvgElement): boolean {
  return (element.attributes.in ?? "SourceGraphic").trim().toLowerCase() === "sourcegraphic";
}

function shadowOf(element: SvgElement): DropShadow | undefined {
  const dx = numberAttribute(element, "dx"), dy = numberAttribute(element, "dy"), sigma = stdDeviation(element);
  const color = parseColor(element.attributes["flood-color"] ?? "black");
  const opacity = numberAttribute(element, "flood-opacity", 1);
  if (dx === undefined || dy === undefined || sigma === undefined || !color || opacity === undefined) return undefined;
  return { dx, dy, stdDeviation: sigma, floodColor: color.rgb, floodOpacity: Math.min(1, Math.max(0, opacity)) * color.alpha };
}

/** AE's single blur radius can represent a rotated uniform SVG transform; this is its scale, or undefined for a skewed or stretched one. */
export function effectScale(matrix: Matrix): number | undefined {
  const [a, b, c, d] = matrix;
  const x = Math.hypot(a, b), y = Math.hypot(c, d);
  if (x <= 0 || y <= 0 || Math.abs(x - y) > 1e-6 * Math.max(x, y) || Math.abs(a * c + b * d) > 1e-6 * x * y) return undefined;
  return x;
}

function singleEffect(element: SvgElement, scale: number, matrix: Matrix): ResolvedFilter | undefined {
  if (element.name === "fegaussianblur" && sourceGraphic(element)) {
    const sigma = stdDeviation(element);
    return sigma === undefined ? undefined : { kind: "gaussian-blur", blur: { stdDeviation: sigma * scale } };
  }
  if (element.name !== "fedropshadow") return undefined;
  const shadow = shadowOf(element);
  if (!shadow) return undefined;
  const [dx, dy] = applyVector(matrix, [shadow.dx, shadow.dy]);
  return { kind: "drop-shadow", shadow: { ...shadow, dx, dy, stdDeviation: shadow.stdDeviation * scale } };
}

function mergesBlurWithSource(blur: SvgElement, merge: SvgElement): boolean {
  const nodes = merge.children.filter((child) => child.name === "femergenode");
  const blurName = blur.attributes.result ?? "blur";
  return nodes.length === 2 && nodes[0]?.attributes.in === blurName && nodes[1]?.attributes.in === "SourceGraphic";
}

function glowBlur(children: readonly SvgElement[]): SvgElement | undefined {
  const [blur, merge, ...rest] = children;
  if (!blur || !merge || rest.length > 0 || blur.name !== "fegaussianblur" || merge.name !== "femerge") return undefined;
  return mergesBlurWithSource(blur, merge) ? blur : undefined;
}

function glowEffect(children: readonly SvgElement[], scale: number): ResolvedFilter | undefined {
  const blur = glowBlur(children);
  if (!blur || !sourceGraphic(blur)) return undefined;
  const sigma = stdDeviation(blur);
  return sigma === undefined ? undefined : { kind: "glow", glow: { stdDeviation: sigma * scale } };
}

/** The After Effects effect a filter stands for under this transform, or undefined when it is not one of the supported patterns. */
export function resolveFilter(id: string, filters: ReadonlyMap<string, FilterDefinition>, matrix: Matrix): ResolvedFilter | undefined {
  const definition = filters.get(id);
  const scale = effectScale(matrix);
  if (!definition || scale === undefined) return undefined;
  const glow = glowEffect(definition.children, scale);
  if (glow) return glow;
  const [only, ...rest] = definition.children;
  return only && rest.length === 0 ? singleEffect(only, scale, matrix) : undefined;
}

/** A short phrase naming a filter and its primitives, for warnings. */
export function filterDescription(id: string, filters: ReadonlyMap<string, FilterDefinition>): string {
  const definition = filters.get(id);
  if (!definition) return `filter #${id} (definition not found)`;
  const children = definition.children.map((child) => child.name).join(", ") || "no primitives";
  return `filter #${id} (${children})`;
}

/** The After Effects blend mode for an SVG mix-blend-mode value, or undefined when there is none. */
export function mapBlendMode(svgMode: string): AeBlendMode | undefined {
  return SVG_TO_AE_BLEND_MODES[svgMode.trim().toLowerCase()];
}
