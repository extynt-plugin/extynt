// Prototype sidecar collection coordinator: no host writes or authorization, and callPage is the injected transport.
// A timeout quarantines the coordinator; it never cancels a host getter.
import type { JsonObject } from "@extynt/decode";
import { assertIndexPage, assertDetailPage, cacheIndexRows, quarantineCollectionTimeout, requireCollectionAvailable } from "./coordinator-pages.js";
import type { CachedRow, CollectionPage, CoordinatorState } from "./coordinator-pages.js";

export type { CollectionPage } from "./coordinator-pages.js";

const PAGE_SIZE = 25;
const SCHEMA_VERSION = "0.1";
const DETAIL_KINDS = ["layers", "properties"];
const NOT_READ = { valueCoverage: "not-read", dependencyClosure: "unknown" } as const;

/** What the coordinator asks the host for: one page of an index or descriptor walk. */
export interface PageRequest extends JsonObject {
  readonly schemaVersion?: string;
  readonly requestId?: string;
  readonly begin?: boolean;
  readonly cursor?: number;
  readonly pageSize?: number;
}

/** The target a descriptor walk reads. */
export interface DetailTarget extends JsonObject {
  readonly kind: string;
}

/** Options one collection call takes. */
export interface CollectOptions {
  readonly signal?: AbortSignal;
  readonly onPage?: (page: CollectionPage | undefined) => void;
}

/** Options the coordinator is built with. */
export interface CoordinatorOptions {
  readonly callPage: (request: PageRequest) => Promise<CollectionPage | undefined>;
  readonly yieldHost?: () => Promise<void>;
  readonly capacity?: number;
  readonly now?: () => number;
  readonly freshnessMs?: number;
}

/** What a cache lookup finds. */
export type CacheLookup = { readonly state: "unknown" } | { readonly state: "observed" | "stale"; readonly row: CachedRow };

interface WalkSettings {
  readonly signal: AbortSignal | undefined;
  readonly prefix: string;
  readonly target?: DetailTarget;
  readonly accept: (page: CollectionPage | undefined, sessionId: string | undefined, cursor: number, generation: number) => void;
  readonly onPage: (page: CollectionPage | undefined) => void;
}

interface WalkResult {
  readonly cancelled: boolean;
  readonly count: number;
}

async function fetchPage(coordinator: CollectionCoordinator, request: PageRequest): Promise<CollectionPage | undefined> {
  try {
    return await coordinator.callPage(request);
  } catch (error) {
    quarantineCollectionTimeout(coordinator, error);
    throw error;
  }
}

function isCancelled(coordinator: CollectionCoordinator, signal: AbortSignal | undefined, generation: number): boolean {
  return signal?.aborted === true || generation !== coordinator.generation || coordinator.paused;
}

function pageRequest(settings: WalkSettings, generation: number, sessionId: string | undefined, cursor: number): PageRequest {
  const identity = { schemaVersion: SCHEMA_VERSION, requestId: `${settings.prefix}-${generation}-${cursor}`, begin: !sessionId };
  return { ...settings.target, ...identity, ...(sessionId === undefined ? {} : { sessionId }), cursor, pageSize: PAGE_SIZE };
}

function progressOf(page: CollectionPage | undefined): { sessionId: string | undefined; rows: number; next: number | null } {
  return { sessionId: page?.sessionId, rows: page?.rows?.length ?? 0, next: page?.nextCursor ?? null };
}

async function walkPages(coordinator: CollectionCoordinator, settings: WalkSettings): Promise<WalkResult> {
  const generation = coordinator.generation;
  let sessionId: string | undefined;
  let cursor: number | null = 1;
  let count = 0;
  do {
    if (isCancelled(coordinator, settings.signal, generation)) return { cancelled: true, count };
    const page = await fetchPage(coordinator, pageRequest(settings, generation, sessionId, cursor));
    if (isCancelled(coordinator, settings.signal, generation)) return { cancelled: true, count };
    settings.accept(page, sessionId, cursor, generation);
    const progress = progressOf(page);
    sessionId = progress.sessionId;
    count += progress.rows;
    settings.onPage(page);
    cursor = progress.next;
    if (cursor !== null) await coordinator.yieldHost();
  } while (cursor !== null);
  return { cancelled: false, count };
}

/** Pages the compact index into a bounded cache, and demands layer or property descriptors without turning partial observations into graph facts. */
export class CollectionCoordinator implements CoordinatorState {
  readonly callPage: CoordinatorOptions["callPage"];
  readonly yieldHost: () => Promise<void>;
  readonly capacity: number;
  readonly now: () => number;
  readonly freshnessMs: number;
  generation = 0;
  readonly cache = new Map<string, CachedRow>();
  running = false;
  paused = false;
  quarantined = false;

  constructor({ callPage, yieldHost = () => new Promise<void>((resolve) => setTimeout(resolve, 100)), capacity = 1024, now = Date.now, freshnessMs = 15000 }: CoordinatorOptions) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error("INVALID_CAPACITY");
    this.callPage = callPage;
    this.yieldHost = yieldHost;
    this.capacity = capacity;
    this.now = now;
    this.freshnessMs = freshnessMs;
  }

  invalidate(): void {
    this.generation++;
    this.cache.clear();
  }

  pauseForMutation(): void {
    this.paused = true;
    this.invalidate();
  }

  resumeAfterMutation(): void {
    this.paused = false;
  }

  get(id: string): CacheLookup {
    const row = this.cache.get(id);
    if (!row) return { state: "unknown" };
    this.cache.delete(id);
    this.cache.set(id, row);
    const observedAt = row.observedAt;
    return { state: typeof observedAt === "number" && this.now() - observedAt < this.freshnessMs ? "observed" : "stale", row };
  }

  async collectIndex({ signal, onPage = () => {} }: CollectOptions = {}): Promise<{ state: string; count: number; deepComplete?: boolean; atomic?: boolean }> {
    requireCollectionAvailable(this);
    this.running = true;
    this.invalidate();
    const accept: WalkSettings["accept"] = (page, sessionId, cursor, generation) => {
      assertIndexPage(this, page, sessionId, cursor);
      cacheIndexRows(this, page?.rows ?? [], generation);
    };
    try {
      const walked = await walkPages(this, { signal, prefix: "index", accept, onPage });
      if (walked.cancelled) return { state: "cancelled", count: walked.count };
      return { state: "index_observed", count: walked.count, deepComplete: false, atomic: false };
    } finally {
      this.running = false;
    }
  }

  async collectDetails(target: DetailTarget, { signal, onPage = () => {} }: CollectOptions = {}): Promise<{ state: string; count: number; valueCoverage: string; dependencyClosure: string; deepComplete?: boolean; atomic?: boolean }> {
    requireCollectionAvailable(this);
    if (!DETAIL_KINDS.includes(target.kind)) throw new Error("INVALID_TARGET");
    this.running = true;
    const accept: WalkSettings["accept"] = (page, sessionId, cursor) => assertDetailPage(page, target.kind, sessionId, cursor);
    try {
      const walked = await walkPages(this, { signal, prefix: "detail", target, accept, onPage });
      if (walked.cancelled) return { state: "cancelled", count: walked.count, ...NOT_READ };
      return { state: "descriptors_observed", count: walked.count, ...NOT_READ, deepComplete: false, atomic: false };
    } finally {
      this.running = false;
    }
  }
}
