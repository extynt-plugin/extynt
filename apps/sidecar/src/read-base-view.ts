/**
 * The scheduler's and the currency checks' view of the stored snapshot: which compositions it holds, which the host left
 * unread, what revision each part was read at and which compositions the item list names that nothing holds. Built from the
 * cached snapshot view and cached per stored snapshot, so a tick that changes nothing rescans nothing.
 */
import { observedOfWhole, type ObservedRevisions } from "./snapshot-merge.js";
import { snapshotView, type CompositionRow, type ItemRow, type SnapshotView } from "./snapshot-view.js";
import type { StoredSnapshot } from "./server-types.js";

/**
 * The parts of the stored snapshot the read rules look at. `newest` is the latest host revision any part was read at (null
 * when no read carried a stamp); `gaps` are compositions the host left unread, a later page of the same read; `cheapest` is
 * the composition to read when only the item list is wanted; `missing` are compositions the item list names that the
 * snapshot holds no read of and the host did not leave as a gap.
 */
export interface BaseView {
  project: { name: string; filePath: string | null };
  hostStamp: { epoch: number; revision: number } | undefined;
  epoch: number | null;
  coverage: boolean;
  itemCount: number | null;
  newest: number | null;
  observed: Record<string, number | null>;
  held: ReadonlySet<string>;
  gaps: ReadonlySet<string>;
  cheapest: string | null;
  missing: readonly string[];
}

interface CachedBase { view: SnapshotView; observed: ObservedRevisions; base: BaseView }

const cache = new WeakMap<StoredSnapshot, CachedBase>();

function newestOf(observed: ObservedRevisions): number | null {
  let newest: number | null = null;
  for (const revision of [observed.itemsRevision, ...Object.values(observed.compositions)]) if (revision !== null && (newest === null || revision > newest)) newest = revision;
  return newest;
}

function cheapestOf(compositions: readonly CompositionRow[]): string | null {
  let cheapest: CompositionRow | undefined;
  for (const composition of compositions) if (!cheapest || composition.layerCount < cheapest.layerCount) cheapest = composition;
  return cheapest?.id ?? null;
}

function missingOf(items: readonly ItemRow[] | null, held: ReadonlySet<string>, gaps: ReadonlySet<string>): string[] {
  return (items ?? []).filter((item) => item.composition && !held.has(item.id) && !gaps.has(item.id)).map((item) => item.id);
}

function buildBase(stored: StoredSnapshot, view: SnapshotView, observed: ObservedRevisions): BaseView {
  const held = new Set(view.compositions.map((composition) => composition.id)), gaps = new Set(view.pages.unread);
  return {
    project: stored.snapshot.result.project, hostStamp: view.stamp ?? undefined, epoch: observed.epoch, coverage: view.coverage, itemCount: observed.itemCount,
    newest: newestOf(observed), observed: observed.compositions, held, gaps, cheapest: cheapestOf(view.compositions), missing: missingOf(view.items, held, gaps),
  };
}

/** The rules' view of a stored snapshot, built once per stored snapshot and again only if its result or its observations changed. */
export function baseViewOf(stored: StoredSnapshot): BaseView {
  const view = snapshotView(stored.snapshot), cached = cache.get(stored);
  if (cached && cached.view === view && (stored.observed ?? cached.observed) === cached.observed) return cached.base;
  const observed = stored.observed ?? observedOfWhole(stored.snapshot), base = buildBase(stored, view, observed);
  cache.set(stored, { view, observed, base });
  return base;
}
