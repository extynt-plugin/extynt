/**
 * Folds a scoped project read into the last snapshot. A full read replaces everything; a read of some compositions replaces
 * those and, when it also read the item list, the items. The result is a raw snapshot that looks exactly like a full read
 * (no `coverage`), so nothing downstream can tell the difference. Which revision each part was last observed at is kept
 * beside the snapshot (`observed`), never inside it: the read scheduler asks the sidecar's own record, not the host.
 * Pure: no state, no clock, no I/O. Compositions and items the read did not touch are moved by reference, never copied.
 */
import { snapshotView, type CompositionRow, type HostStamp, type ItemRow, type Pages, type SnapshotView } from "./snapshot-view.js";
import type { ProbeSnapshot, StoredSnapshot } from "./server-types.js";

/**
 * The host stamp revision each part of the stored snapshot was read at (null when the read carried no stamp): the item list
 * at `itemsRevision`, holding `itemCount` items, and each composition by id.
 */
export interface ObservedRevisions {
  epoch: number | null;
  itemsRevision: number | null;
  itemCount: number | null;
  compositions: Record<string, number | null>;
}

export type MergeRefusal = "no-base" | "base-is-coverage" | "other-project" | "other-epoch" | "read-has-no-stamp" | "base-has-no-stamp";
export type MergeResult = { ok: true; snapshot: ProbeSnapshot; observed: ObservedRevisions } | { ok: false; reason: MergeRefusal };

const UNREAD_WARNING = "composition-count-limit";

/** The host stamp of a snapshot, or null when the read carried none. */
export function stampOf(snapshot: ProbeSnapshot): HostStamp | null {
  return snapshotView(snapshot).stamp;
}

/** True for a collection snapshot: it covers one composition's metadata and says nothing about the rest of the project. */
export function hasCoverage(snapshot: ProbeSnapshot): boolean {
  return snapshotView(snapshot).coverage;
}

/** The whole-project read a stored snapshot stands on: itself when it is one, else the one a scoped collection snapshot was set beside. */
export function wholeReadOf(stored: StoredSnapshot | undefined): StoredSnapshot | undefined {
  return stored && !hasCoverage(stored.snapshot) ? stored : stored?.fullBase;
}

/** What a snapshot taken whole was observed at: every composition it holds, at its stamp. */
export function observedOfWhole(snapshot: ProbeSnapshot): ObservedRevisions {
  const view = snapshotView(snapshot), revision = view.stamp?.revision ?? null;
  const compositions: Record<string, number | null> = {};
  for (const composition of view.compositions) compositions[composition.id] = revision;
  const items = view.coverage ? { itemsRevision: null, itemCount: null } : { itemsRevision: revision, itemCount: view.itemCount ?? view.itemsLength };
  return { epoch: view.stamp?.epoch ?? null, ...items, compositions };
}

function refusal(base: StoredSnapshot | undefined, read: ProbeSnapshot): MergeRefusal | null {
  if (!base) return "no-base";
  const before = snapshotView(base.snapshot), after = snapshotView(read);
  if (before.coverage) return "base-is-coverage";
  if (before.project.filePath !== after.project.filePath || before.project.name !== after.project.name) return "other-project";
  if (!after.stamp) return "read-has-no-stamp";
  if (!before.stamp) return "base-has-no-stamp";
  return before.stamp.epoch === after.stamp.epoch ? null : "other-epoch";
}

function mergedPages(base: Pages, read: Pages, asked: ReadonlySet<string>, itemsRead: boolean): Pages {
  const keep = (ids: readonly string[]): string[] => ids.filter((id) => !asked.has(id));
  return { unread: [...new Set([...keep(base.unread), ...read.unread])], oversized: [...new Set([...keep(base.oversized), ...read.oversized])], capped: itemsRead ? read.capped : base.capped };
}

function mergedWarnings(base: ProbeSnapshot, read: ProbeSnapshot, pages: Pages): string[] {
  const warnings = [...new Set([...base.warnings, ...read.warnings])].filter((warning) => warning !== UNREAD_WARNING);
  return pages.unread.length || pages.oversized.length || pages.capped ? [...warnings, UNREAD_WARNING] : warnings;
}

interface Placement { base: readonly CompositionRow[]; read: readonly CompositionRow[]; items: readonly ItemRow[] | undefined; asked: ReadonlySet<string>; gaps: ReadonlySet<string> }

