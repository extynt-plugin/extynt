/** Reads over a project snapshot: finding compositions, layers and properties, resolving a query to exactly one match, and summarising the project. */
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from "./model.js";

/** The outcome of resolving a query: exactly one match, none, several, or unknown because the snapshot does not cover the question. */
export type Resolution<T> =
  | { status: "found"; value: T }
  | { status: "unknown"; value: undefined }
  | { status: "missing"; value: undefined }
  | { status: "ambiguous"; value: T[] };

export function getActiveComposition(snapshot: ProjectSnapshot): CompositionSnapshot | undefined {
  return snapshot.activeCompositionId ? findCompositionById(snapshot, snapshot.activeCompositionId) : undefined;
}

export function findCompositionById(snapshot: ProjectSnapshot, id: string): CompositionSnapshot | undefined {
  return snapshot.compositions.find((composition) => composition.id === id);
}

/** The open composition always exists in After Effects; when the snapshot does not hold it, it has not been read yet, and the agent must not be told it is not in the project. */
export function openCompositionNotRead(snapshot: ProjectSnapshot, id: string): string | undefined {
  if (!id || snapshot.activeCompositionId !== id || findCompositionById(snapshot, id)) return undefined;
  return `Composition ${id} is open in After Effects but has not been read yet (it is still being read, or the read of it did not finish). Call ae_refresh_snapshot and try again; do not ask the user which composition it is.`;
}

export function findCompositionsByName(snapshot: ProjectSnapshot, name: string): CompositionSnapshot[] {
  return snapshot.compositions.filter((composition) => composition.name === name);
}

export function resolveComposition(snapshot: ProjectSnapshot, query: { id?: string; name?: string }): Resolution<CompositionSnapshot> {
  const matches = query.id !== undefined
    ? snapshot.compositions.filter((composition) => composition.id === query.id)
    : query.name !== undefined ? findCompositionsByName(snapshot, query.name) : [];
  const result = resolve(matches);
  if (snapshot.coverage && (query.id === undefined || result.status === "missing")) return { status: "unknown", value: undefined };
  return result;
}

/** Filters for `queryLayers`; an omitted or undefined field matches every layer. */
export type LayerQuery = {
  compositionId?: string | undefined;
  id?: string;
  name?: string;
  type?: LayerSnapshot["type"];
  selected?: boolean;
};

/** The layers matching `query`, in stack order: composition array order is the AE stack order (LayerSnapshot.index 1 is the top layer), and layer ids are project-wide creation counters, so sorting by id would replace stack order with a meaningless lexical order. */
export function queryLayers(snapshot: ProjectSnapshot, query: LayerQuery = {}): LayerSnapshot[] {
  const compositions = query.compositionId
    ? snapshot.compositions.filter((composition) => composition.id === query.compositionId)
    : snapshot.compositions;
  return compositions.flatMap((composition) => composition.layers).filter(layerMatches(query));
}

function layerMatches(query: LayerQuery): (layer: LayerSnapshot) => boolean {
  return (layer) => (query.id === undefined || layer.id === query.id) &&
    (query.name === undefined || layer.name === query.name) &&
    (query.type === undefined || layer.type === query.type) &&
    (query.selected === undefined || layer.isSelected === query.selected);
}

/** The layers `matches` accepts, scoped the way a request names a layer: the open composition's matches when it holds any, otherwise every match in the project. Stack order is kept. */
export function layersInScope(snapshot: ProjectSnapshot, matches: (layer: LayerSnapshot) => boolean): { layers: LayerSnapshot[]; scope: "open-composition" | "project" } {
  const open = getActiveComposition(snapshot)?.layers.filter(matches) ?? [];
  if (open.length > 0) return { layers: open, scope: "open-composition" };
  return { layers: snapshot.compositions.flatMap((composition) => composition.layers).filter(matches), scope: "project" };
}

export function getSelectedLayers(snapshot: ProjectSnapshot, compositionId = snapshot.selection.compositionId): LayerSnapshot[] {
  return queryLayers(snapshot, { compositionId: compositionId ?? undefined, selected: true });
}

export function resolveLayer(snapshot: ProjectSnapshot, query: LayerQuery): Resolution<LayerSnapshot> {
  const layers = query.compositionId === undefined ? layersInScope(snapshot, layerMatches(query)).layers : queryLayers(snapshot, query);
  const result = resolve(layers);
  return snapshot.coverage && (query.compositionId !== snapshot.coverage.compositionId || snapshot.coverage.otherLayers === "unknown") && (query.id === undefined || result.status === "missing") ? { status: "unknown", value: undefined } : result;
}

export function findProperty(layer: LayerSnapshot, query: { path?: string; matchName?: string }): PropertySnapshot | undefined {
  const all = flattenProperties(layer.properties);
  return all.find((property) => (query.path === undefined || property.path === query.path) &&
    (query.matchName === undefined || property.matchName === query.matchName));
}

export function flattenProperties(properties: PropertySnapshot[]): PropertySnapshot[] {
  return properties.flatMap((property) => [property, ...flattenProperties(property.children ?? [])]);
}

/** Nests the flat, path-carrying properties the host probe publishes into the tree a ProjectSnapshot holds, so `extractEffects` (which looks for "ADBE Effect Parade" and reads `children`) can see them. Already-nested input is returned untouched, so a deliberately built tree is never re-parented; a property nests under the nearest earlier property that is a strict `/`-boundary prefix of its path. */
export function nestPropertyPaths(properties: readonly PropertySnapshot[]): PropertySnapshot[] {
  if (properties.some((property) => (property.children ?? []).length > 0)) return [...properties];
  const roots: PropertySnapshot[] = [];
  const stack: Array<{ path: string; node: PropertySnapshot }> = [];
  for (const property of properties) {
    const node: PropertySnapshot = { ...property };
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top || property.path.startsWith(`${top.path}/`)) break;
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) (parent.node.children ??= []).push(node);
    else roots.push(node);
    stack.push({ path: property.path, node });
  }
  return roots;
}

/** Counts of a snapshot's compositions and layers; only the active selection is counted as selected, since AE keeps a per-composition selection. */
export type SnapshotSummary = {
  compositionCount: number;
  layerCount: number;
  selectedLayerCount: number;
  layersByType: Record<string, number>;
};

/** The compact structural answer for a snapshot. */
export function summarizeSnapshot(snapshot: ProjectSnapshot): SnapshotSummary {
  const layers = snapshot.compositions.flatMap((composition) => composition.layers);
  const layersByType: Record<string, number> = {};
  for (const layer of layers) layersByType[layer.type] = (layersByType[layer.type] ?? 0) + 1;
  return {
    compositionCount: snapshot.compositions.length,
    layerCount: layers.length,
    selectedLayerCount: snapshot.selection.layerIds.length,
    layersByType,
  };
}

function resolve<Match>(matches: Match[]): Resolution<Match> {
  if (matches.length > 1) return { status: "ambiguous", value: matches };
  const [only] = matches;
  return only === undefined ? { status: "missing", value: undefined } : { status: "found", value: only };
}
