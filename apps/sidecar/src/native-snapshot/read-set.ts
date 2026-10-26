/** Reads the parts of a `NativeReadSet` the envelope and the hash index both need. */
import type { NativeReadSet } from "./types.js";
import { compositionFacts, rowsOf, type CompositionFacts } from "./row-facts.js";

/** The compositions this read carries: every one of the project for a full read, the listed ones for a scoped read (a later result for the same id wins). */
export function readCompositions(read: NativeReadSet): CompositionFacts[] {
  const sources = read.scope.kind === "full" ? (read.project ? [read.project] : []) : read.comps;
  const byId = new Map<string, CompositionFacts>();
  for (const source of sources) for (const row of rowsOf(source.compositions)) { const composition = compositionFacts(row); if (composition) byId.set(composition.id, composition); }
  return [...byId.values()];
}

/** The result every part of the read agrees on for project facts: the project's own, else the first composition read's. */
export function anyResult(read: NativeReadSet): NativeReadSet["comps"][number] | undefined {
  return read.project ?? read.comps[0];
}
