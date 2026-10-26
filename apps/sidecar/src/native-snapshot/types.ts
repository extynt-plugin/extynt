/** Shapes the native snapshot adapter reads and writes: the plugin's read results, the jsx details call, and the per-layer hash index. */
import type { NativeReadResult, PingDirectResult, WatchState } from "@extynt/host-native";
import type { CompositionDetails, LayerDetails } from "./detail-shapes.js";

export type { CompositionDetails, CompositionMarkers, LayerDetails, PropertyDetail } from "./detail-shapes.js";

/** `read_project` result. Native output already uses the probe's member names (docs/native/plugin-design.md, "Data shape"). */
export type NativeProjectResult = NativeReadResult;
/** `read_comp` result: the project block plus one composition. */
export type NativeCompResult = NativeReadResult;

/** What the details call may add to a native read: the facts the plugin reports as `{unsupported}` or does not compute. */
export type DetailKind = "textDocument" | "keyDigest" | "marker" | "maskPath" | "shapePath" | "layerRef";
/** The parsed `aeReadPropertyDetails` result. */
export interface PropertyDetailsResult { ok: boolean; layers: readonly LayerDetails[]; compositions?: readonly CompositionDetails[]; error?: { code?: string; message?: string } }
export interface DetailScope { compId: string; layerIds?: string[] }
/** The `aeReadPropertyDetails` arguments. `markerCompositions` names compositions whose own marker list is wanted (the native composition read carries none); `scopes` may then be empty. */
export interface PropertyDetailsRequest { scopes: DetailScope[]; include: DetailKind[]; maxLayers: number; markerCompositions?: string[] }
export const DETAILS_MAX_LAYERS = 256;

export type NativeReadScope = { kind: "full" } | { kind: "compositions"; ids: string[]; includeItems: boolean };

/**
 * Everything one batch of native reads produced, as the apply and refresh runners collect it. `stampBefore` is the `watch_state` taken
 * before the batch's mutation (apply and undo batches; the runner compares it with its expected stamp, the adapter does not use it);
 * `stamp` stamps the reads: the one taken after the mutation, or the first of a read-only batch.
 */
export interface NativeReadSet {
  stampBefore?: WatchState;
  stamp: WatchState;
  project?: NativeProjectResult;
  comps: NativeCompResult[];
  details?: PropertyDetailsResult;
  ping: PingDirectResult;
  requestId: string;
  scope: NativeReadScope;
}

/** The host's record of an apply that never returned; the same shape the probe reported (`apply-breadcrumb.jsx`). */
export interface InterruptedApply { planId: string; index: number; operationCount: number | null; operation: string | null; layerId: string | null; startedAt: string | null }

/** The compositions and layers a plan reaches; a scope without `layerIds` reaches every layer of its composition, and `markerCompositions` names those whose own marker list the plan's verification needs. */
export interface PlanReach {
  scopes: DetailScope[];
  markerCompositions?: string[];
}

/** `text`: the layer has a text document, whose styling (font, size, fill) no native digest covers; `revision`: the project revision the hash was read at, null when unknown. */
export interface LayerHashEntry { hash: string; full: boolean; text: boolean; revision: string | null }
export interface CompositionHashEntry { hash: string | null; layers: Record<string, LayerHashEntry> }
/** Per composition and layer, the plugin's content hash at the last read. Layer hashes compare only between reads of the same detail, hence `full`. */
export interface LayerHashIndex { compositions: Record<string, CompositionHashEntry> }

export interface ChangedLayers { compositions: string[]; layers: Array<{ compId: string; layerId: string }> }
