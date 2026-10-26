// Bounded collection-page admission, timeout quarantine and index cache publication.
import { accepts, literal, object } from "@extynt/decode";
import type { JsonObject } from "@extynt/decode";

const MAX_PAGE_ROWS = 25;

/** A collection page as the host sends it; every field is checked before it is trusted. */
export interface CollectionPage {
  readonly ok?: boolean;
  readonly error?: { readonly code?: string };
  readonly kind?: string;
  readonly sessionId?: string;
  readonly rows?: readonly JsonObject[];
  readonly nextCursor?: number | null;
  readonly deepComplete?: boolean;
  readonly valueCoverage?: string;
  readonly dependencyClosure?: string;
}

/** An index row held in the cache with when and in which generation it was seen. */
export type CachedRow = JsonObject;

/** The coordinator state the page checks read and change. */
export interface CoordinatorState {
  running: boolean;
  paused: boolean;
  quarantined: boolean;
  readonly capacity: number;
  readonly cache: Map<string, CachedRow>;
  now(): number;
  invalidate(): void;
}

/** Refuses a new collection while another is running, a mutation has paused collection, or a host timeout quarantined it. */
export function requireCollectionAvailable(coordinator: CoordinatorState): void {
  if (coordinator.running || coordinator.paused || coordinator.quarantined) throw new Error("COLLECTION_UNAVAILABLE");
}

const isHostTimeout = accepts(object({ code: literal("HOST_TIMEOUT") }));

/** Quarantines the coordinator when the host timed out, because a timeout never cancels a host getter. */
export function quarantineCollectionTimeout<E>(coordinator: CoordinatorState, error: E): void {
  if (isHostTimeout(error)) coordinator.quarantined = true;
}

function validPageSession(page: CollectionPage, sessionId: string | undefined): boolean {
  return typeof page.sessionId === "string" && !(sessionId && sessionId !== page.sessionId);
}

function validNextCursor(page: CollectionPage, cursor: number): boolean {
  const next = page.nextCursor;
  return !(next !== null && (next === undefined || !Number.isInteger(next) || next <= cursor));
}

function validPageShape(page: CollectionPage, sessionId: string | undefined, cursor: number): boolean {
  return Array.isArray(page.rows) && page.rows.length <= MAX_PAGE_ROWS && validPageSession(page, sessionId) && validNextCursor(page, cursor);
}

function validDetailCoverage(page: CollectionPage): boolean {
  return page.deepComplete === false && page.valueCoverage === "not-read" && page.dependencyClosure === "unknown";
}

function detailPageError(page: CollectionPage | undefined): Error {
  return new Error(page?.error?.code || "INVALID_PAGE");
}

/** Throws unless the page is an ok index page continuing this session; any refusal invalidates the cache. */
export function assertIndexPage(coordinator: CoordinatorState, page: CollectionPage | undefined, sessionId: string | undefined, cursor: number): void {
  if (!page?.ok) {
    coordinator.invalidate();
    throw new Error(page?.error?.code || "INVALID_PAGE");
  }
  if (!validPageShape(page, sessionId, cursor)) {
    coordinator.invalidate();
    throw new Error("INVALID_PAGE");
  }
}

/** Publishes index rows into the bounded cache, evicting the least recently used when it is over capacity. */
export function cacheIndexRows(coordinator: CoordinatorState, rows: readonly JsonObject[], generation: number): void {
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== "string") {
      coordinator.invalidate();
      throw new Error("INVALID_PAGE");
    }
    coordinator.cache.delete(id);
    coordinator.cache.set(id, { ...row, observedAt: coordinator.now(), generation });
    while (coordinator.cache.size > coordinator.capacity) {
      const oldest = coordinator.cache.keys().next();
      if (oldest.done) break;
      coordinator.cache.delete(oldest.value);
    }
  }
}

/** Throws unless the page is an ok descriptor page of the requested kind that claims no value or dependency coverage. */
export function assertDetailPage(page: CollectionPage | undefined, kind: string, sessionId: string | undefined, cursor: number): void {
  const valid = page?.ok && page.kind === kind && validPageShape(page, sessionId, cursor) && validDetailCoverage(page);
  if (!valid) throw detailPageError(page);
}
