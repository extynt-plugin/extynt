/** Readback comparison for the composition and native layers created from SVG. */

interface VectorArtworkLayer {
  readonly inPoint?: number;
  readonly outPoint?: number;
}

interface VectorArtworkComposition {
  readonly truncated?: boolean;
  readonly duration?: number;
  readonly frameRate?: number;
  readonly layers?: readonly VectorArtworkLayer[];
}

const TOLERANCE_SECONDS = 0.0001;

function sameTime(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Number.isFinite(actual) && Math.abs(actual - expected) <= TOLERANCE_SECONDS;
}

function layerMatches(layer: VectorArtworkLayer, duration: number): boolean {
  return sameTime(layer.inPoint, 0) && sameTime(layer.outPoint, duration);
}

function isComparable(comp: VectorArtworkComposition | null, duration: number, frameRate: number): comp is VectorArtworkComposition {
  return comp !== null && comp.truncated !== true && Number.isFinite(duration) && Number.isFinite(frameRate);
}

/** True when the readback matches the requested timing, false when it differs, null when the readback cannot say. */
export function vectorArtworkTimingMatches(comp: VectorArtworkComposition | null, duration: number, frameRate: number): boolean | null {
  if (!isComparable(comp, duration, frameRate)) return null;
  if (!sameTime(comp.duration, duration) || !sameTime(comp.frameRate, frameRate)) return false;
  if (!comp.layers) return null;
  return comp.layers.length > 0 && comp.layers.every((layer) => layerMatches(layer, duration));
}
