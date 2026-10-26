// Read-back comparison for the composition and native layers created from SVG: its duration, frame rate and the span of every layer.
import type { SnapshotComposition, SnapshotLayer } from "./snapshot-reply.js";

const TIME_TOLERANCE = 0.0001;

function sameTime(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= TIME_TOLERANCE;
}

function spans(layer: SnapshotLayer, duration: number): boolean {
  return sameTime(layer.inPoint, 0) && sameTime(layer.outPoint, duration);
}

function layersSpan(comp: SnapshotComposition, duration: number): boolean | null {
  const { layers } = comp;
  return layers ? layers.length > 0 && layers.every((layer) => spans(layer, duration)) : null;
}

/** Whether the composition read back has the duration and frame rate the artwork was created with and every layer spans it; null when the read cannot say. */
export function vectorArtworkTimingMatches(comp: SnapshotComposition | null, duration: number | undefined, frameRate: number | undefined): boolean | null {
  if (!comp || comp.truncated || duration === undefined || frameRate === undefined) return null;
  if (!sameTime(comp.duration, duration) || !sameTime(comp.frameRate, frameRate)) return false;
  return layersSpan(comp, duration);
}
