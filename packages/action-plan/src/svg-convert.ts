// The SVG converter's entry points: turns a validated SVG into shape layers, or says why it cannot, so a create_vector_artwork operation can carry a fallback.
import { CONVERTER_LIMITS, NoteSink, type ConvertedLayer, type ConvertedShape, type SvgConversion } from "./svg-convert-types.js";
import type { VectorArtworkFallback } from "./vector-artwork-decoder.js";
import { elementName, type SvgNode } from "./svg-node.js";
import { DEFAULT_STYLE, inheritStyle } from "./svg-style.js";
import { readFrame, type Frame } from "./svg-viewport.js";
import { walkElement, type WalkContext, type WalkState } from "./svg-walk.js";
import { indexIds, parseSvgTree } from "./svg-xml.js";

export type { VectorArtworkFallback };

function collectLayers(root: SvgNode, frame: Frame, context: WalkContext): ConvertedLayer[] {
  const state: WalkState = { matrix: frame.matrix, style: inheritStyle(DEFAULT_STYLE, root.attrs, context), opacity: 1 };
  const layers: ConvertedLayer[] = [];
  root.children.forEach((child, index) => {
    const shapes: ConvertedShape[] = [];
    walkElement(child, state, context, shapes);
    if (shapes.length > 0) layers.push({ name: elementName(child, index + 1), shapes });
  });
  return layers;
}

function layerProblem(layers: readonly ConvertedLayer[]): string | undefined {
  if (layers.length === 0) return "the SVG has no filled or stroked shapes the converter supports";
  return layers.length > CONVERTER_LIMITS.maxLayers ? `the SVG has more than ${CONVERTER_LIMITS.maxLayers} top-level elements` : undefined;
}

/** Converts a validated SVG into one After Effects shape layer per top-level element or group; never throws. */
export function convertSvg(svg: string): SvgConversion {
  const root = parseSvgTree(svg);
  if (!root || root.name !== "svg") return { ok: false, reason: "the SVG could not be read as one element tree" };
  const result = readFrame(root);
  if (!result.ok) return result;
  const { frame } = result;
  const notes = new NoteSink();
  const context: WalkContext = { ids: indexIds(root), notes, view: frame.viewport, budget: { shapes: 0, points: 0, error: undefined }, named: 0 };
  const layers = collectLayers(root, frame, context);
  if (context.budget.error) return { ok: false, reason: `${context.budget.error}; the converter fallback is unavailable` };
  const problem = layerProblem(layers);
  return problem ? { ok: false, reason: problem } : { ok: true, layers, size: frame.size, notes: notes.toNotes() };
}

/** The operation fields for `svg`: the converted layers, size and notes, or the reason there are none. */
export function vectorArtworkFallback(svg: string): VectorArtworkFallback {
  try {
    const converted = convertSvg(svg);
    return converted.ok ? { fallbackLayers: converted.layers, fallbackSize: converted.size, fallbackNotes: converted.notes } : { fallbackUnavailable: converted.reason };
  } catch {
    return { fallbackUnavailable: "the converter could not process this SVG" };
  }
}
