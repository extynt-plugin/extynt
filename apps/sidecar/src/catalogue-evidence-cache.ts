// Per-database memory of what the catalogue derives from definition rows: control trees, the sources of each effect, display names and probed keys.
import type { DatabaseSync } from "node:sqlite";
import type { EffectProbeRow } from "@extynt/capability-catalogue";

/** The newest observation of one effect on one host. */
export interface LatestSource { sourceId: string; observedAt: number }

/** Every catalogue source of one kind on one host, reduced once: the newest of each effect, and the `matchName\0title` key of each source. */
export interface SourceTable { newest: ReadonlyMap<string, LatestSource>; keys: readonly string[] }

interface CatalogueEvidenceCache {
  trees: Map<string, EffectProbeRow[]>;
  probeSources: Map<string, SourceTable>;
  instanceSources: Map<string, SourceTable>;
  displayNames: Map<string, ReadonlyMap<string, string>>;
  probedKeys: Map<string, readonly string[]>;
}

const CACHES = new WeakMap<DatabaseSync, CatalogueEvidenceCache>();

/** The cache of this database, created empty when none exists. */
export function evidenceCacheOf(database: DatabaseSync): CatalogueEvidenceCache {
  const known = CACHES.get(database);
  if (known) return known;
  const created: CatalogueEvidenceCache = { trees: new Map(), probeSources: new Map(), instanceSources: new Map(), displayNames: new Map(), probedKeys: new Map() };
  CACHES.set(database, created);
  return created;
}

/** The entry of a table, built and kept on first use. */
export function remembered<Key, Entry>(table: Map<Key, Entry>, key: Key, build: () => Entry): Entry {
  const known = table.get(key);
  if (known !== undefined) return known;
  const built = build();
  table.set(key, built);
  return built;
}

function forgetCatalogueEvidence(database: DatabaseSync): void {
  CACHES.delete(database);
}

/** Runs a write to the definition or evidence tables; what the catalogue derived from them is forgotten before and after, so no writer can leave a stale derivation behind. */
export function writingDefinitionRows<T>(database: DatabaseSync, write: () => T): T {
  forgetCatalogueEvidence(database);
  try {
    return write();
  } finally {
    forgetCatalogueEvidence(database);
  }
}
