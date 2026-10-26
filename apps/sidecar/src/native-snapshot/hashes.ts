/**
 * Per-layer content hashes: which layers a read changed, and a merge that keeps the unchanged layers' rows (and the details already fetched for them).
 * A layer read before stands for the layer read now when the hash and the read depth agree, except a text layer: the hash covers its text but not its
 * styling, so it is reused only when the project is provably unedited since (same run, same revision).
 */
import type { ChangedLayers, CompositionHashEntry, LayerHashEntry, LayerHashIndex, NativeReadSet } from "./types.js";
import type { Row } from "../snapshot-view.js";
import { readCompositions } from "./read-set.js";
import { compositionsOf, layerProperties, layersOf, type CompositionFacts, type LayerFacts } from "./row-facts.js";

interface Hashed { composition: CompositionFacts; layers: LayerFacts[]; entry: CompositionHashEntry }
interface Revisions { before: CompositionHashEntry | undefined; now: CompositionHashEntry | undefined }

function hasTextDocument(layer: LayerFacts): boolean {
  return layer.type === "text" || layerProperties(layer).some((property) => property.value?.unsupported === "text-document");
}

function revisionKey(read: NativeReadSet): string | null {
  const { epoch, revision, projectPath } = read.stamp;
  return revision === null ? null : [read.ping.pid, epoch, revision, projectPath ?? ""].join("|");
}

function entryOf(layer: LayerFacts, revision: string | null): LayerHashEntry | null {
  return layer.hash === undefined ? null : { hash: layer.hash, full: layer.propertyRows !== null, text: hasTextDocument(layer), revision };
}

function hashedOf(composition: CompositionFacts, revision: string | null): Hashed {
  const layers = layersOf(composition), entries: CompositionHashEntry["layers"] = {};
  for (const layer of layers) { const entry = entryOf(layer, revision); if (entry) entries[layer.id] = entry; }
  return { composition, layers, entry: { hash: composition.hash ?? null, layers: entries } };
}

function hashedRead(read: NativeReadSet): Hashed[] {
  const revision = revisionKey(read);
  return readCompositions(read).map((composition) => hashedOf(composition, revision));
}

function indexOf(hashed: readonly Hashed[]): LayerHashIndex {
  const compositions: LayerHashIndex["compositions"] = {};
  for (const { composition, entry } of hashed) compositions[composition.id] = entry;
  return { compositions };
}

/** The hashes a read carries; empty for a read made without `hashes: true`. */
export function layerHashIndex(read: NativeReadSet): LayerHashIndex {
  return indexOf(hashedRead(read));
}

function sameLayer(was: LayerHashEntry | undefined, is: LayerHashEntry | undefined): boolean {
  if (!was || !is || was.hash !== is.hash || was.full !== is.full) return false;
  return !is.text || (was.revision !== null && was.revision === is.revision);
}

function changedIn({ composition, layers }: Hashed, entries: Revisions): ChangedLayers["layers"] {
  return layers.filter((layer) => !sameLayer(entries.before?.layers[layer.id], entries.now?.layers[layer.id])).map((layer) => ({ compId: composition.id, layerId: layer.id }));
}

function sameComposition(entries: Revisions): boolean {
  const { before, now } = entries;
  return !!before && !!now && before.hash !== null && before.hash === now.hash;
}

/** Layers whose hash differs from `previous` (or that `previous` never had, or that have no hash at all) are changed; a composition is changed when its own hash differs or any layer is. */
export function changedLayers(previous: LayerHashIndex, read: NativeReadSet): ChangedLayers {
  const compositions: string[] = [], layers: ChangedLayers["layers"] = [];
  for (const hashed of hashedRead(read)) {
    const entries = { before: previous.compositions[hashed.composition.id], now: hashed.entry }, moved = changedIn(hashed, entries);
    if (!sameComposition(entries) || moved.length) compositions.push(hashed.composition.id);
    layers.push(...moved);
  }
  return { compositions, layers };
}

function unchangedLayerIds(previous: LayerHashIndex, current: LayerHashIndex, compId: string): Set<string> {
  const before = previous.compositions[compId]?.layers ?? {}, now = current.compositions[compId]?.layers ?? {};
  return new Set(Object.keys(now).filter((layerId) => sameLayer(before[layerId], now[layerId])));
}

interface Merge { held: ReadonlyMap<string, CompositionFacts>; previous: LayerHashIndex; current: LayerHashIndex }

function mergedComposition(fresh: CompositionFacts, merge: Merge): Row {
  const known = merge.held.get(fresh.id);
  if (!known) return fresh.row;
  const same = unchangedLayerIds(merge.previous, merge.current, fresh.id), heldLayers = new Map(layersOf(known).map((layer) => [layer.id, layer.row]));
  const layers = layersOf(fresh).map((layer) => (same.has(layer.id) ? heldLayers.get(layer.id) ?? layer.row : layer.row));
  return { ...fresh.row, layers };
}

/** The composition rows of `fresh` with every unchanged layer replaced by the row `base` already holds (details included). `base` rows are only used for layers whose hash and detail match. */
export function mergeLayersByHash(base: readonly Row[] | undefined, previous: LayerHashIndex, read: NativeReadSet, fresh: readonly Row[]): Row[] {
  const merge: Merge = { held: new Map(compositionsOf(base ?? []).map((composition) => [composition.id, composition])), previous, current: layerHashIndex(read) };
  return compositionsOf(fresh).map((composition) => mergedComposition(composition, merge));
}
