// Finds real effects in the user's project that the catalogue could not probe, so the collector can ask the panel to read their controls one at a time.
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot } from "@extynt/project-graph";

/** The one real effect the host is asked to read: found in the user's project, named by ids and position, verified by the host before it reads. */
export interface InstanceTarget { matchName: string; compId: string; layerId: string; effectIndex: number }

/** The host function that reads one effect instance. */
export const INSTANCE_HOST_FUNCTION = "aeCatalogueReadInstance";

/** The request the host receives for one instance read. */
export interface InstanceHostRequest { schemaVersion: "0.1"; requestId: string; matchName: string; compId: string; layerId: string; effectIndex: number }

/** The host answered that the project is no longer what the snapshot showed; a later snapshot may still find the effect. */
export const MOVED_CODES: ReadonlySet<string> = new Set(["NO_PROJECT", "COMP_NOT_FOUND", "LAYER_NOT_FOUND", "EFFECT_NOT_FOUND", "EFFECT_MISMATCH"]);

/** The read never ran in AE (an AE still holding an older catalogue.jsx answers "EvalScript error.", a busy lane, a hidden panel), so it says nothing about the effect. */
export const NOT_RUN_CODES: ReadonlySet<string> = new Set(["INVALID_PAGE", "HOST_BUSY", "HOST_BRIDGE_CANCELLED"]);

const EFFECT_PARADE = "ADBE Effect Parade";
const MAX_TARGETS = 64;
const MAX_LAYERS_SCANNED = 5000;
const MAX_MOVES = 3;

function layerEffects(layer: LayerSnapshot): Array<{ matchName: string; index: number }> {
  const parade = layer.properties.find((property) => property.matchName === EFFECT_PARADE);
  const roots = parade ? parade.children ?? [] : layer.properties.filter((property) => property.kind === "effect");
  return roots.map((property, position) => ({ matchName: property.matchName, index: position + 1 }));
}

function scanLayer(composition: CompositionSnapshot, layer: LayerSnapshot, wanted: ReadonlySet<string>, found: Map<string, InstanceTarget>): void {
  for (const effect of layerEffects(layer)) {
    if (wanted.has(effect.matchName) && !found.has(effect.matchName)) found.set(effect.matchName, { matchName: effect.matchName, compId: composition.id, layerId: layer.id, effectIndex: effect.index });
  }
}

function effectInstances(snapshot: ProjectSnapshot, wanted: ReadonlySet<string>): InstanceTarget[] {
  const found = new Map<string, InstanceTarget>();
  let scanned = 0;
  for (const composition of snapshot.compositions) {
    for (const layer of composition.layers ?? []) {
      if (found.size >= Math.min(wanted.size, MAX_TARGETS) || scanned++ >= MAX_LAYERS_SCANNED) return [...found.values()];
      scanLayer(composition, layer, wanted, found);
    }
  }
  return [...found.values()];
}

/** The host request that reads the target effect, answered under the given ticket. */
export function instanceHostRequest(ticket: string, target: InstanceTarget): InstanceHostRequest {
  return { schemaVersion: "0.1", requestId: ticket, matchName: target.matchName, compId: target.compId, layerId: target.layerId, effectIndex: target.effectIndex };
}

/** A project's effect instances waiting to be read, one effect at a time. In memory only: the journal records what was already read. */
export class InstanceQueue {
  private targets = new Map<string, InstanceTarget>();
  private scanned: string | undefined;
  private moved = new Map<string, number>();

  reset(): void {
    this.targets.clear();
    this.scanned = undefined;
    this.moved.clear();
  }

  observe(snapshot: ProjectSnapshot, wanted: ReadonlySet<string>): void {
    if (wanted.size === 0) { this.targets.clear(); return; }
    if (this.scanned === snapshot.fingerprint) return;
    this.scanned = snapshot.fingerprint;
    this.targets.clear();
    for (const target of effectInstances(snapshot, wanted)) if ((this.moved.get(target.matchName) ?? 0) < MAX_MOVES) this.targets.set(target.matchName, target);
  }

  next(eligible: (matchName: string) => boolean): InstanceTarget | undefined {
    for (const [name, target] of this.targets) {
      this.targets.delete(name);
      if (eligible(name)) return target;
    }
    return undefined;
  }

  noteMoved(matchName: string): boolean {
    const count = (this.moved.get(matchName) ?? 0) + 1;
    this.moved.set(matchName, count);
    this.scanned = undefined;
    return count < MAX_MOVES;
  }
}
