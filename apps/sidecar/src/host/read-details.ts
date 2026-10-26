// The jsx half of a read: text documents and keyframe digests, which the plugin reports as `{unsupported}` or does not
// compute. Only the layers the hash index says changed are asked for; every other layer keeps the details it already has.
import { jsonFieldsOf } from "@extynt/mcp-server";
import type { PluginClient } from "@extynt/host-native";
import { parsePropertyDetails, residualScopes, toProbeEnvelope } from "../native-snapshot/index.js";
import type { ChangedLayers, CompositionDetails, DetailScope, InterruptedApply, LayerDetails, NativeReadSet, PlanReach, PropertyDetailsRequest, PropertyDetailsResult } from "../native-snapshot/index.js";
import type { ProbeSnapshot } from "../server-types.js";
import { HOST_ID } from "./read-batch.js";
import { failureOf, type HostFailure } from "./read-ops.js";

const MAX_ROUNDS = 16;

interface DetailsOutcome {
  details: PropertyDetailsResult | undefined;
  asked: boolean;
  envelope: ProbeSnapshot;
  complete: boolean;
  failure?: HostFailure;
}

/** The changed layers as one scope per composition; ids that are not After Effects' own (a plan placeholder) are left out of the marker list, since the host refuses the whole details call over one. */
export function reachOf(changed: ChangedLayers["layers"], markerCompositions: readonly string[] = []): PlanReach {
  markerCompositions = markerCompositions.filter((id) => HOST_ID.test(id));
  const byComposition = new Map<string, string[]>();
  for (const { compId, layerId } of changed) byComposition.set(compId, [...(byComposition.get(compId) ?? []), layerId]);
  const scopes: DetailScope[] = [...byComposition].map(([compId, layerIds]) => ({ compId, layerIds }));
  return markerCompositions.length ? { scopes, markerCompositions: [...markerCompositions] } : { scopes };
}

const layerKey = (layer: LayerDetails): string => `${layer.compId}\u0000${layer.layerId}`;

function heldParts(details: PropertyDetailsResult | undefined): { layers: readonly LayerDetails[]; compositions?: readonly CompositionDetails[] } {
  return details?.ok ? { layers: details.layers, ...(details.compositions ? { compositions: details.compositions } : {}) } : { layers: [] };
}

/** `read` with `extra` details added for the layers it carries none for. */
export function withDetails(read: NativeReadSet, extra: readonly LayerDetails[]): NativeReadSet {
  if (extra.length === 0) return read;
  const have = new Set((read.details?.layers ?? []).map(layerKey));
  const held = heldParts(read.details);
  return { ...read, details: { ok: true, ...held, layers: [...held.layers, ...extra.filter((layer) => !have.has(layerKey(layer)))] } };
}

function lastByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(keyOf(item), item);
  return [...byKey.values()];
}

function mergeDetails(held: PropertyDetailsResult | undefined, fresh: PropertyDetailsResult): PropertyDetailsResult {
  const layers = lastByKey([...(held?.layers ?? []), ...fresh.layers], layerKey);
  const compositions = lastByKey([...(held?.compositions ?? []), ...(fresh.compositions ?? [])], (composition) => composition.compId);
  return { ok: true, layers, ...(compositions.length ? { compositions } : {}) };
}

async function askDetails(client: PluginClient, request: PropertyDetailsRequest): Promise<{ ok: true; result: PropertyDetailsResult } | { ok: false; failure: HostFailure }> {
  const outcome = await client.hostCall("aeReadPropertyDetails", jsonFieldsOf(request));
  if (outcome.kind !== "ok") return { ok: false, failure: failureOf(outcome) };
  const parsed = parsePropertyDetails(outcome.result.result);
  if (parsed.ok) return { ok: true, result: parsed };
  return { ok: false, failure: { code: parsed.error?.code ?? "DETAILS_FAILED", message: (parsed.error?.message ?? "The details call failed.").slice(0, 256), unknown: false } };
}

/** Fetches details for `reach` until the read has everything it needs, and builds the envelope with them. Details the read set already carries (those that rode in a write's batch, or came from the store) count. */
export async function fetchDetails(client: PluginClient, read: NativeReadSet, reach: PlanReach, breadcrumb: InterruptedApply | null): Promise<DetailsOutcome> {
  let details: PropertyDetailsResult | undefined = read.details, lastAsk = "", asked = false;
  const build = (): ProbeSnapshot => toProbeEnvelope({ ...read, ...(details ? { details } : {}) }, breadcrumb);
  let envelope = build();
  const outcome = (complete: boolean, failure?: HostFailure): DetailsOutcome => ({ envelope, complete, details, asked, ...(failure ? { failure } : {}) });
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const request = residualScopes(reach, envelope);
    if (!request) return outcome(true);
    const ask = JSON.stringify([request.scopes, request.markerCompositions]);
    if (ask === lastAsk) return outcome(false);
    lastAsk = ask;
    asked = true;
    const answer = await askDetails(client, request);
    if (!answer.ok) return outcome(false, answer.failure);
    details = mergeDetails(details, answer.result);
    envelope = build();
  }
  return outcome(false);
}
