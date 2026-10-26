// The snapshot a rename read-set plan reconciles to: the before snapshot narrowed to the layers the host read back, each with the name, index and flags it reported.
import { decode } from "@extynt/decode";
import type { Infer, JsonObject, JsonValue } from "@extynt/decode";
import { readbackBound, reconciled } from "./metadata-plan.js";
import type { ReadSetPlan } from "./metadata-plan.js";
import { heldComposition, renameReadback } from "./metadata-shapes.js";
import type { CompositionView, Held, LayerRowView } from "./metadata-shapes.js";
import { layerKey } from "./verify-context.js";

type Renamed = Infer<typeof renameReadback>;
type Updates = ReadonlyMap<string, LayerRowView>;

function approvedRow(row: LayerRowView, index: number, operation: JsonObject | undefined): boolean {
  if (!operation || operation.operation !== "set_layer_name" || row.operationIndex !== index) return false;
  return row.compositionId === operation.compositionId && row.layerId === operation.layerId && row.name === operation.name && row.expectedName === operation.name;
}

function layerKnown(plan: ReadSetPlan, row: LayerRowView): boolean {
  const comp = plan.before.view.result.view.compositions.find((candidate) => candidate.view.id === row.compositionId);
  return comp !== undefined && comp.view.layers.some((layer) => layer.view.id === row.layerId);
}

function updatedLayer(comp: Held<CompositionView>, layer: CompositionView["layers"][number], updates: Updates): JsonObject {
  const row = layer.view.id === undefined ? undefined : updates.get(layerKey(comp.view.id, layer.view.id));
  return row ? { ...layer.row, name: row.name, index: row.layerIndex, locked: row.locked, selected: row.selected } : layer.row;
}

function retainedComposition(comp: Held<CompositionView>, observed: Renamed, updates: Updates): JsonObject | null {
  const fresh = decode(heldComposition, observed.compositions.find((row) => row.id === comp.view.id));
  if (!fresh.ok || fresh.value.view.itemIndex !== comp.view.itemIndex) return null;
  const ids = new Set(observed.rows.filter((row) => row.compositionId === comp.view.id).map((row) => row.layerId));
  const layers = comp.view.layers.filter((layer) => layer.view.id !== undefined && ids.has(layer.view.id)).map((layer) => updatedLayer(comp, layer, updates));
  return { ...comp.row, ...fresh.value.row, layers };
}

function retainedCompositions(plan: ReadSetPlan, observed: Renamed): ReadonlyArray<JsonObject> | null {
  const updates: Updates = new Map(observed.rows.map((row) => [layerKey(row.compositionId, row.layerId), row] as const));
  const kept: JsonObject[] = [];
  for (const comp of plan.before.view.result.view.compositions) {
    if (!observed.rows.some((row) => row.compositionId === comp.view.id)) continue;
    const next = retainedComposition(comp, observed, updates);
    if (!next) return null;
    kept.push(next);
  }
  return kept;
}

function resultOf(plan: ReadSetPlan, observed: Renamed, compositions: ReadonlyArray<JsonObject>): JsonObject {
  const { rows, activeCompositionId } = observed;
  return {
    compositions,
    coverage: { ...plan.before.view.result.view.coverage, otherLayers: "unknown", observedLayerIds: rows.map((row) => row.layerId) },
    activeCompositionId,
    selectedLayerIds: rows.filter((row) => row.selected && row.compositionId === activeCompositionId).map((row) => row.layerId),
  };
}

/** The reconciled snapshot when the readback names exactly the layers the plan renamed, to the names it asked for; otherwise null. */
export function renameSnapshot(plan: ReadSetPlan, readback: JsonValue | undefined, requestId: string): JsonObject | null {
  const decoded = decode(renameReadback, readback);
  if (!decoded.ok || !readbackBound(plan, decoded.value)) return null;
  const observed = decoded.value;
  const approved = observed.rows.every((row, index) => approvedRow(row, index, plan.command.operations[index]) && layerKnown(plan, row));
  const compositions = approved ? retainedCompositions(plan, observed) : null;
  return compositions ? reconciled(plan, observed, { requestId, result: resultOf(plan, observed, compositions) }) : null;
}