function mergedCompositions({ base, read, items, asked, gaps }: Placement): CompositionRow[] {
  const byId = new Map(base.map((composition) => [composition.id, composition]));
  const returned = new Set(read.map((composition) => composition.id));
  for (const id of asked) if (!returned.has(id) && !gaps.has(id)) byId.delete(id);
  for (const composition of read) byId.set(composition.id, composition);
  if (!items) return [...byId.values()];
  const listed = items.filter((item) => item.composition).map((item) => item.id), named = new Set(listed);
  return [...listed.flatMap((id) => byId.get(id) ?? []), ...[...byId.values()].filter((composition) => !named.has(composition.id) && returned.has(composition.id))];
}

function mergedObserved(base: ObservedRevisions, read: SnapshotView, stamp: HostStamp, kept: ReadonlySet<string>): ObservedRevisions {
  const compositions: Record<string, number | null> = {};
  for (const id of Object.keys(base.compositions)) if (kept.has(id)) compositions[id] = base.compositions[id] ?? null;
  for (const composition of read.compositions) compositions[composition.id] = stamp.revision;
  return { epoch: stamp.epoch, itemsRevision: read.itemsRead ? stamp.revision : base.itemsRevision, itemCount: read.itemsRead ? read.itemCount ?? read.itemsLength : base.itemCount, compositions };
}

interface Parts { compositions: readonly CompositionRow[]; pages: Pages; dropped: ReadonlySet<string> }

type Result = ProbeSnapshot["result"];

function untouchedItems(base: ProbeSnapshot, dropped: ReadonlySet<string>): Pick<Result, "items" | "sources"> {
  const view = snapshotView(base), { items, sources } = base.result;
  const kept = view.items && dropped.size ? view.items.filter((item) => !(item.composition && dropped.has(item.id))).map((item) => item.row) : items;
  return { ...(kept === undefined ? {} : { items: kept }), ...(sources === undefined ? {} : { sources }) };
}

function mergedResult(base: ProbeSnapshot, read: ProbeSnapshot, parts: Parts): Result {
  const before = snapshotView(base), after = snapshotView(read), truncated = after.truncation.truncated === true || before.truncation.truncated === true;
  const { readScope, ...readResult } = read.result;
  const scope = base.result.readScope === undefined ? {} : { readScope: base.result.readScope };
  const pages = { unread: [...parts.pages.unread], oversized: [...parts.pages.oversized], capped: parts.pages.capped };
  const merged = { ...readResult, ...scope, compositions: parts.compositions.map((composition) => composition.row), compositionPages: pages, truncation: { limits: read.result.truncation?.limits ?? {}, truncated } };
  return after.itemsRead ? merged : { ...merged, ...untouchedItems(base, parts.dropped) };
}

function fold(base: StoredSnapshot, read: ProbeSnapshot, asked: readonly string[]): MergeResult {
  const before = snapshotView(base.snapshot), after = snapshotView(read);
  if (!after.stamp) return { ok: false, reason: "read-has-no-stamp" };
  const askedIds = new Set(asked), returned = new Set(after.compositions.map((composition) => composition.id)), gaps = new Set([...after.pages.unread, ...after.pages.oversized]);
  const compositions = mergedCompositions({ base: before.compositions, read: after.compositions, items: after.itemsRead ? after.items ?? [] : undefined, asked: askedIds, gaps });
  const pages = mergedPages(before.pages, after.pages, new Set([...askedIds, ...returned]), after.itemsRead);
  const dropped = new Set([...askedIds].filter((id) => !returned.has(id) && !gaps.has(id)));
  const snapshot: ProbeSnapshot = { ...read, result: mergedResult(base.snapshot, read, { compositions, pages, dropped }), warnings: mergedWarnings(base.snapshot, read, pages) };
  return { ok: true, snapshot, observed: mergedObserved(base.observed ?? observedOfWhole(base.snapshot), after, after.stamp, new Set(compositions.map((composition) => composition.id))) };
}

/**
 * `base` is the stored snapshot, `read` the new one; `asked` is what the sidecar asked the host to read (absent when it
 * did not issue the read: nothing is then deleted for being absent). A refusal means the scoped read cannot be placed on
 * the base and a full read is needed.
 */
export function mergeRead(base: StoredSnapshot | undefined, read: ProbeSnapshot, asked?: readonly string[]): MergeResult {
  if (!snapshotView(read).scoped) return { ok: true, snapshot: read, observed: observedOfWhole(read) };
  const refused = refusal(base, read);
  return refused || !base ? { ok: false, reason: refused ?? "no-base" } : fold(base, read, asked ?? []);
}
