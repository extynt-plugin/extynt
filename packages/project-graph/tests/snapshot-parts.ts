/** Accessors that fail a test with a clear message when the part of a snapshot a test asks for is absent. */
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot } from "../src/index.js";

/** The part itself, or a failure naming what was expected. */
export function required<Part>(part: Part | undefined, description: string): Part {
  if (part === undefined) throw new Error(`Expected ${description} to exist.`);
  return part;
}

/** The composition at `index` of the snapshot. */
export function compositionAt(snapshot: ProjectSnapshot, index = 0): CompositionSnapshot {
  return required(snapshot.compositions[index], `composition ${index}`);
}

/** The layer at `layerIndex` of the composition at `compositionIndex`. */
export function layerAt(snapshot: ProjectSnapshot, layerIndex = 0, compositionIndex = 0): LayerSnapshot {
  return required(compositionAt(snapshot, compositionIndex).layers[layerIndex], `layer ${layerIndex} of composition ${compositionIndex}`);
}
