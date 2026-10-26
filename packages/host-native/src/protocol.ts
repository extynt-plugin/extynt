// Constants and request types of the extynt native plugin protocol (docs/native/protocol.md). Reply types live beside the decoders that produce them (wire-*.ts); I/O lives in the client.
// The C++ plugin (native/extynt-core) and the TypeScript client follow this file.

/** Entry points `host_call` may run. The plugin holds the same fixed table (core/host_entries); arbitrary script text is never accepted. */
export const HOST_ENTRIES = [
  "aeApplyPlan", "aeUndoPlan", "aePreviewControlValues", "aeCaptureFrame", "aeDiscardCaptureFrame", "aeHostCensus",
  "aeCatalogueProbePage", "aeCatalogueReadInstance", "aeCollectIndexPage", "aeCollectDetailPage", "aeCollectValuePage",
  "aeCollectBlurControl", "aeCollectEffectCreation", "aeReadPropertyDetails",
] as const;
export type HostEntry = typeof HOST_ENTRIES[number];

/** Entries that change the project or write scratch state: the sidecar takes the mutation lease for these, the plugin does not distinguish. */
export const HOST_MUTATION_ENTRIES = [
  "aeApplyPlan", "aeUndoPlan", "aePreviewControlValues", "aeCollectBlurControl", "aeCollectEffectCreation",
] as const satisfies readonly HostEntry[];
export type HostMutationEntry = typeof HOST_MUTATION_ENTRIES[number];

/** Error codes the plugin answers with in `error.code`. */
export const WIRE_ERROR_CODES = [
  "UNAUTHORIZED", "ENGINE_REFUSED", "BAD_JSON", "BAD_REQUEST", "UNKNOWN_OP", "REQUEST_TOO_LARGE", "NO_PROJECT", "COMP_NOT_FOUND",
  "SUITE_MISSING", "HOST_ERROR", "SHUTTING_DOWN", "LIBRARY_NOT_FOUND", "INTERNAL",
  "ENTRY_NOT_ALLOWED", "LIBRARY_VERSION_INVALID", "LIBRARY_LOAD_FAILED", "SCRIPT_FAILED", "SCRIPT_ENGINE_NOT_READY", "HOST_MODAL_DIALOG",
  "LAYER_NOT_FOUND", "UNSUPPORTED",
] as const;

export const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_BATCH_OPS = 64;
export const WATCH_INTERVAL_MS = { min: 50, max: 2000, default: 100 } as const;
export const WATCH_STILL_MS = { min: 250, max: 10_000, default: 1000 } as const;

/** A `ping_direct` idle age above this means the idle hook is stalled: a dialog or popup is open in After Effects. */
export const IDLE_STALL_MS = 1500;

export interface ReadOptions { detail?: "structure" | "full"; hashes?: boolean; maxPropertiesPerLayer?: number; maxPropertyDepth?: number; preExpression?: boolean; debugFlags?: boolean }
export interface PathTarget { compId: string; layerId: string; path: string }

/** Ops that run on the main thread; the only ones allowed inside a batch. */
export type PluginOp =
  | { op: "ping" } | { op: "revision" } | { op: "watch_state" }
  | ({ op: "read_project" } & ReadOptions) | ({ op: "read_comp"; compId: string } & ReadOptions)
  | { op: "read_paths"; targets: PathTarget[] } | { op: "hash_project"; propertyHashes?: boolean }
  | { op: "host_call"; entry: HostEntry; args: string }
  | { op: "effect_menus"; compId: string; layerId: string };
export type BatchEntry = PluginOp & { id?: string };
export interface BatchRequest { op: "batch"; ops: BatchEntry[]; stopOnError?: boolean }
export interface PingDirectRequest { op: "ping_direct" }

/** Whether the entry changes the project or scratch state, so the caller must hold the mutation lease. */
export function isMutationEntry(entry: HostEntry): entry is HostMutationEntry {
  return HOST_MUTATION_ENTRIES.some((candidate) => candidate === entry);
}

/** Whether the text names one of the fixed `host_call` entries. */
export function isHostEntry(value: string | undefined): value is HostEntry {
  return HOST_ENTRIES.some((entry) => entry === value);
}
