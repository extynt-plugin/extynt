/**
 * The jsx details call (aeReadPropertyDetails) supplies what a native read leaves out: text documents (`{unsupported: "text-document"}`)
 * and key digests. compare asks for them with --details and folds them into the native rows, so those values are compared with the probe's.
 */
import { boolean, decodeJson, fallback, isJsonArray, isJsonObject, isNotJson, jsonObject, object, optional, skippingInvalid, string } from "@extynt/decode";
import type { JsonObject, JsonValue } from "@extynt/decode";
import { fieldText, unsupportedKind } from "./compare-core.ts";
import type { DetailsStats } from "./compare-core.ts";
import { flagAt, rowsAt, textAt } from "./json-access.ts";

/** The jsx entry the details call runs. */
export const DETAILS_ENTRY = "aeReadPropertyDetails";
/** The most layers one details call is asked to read. */
export const DETAILS_MAX_LAYERS = 256;

const ENVELOPE = object({
  ok: boolean(),
  error: optional(fallback(object({ message: optional(fallback(string(), undefined)) }), undefined)),
  layers: optional(fallback(skippingInvalid(jsonObject), undefined)),
});

/** The layers of one composition a details call must read. */
export interface DetailsScope {
  readonly compId: string;
  readonly layerIds: ReadonlyArray<string>;
}

/** The argument of the details call. */
export interface DetailsRequest {
  readonly scopes: ReadonlyArray<DetailsScope>;
  readonly include: ReadonlyArray<string>;
  readonly maxLayers: number;
}

/** The parsed answer of the details call: the layers it read, or why it failed. */
export type DetailsAnswer =
  | { readonly ok: true; readonly layers: ReadonlyArray<JsonObject> }
  | { readonly ok: false; readonly layers: ReadonlyArray<JsonObject>; readonly error: string };

/** The native rows with the details folded in, and what was merged. */
export interface MergedDetails {
  readonly native: JsonObject;
  readonly stats: DetailsStats;
}

const isTextDocument = (value: JsonValue | undefined): boolean => unsupportedKind(value) === "text-document";

function needsDetails(entry: JsonObject): boolean {
  const keyframes = entry.keyframeCount;
  return isTextDocument(entry.value) || (typeof keyframes === "number" && keyframes > 0);
}

function layerIdsNeedingDetails(composition: JsonObject, limit: number): string[] {
  return rowsAt(composition, "layers")
    .filter((layer) => rowsAt(layer, "propertyPaths").some(needsDetails))
    .map((layer) => fieldText(layer, "id"))
    .slice(0, limit);
}

/** The details request for a native read_project result: every layer with a text document or a keyed property, up to the call's layer cap; null when none. */
export function detailsRequest(native: JsonObject): DetailsRequest | null {
  const scopes: DetailsScope[] = [];
  let budget = DETAILS_MAX_LAYERS;
  for (const composition of rowsAt(native, "compositions")) {
    const layerIds = layerIdsNeedingDetails(composition, budget);
    if (layerIds.length) scopes.push({ compId: fieldText(composition, "id"), layerIds });
    budget -= layerIds.length;
  }
  return scopes.length ? { scopes, include: ["textDocument", "keyDigest"], maxLayers: DETAILS_MAX_LAYERS } : null;
}

function detailsFailure(error: string): DetailsAnswer {
  return { ok: false, layers: [], error };
}

/** The parsed answer of the call: `{ok, layers}`; anything else is reported as a failure, never a partial merge. */
export function parseDetails(text: string): DetailsAnswer {
  const decoded = decodeJson(text, ENVELOPE);
  if (!decoded.ok) return detailsFailure(isNotJson(decoded.error) ? "the details call did not return JSON" : "the details call returned an unexpected shape");
  const { ok, error, layers } = decoded.value;
  if (!ok) return detailsFailure(error?.message ?? "the details call failed");
  return layers ? { ok: true, layers } : detailsFailure("the details call returned no layers");
}

function mergeProperty(row: JsonObject, detail: JsonObject, stats: DetailsStats): JsonObject {
  let merged = row;
  const document = detail.value;
  if (isTextDocument(row.value) && document !== undefined) {
    merged = { ...merged, value: document };
    stats.textDocuments += 1;
  }
  const digest = textAt(detail, "keyDigest");
  if (digest === undefined) return merged;
  merged = { ...merged, keyDigest: digest, ...(flagAt(detail, "keyDigestTruncated") === true ? { keyDigestTruncated: true } : {}) };
  stats.keyDigests += 1;
  return merged;
}

function mapRows(row: JsonObject, key: string, change: (entry: JsonObject) => JsonObject): JsonObject {
  const found = row[key];
  if (!isJsonArray(found)) return row;
  return { ...row, [key]: found.map((entry) => (isJsonObject(entry) ? change(entry) : entry)) };
}

function layerKey(compId: string, layerId: string): string {
  return `${compId}\u0000${layerId}`;
}

function indexLayers(native: JsonObject): Map<string, JsonObject> {
  const layers = new Map<string, JsonObject>();
  for (const composition of rowsAt(native, "compositions")) {
    for (const layer of rowsAt(composition, "layers")) layers.set(layerKey(fieldText(composition, "id"), fieldText(layer, "id")), layer);
  }
  return layers;
}

function mergeLayer(layer: JsonObject, detail: JsonObject, merged: Map<JsonObject, JsonObject>, stats: DetailsStats): void {
  const rows = new Map<string, JsonObject>();
  for (const row of rowsAt(layer, "propertyPaths")) rows.set(String(row.path), row);
  for (const property of rowsAt(detail, "properties")) {
    const row = rows.get(String(property.path));
    if (row) merged.set(row, mergeProperty(merged.get(row) ?? row, property, stats));
    else stats.unmatched += 1;
  }
}

function rebuild(native: JsonObject, merged: ReadonlyMap<JsonObject, JsonObject>): JsonObject {
  const properties = (layer: JsonObject): JsonObject => mapRows(layer, "propertyPaths", (row) => merged.get(row) ?? row);
  return mapRows(native, "compositions", (composition) => mapRows(composition, "layers", properties));
}

/**
 * A copy of `native` with the details folded in, and what was merged. Detail entries that match no native row are counted as `unmatched`
 * (the compare cannot vouch for them); a failed call merges nothing.
 */
export function mergeDetails(native: JsonObject, details: DetailsAnswer): MergedDetails {
  const stats: DetailsStats = {
    requested: true, ok: details.ok, error: details.ok ? null : details.error, layers: 0, textDocuments: 0, keyDigests: 0, unmatched: 0,
  };
  const layers = indexLayers(native);
  const merged = new Map<JsonObject, JsonObject>();
  for (const detail of details.ok ? details.layers : []) {
    const layer = layers.get(layerKey(fieldText(detail, "compId"), fieldText(detail, "layerId")));
    if (!layer) {
      stats.unmatched += 1;
      continue;
    }
    stats.layers += 1;
    mergeLayer(layer, detail, merged, stats);
  }
  return { native: rebuild(native, merged), stats };
}
