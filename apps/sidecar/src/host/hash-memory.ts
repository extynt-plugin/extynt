// Which layers the last read of the stored snapshot saw at which hash. It is keyed by the stored snapshot object itself, so a
// snapshot that anything else replaced (an apply's verify read, a collection page) has no entry and the next read treats
// every layer as changed: slower once, never wrong. Unchanged layers keep their rows, details included.
import type { LayerHashIndex, NativeReadSet } from "../native-snapshot/index.js";
import { layerHashIndex } from "../native-snapshot/index.js";
import type { StoredSnapshot } from "../server-types.js";
import type { DetailsStore } from "./details-store.js";

/** The layer hashes remembered per stored snapshot. `reset` is a new connection to After Effects (nothing remembered about the last one is trusted); `persisted` holds the details that outlive a connection and a restart, which `reset` leaves alone because its entries carry their own proof of validity. */
export interface HashMemory {
  indexFor(stored: StoredSnapshot | undefined): LayerHashIndex | undefined;
  remember(stored: StoredSnapshot | undefined, index: LayerHashIndex): void;
  reset(): void;
  persisted?: DetailsStore;
}

/** An empty memory, backed by the persisted details store when there is one. */
export function createHashMemory(persisted?: DetailsStore): HashMemory {
  let known = new WeakMap<StoredSnapshot, LayerHashIndex>();
  return {
    ...(persisted ? { persisted } : {}),
    indexFor: (stored) => (stored ? known.get(stored) : undefined),
    remember: (stored, index) => { if (stored) known.set(stored, index); },
    reset: () => { known = new WeakMap(); },
  };
}

/** The index of the snapshot after `read` was placed on it: a full read replaces everything, a scoped read replaces the compositions it listed. */
export function indexAfter(previous: LayerHashIndex | undefined, read: NativeReadSet): LayerHashIndex {
  const current = layerHashIndex(read);
  if (read.scope.kind === "full" || !previous) return current;
  const kept: LayerHashIndex["compositions"] = {};
  const asked = new Set(read.scope.ids);
  for (const [id, entry] of Object.entries(previous.compositions)) if (!asked.has(id)) kept[id] = entry;
  return { compositions: { ...kept, ...current.compositions } };
}
