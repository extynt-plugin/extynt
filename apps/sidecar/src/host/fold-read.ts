// How a read set becomes the snapshot the sidecar stores, for every read path (a normal read, an apply's precheck and verify, an undo's guard and
// after-read): the rows of the read, the jsx details only for the layers whose hash moved, and every unchanged layer's row (details included)
// taken from the snapshot already held. A layer with no row held (the first read after a pair) takes its details from the persisted store when the
// store can vouch for them (details-witness.ts). All paths fetch the same kinds, so their fingerprints stay comparable.
import type { InterruptedApply, LayerHashIndex, NativeReadSet } from "../native-snapshot/index.js";
import { changedLayers, mergeLayersByHash } from "../native-snapshot/index.js";
import type { ReceiverOutcome } from "../receiver-types.js";
import type { ProbeSnapshot } from "../server-types.js";
import { isRow } from "../snapshot-view.js";
import type { Opaque, Row } from "../snapshot-view.js";
import { postSnapshot } from "./apply-support.js";
import { indexAfter } from "./hash-memory.js";
import type { HashMemory } from "./hash-memory.js";
import type { HostLaneContext } from "./lane-types.js";
import { recall, remember } from "./details-persist.js";
import { fetchDetails, reachOf, withDetails } from "./read-details.js";
import type { LayerRef } from "./read-batch.js";
import type { HostFailure } from "./read-ops.js";

const EMPTY_INDEX: LayerHashIndex = { compositions: {} };
const rowsOf = (value: ReadonlyArray<Opaque>): Row[] => value.filter(isRow);
const keyOf = (compId: string, layerId: string): string => `${compId}\u0000${layerId}`;

interface FoldInput {
  ctx: HostLaneContext;
  hashes: HashMemory;
  read: NativeReadSet;
  touched: readonly LayerRef[];
  markerCompositions?: readonly string[];
  breadcrumb: InterruptedApply | null;
}

export interface Folded {
  envelope: ProbeSnapshot;
  read: NativeReadSet;
  previous: LayerHashIndex | undefined;
  complete: boolean;
  details: { fromStore: number; asked: boolean };
  failure?: HostFailure;
}

function withoutLayers(index: LayerHashIndex, touched: readonly LayerRef[]): LayerHashIndex {
  if (touched.length === 0) return index;
  const gone = new Set(touched.map((ref) => keyOf(ref.compId, ref.layerId)));
  const compositions = Object.entries(index.compositions).map(([compId, entry]) => [compId, { ...entry, layers: Object.fromEntries(Object.entries(entry.layers).filter(([layerId]) => !gone.has(keyOf(compId, layerId)))) }] as const);
  return { compositions: Object.fromEntries(compositions) };
}

/** The envelope for `read`: details fetched for the changed layers that still lack some, unchanged layers taken from the held snapshot. */
export async function foldRead(input: FoldInput): Promise<Folded> {
  const { ctx, hashes, read, touched, breadcrumb } = input, { state } = ctx;
  const known = hashes.indexFor(state.latest), previous = withoutLayers(known ?? EMPTY_INDEX, touched), changed = changedLayers(previous, read).layers;
  const recalled = await recall(hashes.persisted, read, changed, touched);
  const fetched = await fetchDetails(ctx.client, withDetails(read, recalled.seeded), reachOf(changed, input.markerCompositions), breadcrumb);
  if (fetched.complete) await remember(hashes.persisted, { client: ctx.client, read, recall: recalled, details: fetched.details, asked: fetched.asked });
  const held = state.latest ? rowsOf(state.latest.snapshot.result.compositions) : undefined;
  const compositions = mergeLayersByHash(held, previous, read, rowsOf(fetched.envelope.result.compositions));
  const envelope: ProbeSnapshot = { ...fetched.envelope, result: { ...fetched.envelope.result, compositions } };
  return { envelope, read, previous: known, complete: fetched.complete, details: { fromStore: recalled.seeded.length, asked: fetched.asked }, ...(fetched.failure ? { failure: fetched.failure } : {}) };
}

/**
 * The folded read as the project's posted state. A composition's own marker list rides in a verify read only (the native composition read carries none, so no
 * other read would match it): it is dropped here, or the posted fingerprint would differ from the next ordinary read's of an unchanged project.
 */
export function withoutCompositionMarkers(folded: Folded): Folded {
  const compositions = rowsOf(folded.envelope.result.compositions);
  if (!compositions.some((composition) => composition.markers !== undefined)) return folded;
  const stripped = compositions.map((composition) => Object.fromEntries(Object.entries(composition).filter(([key]) => key !== "markers")));
  return { ...folded, envelope: { ...folded.envelope, result: { ...folded.envelope.result, compositions: stripped } } };
}

/** Keeps the hash index in step with the snapshot a read just placed, so the next read fetches details only for what moved after it. */
export function rememberLanded(hashes: HashMemory, ctx: Pick<HostLaneContext, "state">, landed: Folded): void {
  const { latest } = ctx.state;
  if (landed.complete && latest?.snapshot.requestId === landed.envelope.requestId) hashes.remember(latest, indexAfter(landed.previous, landed.read));
}

/** Posts the folded envelope (an apply or an undo posts it as the project's new state) and remembers its hashes when it was placed. */
export async function postFolded(ctx: HostLaneContext, folded: Folded, meta: { purpose?: "precheck"; planId?: string } = {}): Promise<ReceiverOutcome> {
  const answer = await postSnapshot(ctx, folded.envelope, meta);
  if (answer.status < 300) rememberLanded(ctx.hashes, ctx, folded);
  return answer;
}
