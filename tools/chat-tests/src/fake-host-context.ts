/**
 * The fixture's apply context: the project being edited, the placeholders bound so far, the objects this call
 * created, and the lookups that resolve a plan's targets against them.
 */

import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "@extynt/project-graph";
import { MINT_PREFIX } from "./fake-host-tables.js";
import { refuse, targetOf, type Field } from "./fake-host-values.js";
import type { WireObject } from "./wire-types.js";

/** Every verdict carries one of these; a success may carry a note naming what it minted. */
export type ApplyOutcome = string | void;

/** A declaration an earlier operation failed to create, so its dependents fail too. */
export interface FailedDeclaration { index: number; type: string }

/** Everything one apply call reads and writes. */
export interface FixtureApplyContext {
  readonly snapshot: ProjectSnapshot;
  readonly bindings: Record<string, string>;
  readonly failedDeclarations: Map<string, FailedDeclaration>;
  readonly createdCompositions: Map<string, CompositionSnapshot>;
  readonly createdLayers: Map<string, LayerSnapshot>;
  readonly createdMasks: Map<string, PropertySnapshot>;
  readonly createdShapeGroups: Map<string, PropertySnapshot>;
  readonly createdShapeItems: Map<string, PropertySnapshot>;
  readonly usedIds: Set<string>;
  evidence: WireObject;
  readonly evidenceByIndex: Map<number, WireObject>;
}

/** A fresh context over the snapshot, with every id it already uses reserved. */
export function createContext(snapshot: ProjectSnapshot): FixtureApplyContext {
  const usedIds = new Set<string>();
  for (const composition of snapshot.compositions) {
    usedIds.add(composition.id);
    for (const layer of composition.layers) usedIds.add(layer.id);
  }
  for (const item of snapshot.items ?? []) { usedIds.add(item.id); if (item.sourceId) usedIds.add(item.sourceId); }
  for (const source of snapshot.sources ?? []) usedIds.add(source.id);
  return {
    snapshot, bindings: {}, failedDeclarations: new Map(),
    createdCompositions: new Map(), createdLayers: new Map(), createdMasks: new Map(),
    createdShapeGroups: new Map(), createdShapeItems: new Map(), usedIds, evidence: {}, evidenceByIndex: new Map(),
  };
}

/** Deterministic, collision-free ids: fx-layer-1, fx-layer-2, ... per kind. */
export function mintId(context: FixtureApplyContext, kind: string): string {
  let ordinal = 1;
  while (context.usedIds.has(`${MINT_PREFIX}${kind}-${ordinal}`)) ordinal += 1;
  const id = `${MINT_PREFIX}${kind}-${ordinal}`;
  context.usedIds.add(id);
  return id;
}

/** Resolve a name through this call's bindings; an unbound name is returned unchanged. */
export function realName(context: FixtureApplyContext, value: string): string { return context.bindings[value] ?? value; }

function listedCompositions(snapshot: ProjectSnapshot): string {
  return snapshot.compositions.slice(0, 20).map((composition) => `${composition.id} "${composition.name}"`).join(", ") || "none";
}

/** The first layers of a composition, listed for a refusal message. */
export function listedLayers(composition: CompositionSnapshot): string {
  return composition.layers.slice(0, 24).map((layer) => `${layer.id} "${layer.name}" (${layer.type}, index ${layer.index})`).join(", ") || "none";
}

/** The composition a plan targets, through this call's bindings, or a refusal naming the ones that exist. */
export function resolveComposition(context: FixtureApplyContext, rawId: Field, type: string): CompositionSnapshot {
  if (typeof rawId !== "string" || rawId.length === 0) refuse("INVALID_TARGET", `${type} requires a target compositionId.`);
  const id = realName(context, rawId);
  const composition =
    context.snapshot.compositions.find((candidate) => candidate.id === id) ??
    [...context.createdCompositions.values()].find((candidate) => candidate.id === id);
  if (!composition)
    refuse("TARGET_NOT_FOUND", `The target composition ${rawId} is not in this fixture project. Compositions: ${listedCompositions(context.snapshot)}.`);
  return composition;
}

/** The unlocked layer a plan targets, with its composition, or a refusal. */
export function resolveLayer(context: FixtureApplyContext, operation: WireObject, type: string): { composition: CompositionSnapshot; layer: LayerSnapshot } {
  const target = targetOf(operation);
  const composition = resolveComposition(context, target.compositionId, type);
  const rawLayerId = target.layerId;
  if (typeof rawLayerId !== "string" || rawLayerId.length === 0) refuse("INVALID_TARGET", `${type} requires a target layerId.`);
  const layerId = realName(context, rawLayerId);
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) refuse("TARGET_NOT_FOUND", `No layer ${rawLayerId} in composition ${composition.id} "${composition.name}". Layers: ${listedLayers(composition)}.`);
  if (layer.locked) refuse("TARGET_LOCKED", `Layer ${layer.id} "${layer.name}" is locked, and After Effects refuses changes to a locked layer.`);
  return { composition, layer };
}

/** The property-object references a plan may address by ordinal or by placeholder. */
export function resolveOrdinal(parent: PropertySnapshot, matchName: string, ordinal: number): PropertySnapshot | undefined {
  const matches = (parent.children ?? []).filter((child) => child.matchName === matchName);
  return matches[ordinal - 1];
}

/** The one-based position of `target` among the parent's children named `matchName`. */
export function ordinalOf(parent: PropertySnapshot, matchName: string, target: PropertySnapshot): number {
  const matches = (parent.children ?? []).filter((child) => child.matchName === matchName);
  return matches.indexOf(target) + 1;
}
