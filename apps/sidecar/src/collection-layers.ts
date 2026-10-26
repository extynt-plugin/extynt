// Assembly of a composition's layer inventory from successive native pages, rejecting gaps, duplicates and a project that changed between pages.
import { boolean, decodeOrCode, jsonObject, jsonValue, literal, number, object, optional } from "@extynt/decode";
import { boundedText, integerFrom } from "./native-field-decoders.js";
import type { CollectionJob, CollectionPage, CollectionTicket, LayerAssembly, LayerMetadata, LayerRow, RetainedCollectionRow } from "./collection-job.js";
import type { CollectionTarget } from "./collection-request.js";

const INVENTORY_CODE = "INVALID_LAYER_INVENTORY";
const METADATA_CODE = "INVALID_LAYER_METADATA";
const INCOMPLETE_CODE = "INCOMPLETE_LAYER_INVENTORY";
const MAX_LAYERS = 1024;
const MAX_INVENTORY_BYTES = 4194304;
const layerFacts = object({
  id: boundedText(4096), index: integerFrom(0), layerIndex: integerFrom(0), locked: boolean(), selected: boolean(),
  detail: literal("layer-index"), properties: literal("unknown"), values: literal("not-read"),
  compositionId: optional(jsonValue), stamp: optional(jsonValue),
});
const metadataShape = object({ composition: jsonObject, runtime: jsonObject, project: jsonObject, layerCount: integerFrom(0) });
const compositionFacts = object({
  id: boundedText(256), itemIndex: number(), name: boundedText(4096), width: number(), height: number(), duration: number(), frameRate: number(),
});

interface LayerBinding { ids: ReadonlySet<string>; compositionId: string | undefined; stamp: string }

function layerRow(source: RetainedCollectionRow["source"], ordinal: number, binding: LayerBinding): LayerRow {
  const facts = decodeOrCode(layerFacts, source, INVENTORY_CODE);
  const unbound = facts.compositionId !== undefined && facts.compositionId !== binding.compositionId;
  const restamped = facts.stamp !== undefined && JSON.stringify(facts.stamp) !== binding.stamp;
  if (facts.index !== ordinal || facts.layerIndex !== ordinal || binding.ids.has(facts.id) || unbound || restamped) throw Error(INVENTORY_CODE);
  return { id: facts.id, index: facts.index, selected: facts.selected, raw: source };
}

function validateLayerRows(rows: readonly RetainedCollectionRow[], page: CollectionPage, pending: CollectionTicket, job: CollectionJob): LayerRow[] {
  if (page.kind !== "layers") throw Error(INVENTORY_CODE);
  const previous = job.layers ?? [], ids = new Set(previous.map((layer) => layer.id)), added: LayerRow[] = [];
  rows.forEach((row, offset) => {
    const layer = layerRow(row.source, pending.cursor + offset, { ids, compositionId: job.target.compositionId, stamp: page.stamp.key });
    ids.add(layer.id); added.push(layer);
  });
  if (page.nextCursor !== null && (page.rows.length === 0 || page.nextCursor !== pending.cursor + page.rows.length)) throw Error(INVENTORY_CODE);
  return [...previous, ...added];
}

function validateLayerMetadata(raw: CollectionPage["metadata"], target: CollectionTarget): LayerMetadata {
  const shape = decodeOrCode(metadataShape, raw, METADATA_CODE), composition = decodeOrCode(compositionFacts, shape.composition, METADATA_CODE);
  if (composition.id !== target.compositionId || composition.itemIndex !== target.itemIndex) throw Error(METADATA_CODE);
  return { raw: decodeOrCode(jsonObject, raw, METADATA_CODE), json: JSON.stringify(raw), layerCount: shape.layerCount, composition: shape.composition, compositionId: composition.id };
}

function validateLayerExtent(page: CollectionPage, pending: CollectionTicket, count: number): void {
  const last = pending.cursor + page.rows.length - 1;
  if (last > count || (page.nextCursor === null ? last !== count : page.nextCursor > count)) throw Error(INCOMPLETE_CODE);
}

function boundedAssembly(layers: LayerRow[], metadata: LayerMetadata, terminal: boolean): LayerAssembly {
  if (layers.length > MAX_LAYERS) throw Error("METADATA_MEMORY_LIMIT");
  if (Buffer.byteLength(JSON.stringify(layers.map((layer) => layer.raw))) + Buffer.byteLength(metadata.json) > MAX_INVENTORY_BYTES) throw Error("METADATA_BYTE_LIMIT");
  const intact = layers.length === metadata.layerCount && new Set(layers.map((layer) => layer.id)).size === metadata.layerCount && layers.every((layer, offset) => layer.index === offset + 1);
  if (terminal && !intact) throw Error(INCOMPLETE_CODE);
  return { layers, metadata, complete: terminal };
}

/** Folds one validated layers page into the inventory so far; the result is `complete` once the last page of a bounded inventory has arrived. */
export function assembleCollectionLayers(page: CollectionPage, pending: CollectionTicket, job: CollectionJob, rows: readonly RetainedCollectionRow[]): LayerAssembly {
  if (job.target.kind !== "layers") return { complete: false };
  const layers = validateLayerRows(rows, page, pending, job);
  if (page.stamp.revision === null) return { complete: false };
  const metadata = validateLayerMetadata(page.metadata, job.target);
  if (job.metadata && metadata.json !== job.metadata.json) throw Error("PROJECT_CHANGED");
  validateLayerExtent(page, pending, metadata.layerCount);
  if (metadata.layerCount <= MAX_LAYERS && job.inventoryFromFirst) return boundedAssembly(layers, metadata, page.nextCursor === null);
  return { metadata, complete: false };
}
