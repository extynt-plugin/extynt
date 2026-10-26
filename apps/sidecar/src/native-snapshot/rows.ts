/** Native rows to probe rows: strips the plugin's hash members, resolves `{unsupported}` values, and folds in the jsx details. */
import type { JsonValue } from "@extynt/decode";
import type { Opaque } from "../snapshot-view.js";
import type { CompositionMarkers, LayerDetails, PropertyDetail } from "./types.js";
import type { Row } from "../snapshot-view.js";
import { layerProperties, layersOf, type CompositionFacts, type LayerFacts, type PropertyFacts, type ValueFact } from "./row-facts.js";

type Draft = Record<string, JsonValue>;
type DetailsLookup = (compId: string, layerId: string) => Map<string, PropertyDetail> | undefined;

const DETAIL_SUPPLIED = new Set(["text-document", "marker", "shape-path", "layer-id"]);

const without = (row: Row, keys: readonly string[]): Draft => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

/** The details a read was given, looked up by composition, layer, then path. */
export function detailsLookup(layers: readonly LayerDetails[] | undefined): DetailsLookup {
  const byLayer = new Map<string, Map<string, PropertyDetail>>();
  for (const layer of layers ?? []) byLayer.set(`${layer.compId}\u0000${layer.layerId}`, new Map(layer.properties.map((property) => [property.path, property])));
  return (compId, layerId) => byLayer.get(`${compId}\u0000${layerId}`);
}

function valueOf(value: ValueFact, detail: PropertyDetail | undefined): Opaque {
  if (value.unsupported === undefined) return value.raw;
  return DETAIL_SUPPLIED.has(value.unsupported) && detail && "value" in detail ? detail.value ?? null : null;
}

function probeProperty(property: PropertyFacts, detail: PropertyDetail | undefined): Draft {
  const row = without(property.row, ["hash", "dynFlags"]);
  const value = property.value ? valueOf(property.value, detail) : undefined;
  if (value !== undefined) row.value = value;
  if (detail?.keyDigest !== undefined) {
    row.keyDigest = detail.keyDigest;
    if (detail.keyDigestTruncated === true) row.keyDigestTruncated = true;
  }
  if (detail?.shapeKeys) row.shapeKeys = detail.shapeKeys;
  return row;
}

function probeLayer(compId: string, layer: LayerFacts, lookup: DetailsLookup): Draft {
  const row = without(layer.row, ["hash"]);
  if (layer.propertyRows === null) return row;
  const details = lookup(compId, layer.id);
  row.propertyPaths = layerProperties(layer).map((property) => probeProperty(property, details?.get(property.path ?? "")));
  return row;
}

/** `markers`: the composition's own marker list when the details call read it; the native read carries none, so a row without it simply does not know. */
export function probeComposition(composition: CompositionFacts, lookup: DetailsLookup, markers?: CompositionMarkers): Row {
  const row = without(composition.row, ["hash"]);
  if (markers) row.markers = markers;
  row.layers = layersOf(composition).map((layer) => probeLayer(composition.id, layer, lookup));
  return row;
}
