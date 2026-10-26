// The read path's use of the details store: before the jsx details call, the layers whose details the store holds under a witness that still
// holds are filled in from it; after the call, the details just read are recorded. Layers that kept their row in memory (hash unchanged since the
// last read of this process) are neither looked up nor re-recorded: their details are only as fresh as the read that fetched them, and restarting
// is what refreshes them.
import { layerHashIndex } from "../native-snapshot/index.js";
import type { LayerDetails, NativeReadSet, PropertyDetailsResult } from "../native-snapshot/index.js";
import type { PluginClient } from "@extynt/host-native";
import { projectKeyOf, witnessOf, type Witness } from "./details-witness.js";
import type { DetailsStore, LayerAsk, RecordedLayer } from "./details-store.js";
import { stampOf, type LayerRef } from "./read-batch.js";

interface Recall { witness: Witness; projectKey: string; seeded: LayerDetails[] }

const keyOf = (ref: LayerRef): string => `${ref.compId}\u0000${ref.layerId}`;

function asksFor(read: NativeReadSet, layers: readonly LayerRef[], projectKey: string): LayerAsk[] {
  const index = layerHashIndex(read), asks: LayerAsk[] = [];
  for (const { compId, layerId } of layers) {
    const entry = index.compositions[compId]?.layers[layerId];
    if (entry?.full) asks.push({ projectKey, compId, layerId, hash: entry.hash });
  }
  return asks;
}

/**
 * The stored details for the changed layers, minus those a write just touched (their details are the read's own) and those the read already carries.
 * With no store, or nothing to ask, the witness is still taken: recording needs it.
 */
export async function recall(store: DetailsStore | undefined, read: NativeReadSet, changed: readonly LayerRef[], touched: readonly LayerRef[]): Promise<Recall> {
  const witness = await witnessOf(read), projectKey = projectKeyOf(read);
  if (!store) return { witness, projectKey, seeded: [] };
  const skip = new Set([...touched.map(keyOf), ...(read.details?.layers ?? []).map(keyOf)]);
  const asks = asksFor(read, changed.filter((ref) => !skip.has(keyOf(ref))), projectKey);
  return { witness, projectKey, seeded: asks.length ? await store.lookup(asks, witness) : [] };
}

async function unchangedSince(client: PluginClient, read: NativeReadSet): Promise<boolean> {
  const outcome = await client.batch([{ op: "watch_state", id: "stamp-after" }]);
  if (outcome.kind !== "ok") return false;
  const after = stampOf(outcome.result, "stamp-after"), before = read.stamp;
  return after !== null && before.revision !== null && after.epoch === before.epoch && after.revision === before.revision;
}

interface Finished { client: PluginClient; read: NativeReadSet; recall: Recall; details: PropertyDetailsResult | undefined; asked: boolean }

function recordable(read: NativeReadSet, details: readonly LayerDetails[], projectKey: string): RecordedLayer[] {
  const asks = new Map(asksFor(read, details, projectKey).map((ask) => [keyOf(ask), ask]));
  return details.flatMap((layer) => { const ask = asks.get(keyOf(layer)); return ask ? [{ ...ask, properties: layer.properties }] : []; });
}

/**
 * Records every detail the read ended with (seeded, carried by a write's batch, or fetched) under the read's witness. Details fetched after the
 * read's stamp count only when the stamp is still current once they are in: otherwise they may describe a project the hash does not.
 */
export async function remember(store: DetailsStore | undefined, done: Finished): Promise<void> {
  const { read, details } = done;
  if (!store || !details?.ok || details.layers.length === 0) return;
  if (done.asked && !(await unchangedSince(done.client, read))) return;
  store.record(recordable(read, details.layers, done.recall.projectKey), done.recall.witness);
}
