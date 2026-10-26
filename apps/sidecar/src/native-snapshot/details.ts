/** Which layers still lack the facts only the jsx details call can supply, and the request that fetches them. */
import type { ProbeSnapshot } from "../server-types.js";
import { DETAIL_KINDS, orderedKinds } from "./detail-kinds.js";
import { compositionsOf, layerProperties, layersOf, rowsOf, type CompositionFacts, type LayerFacts, type PropertyFacts } from "./row-facts.js";
import { DETAILS_MAX_LAYERS, type DetailKind, type DetailScope, type PlanReach, type PropertyDetailsRequest } from "./types.js";

interface Wanted { allowed: ReadonlySet<DetailKind>; found: Set<DetailKind> }

const BOTH_KINDS: readonly DetailKind[] = ["textDocument", "keyDigest"];
const VALUE_KIND_BY_MATCH: ReadonlyMap<string, DetailKind> = new Map<string, DetailKind>([
  ["ADBE Text Document", "textDocument"], ["ADBE Marker", "marker"], ["ADBE Mask Shape", "maskPath"], ["ADBE Vector Shape", "shapePath"],
]);

function kindsNeeded(property: PropertyFacts): DetailKind[] {
  const kinds: DetailKind[] = [];
  if (property.keyframeCount !== undefined && property.keyframeCount > 0 && property.keyDigest === undefined) kinds.push("keyDigest");
  if (property.value && property.value.raw !== null) return kinds;
  const byMatch = VALUE_KIND_BY_MATCH.get(String(property.matchName));
  if (byMatch) kinds.push(byMatch);
  if (property.valueType === "layer") kinds.push("layerRef");
  return kinds;
}

function layerNeedsDetails(layer: LayerFacts, wanted: Wanted): boolean {
  let needed = false;
  for (const property of layerProperties(layer)) {
    for (const kind of kindsNeeded(property)) if (wanted.allowed.has(kind)) { wanted.found.add(kind); needed = true; }
  }
  return needed;
}

function layersToFetch(composition: CompositionFacts | undefined, ids: readonly string[] | undefined, wanted: Wanted): string[] | null {
  if (!composition) { for (const kind of wanted.allowed) wanted.found.add(kind); return ids ? [...ids] : null; }
  const layers = layersOf(composition).filter((layer) => !ids || ids.includes(layer.id));
  return layers.filter((layer) => layerNeedsDetails(layer, wanted)).map((layer) => layer.id);
}

function scopesNeeding(reach: PlanReach, held: ReadonlyMap<string, CompositionFacts>, wanted: Wanted): DetailScope[] {
  const scopes: DetailScope[] = [];
  let budget = DETAILS_MAX_LAYERS;
  for (const scope of reach.scopes) {
    if (budget <= 0) break;
    const ids = layersToFetch(held.get(scope.compId), scope.layerIds, wanted);
    if (ids && ids.length === 0) continue;
    const layerIds = ids ? ids.slice(0, budget) : undefined;
    budget -= layerIds ? layerIds.length : 0;
    scopes.push(layerIds ? { compId: scope.compId, layerIds } : { compId: scope.compId });
  }
  return scopes;
}

function withMarkers(request: PropertyDetailsRequest, markerCompositions: readonly string[]): PropertyDetailsRequest {
  return markerCompositions.length ? { ...request, markerCompositions: [...markerCompositions] } : request;
}

function missingRequest(reach: PlanReach, latest: ProbeSnapshot, kinds: readonly DetailKind[] | undefined): PropertyDetailsRequest | null {
  const held = new Map(compositionsOf(rowsOf(latest.result.compositions)).map((composition) => [composition.id, composition]));
  const wanted: Wanted = { allowed: new Set(kinds ?? DETAIL_KINDS), found: new Set() };
  const scopes = scopesNeeding(reach, held, wanted), markerCompositions = (reach.markerCompositions ?? []).filter((id) => held.get(id)?.hasMarkers !== true);
  if (scopes.length === 0 && markerCompositions.length === 0) return null;
  return withMarkers({ scopes, include: scopes.length ? orderedKinds(wanted.found) : [...BOTH_KINDS], maxLayers: DETAILS_MAX_LAYERS }, markerCompositions);
}

/**
 * The scopes of `reach` for which `latest` lacks text documents, key digests, marker lists, path values or layer references, with the kinds that are
 * actually missing. `kinds` limits what may be requested (default: every kind; with nothing known, text documents and key digests).
 * With no `latest` nothing is known, so the whole reach is requested. A layer a plan just wrote is stale in `latest` whatever it holds: ask for a
 * verify read with `latest` undefined and the plan's `kinds`.
 */
export function residualScopes(reach: PlanReach, latest: ProbeSnapshot | undefined, kinds?: readonly DetailKind[]): PropertyDetailsRequest | null {
  const markerIds = reach.markerCompositions ?? [];
  if (reach.scopes.length === 0 && markerIds.length === 0) return null;
  if (latest) return missingRequest(reach, latest, kinds);
  return withMarkers({ scopes: reach.scopes.map((scope) => ({ ...scope })), include: kinds ? orderedKinds(kinds) : [...BOTH_KINDS], maxLayers: DETAILS_MAX_LAYERS }, markerIds);
}
