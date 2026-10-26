// The collection coordinator pages the index into a bounded cache and walks descriptor pages without reading values.
import test from "node:test";
import assert from "node:assert/strict";
import type { JsonObject } from "@extynt/decode";
import { CollectionCoordinator } from "../src/coordinator.js";
import type { CollectionPage, PageRequest } from "../src/coordinator.js";

const noYield = (): Promise<void> => Promise.resolve();

function rowsOf(start: number, count: number): JsonObject[] {
  return Array.from({ length: count }, (_, offset) => ({ id: `item-${start + offset}` }));
}

function indexHost(total: number): (request: PageRequest) => Promise<CollectionPage> {
  return (request) => {
    const cursor = request.cursor ?? 1;
    const count = Math.min(25, total - (cursor - 1));
    const next = cursor + count <= total ? cursor + count : null;
    return Promise.resolve({ ok: true, sessionId: "s1", rows: rowsOf(cursor, count), nextCursor: next });
  };
}

test("the index is paged into the cache and reported as observed", async () => {
  const coordinator = new CollectionCoordinator({ callPage: indexHost(60), yieldHost: noYield });
  const result = await coordinator.collectIndex();
  assert.deepEqual(result, { state: "index_observed", count: 60, deepComplete: false, atomic: false });
  assert.equal(coordinator.get("item-1").state, "observed");
  assert.equal(coordinator.get("nothing").state, "unknown");
});

test("the cache is bounded and evicts the least recently used row", async () => {
  const coordinator = new CollectionCoordinator({ callPage: indexHost(60), yieldHost: noYield, capacity: 10 });
  await coordinator.collectIndex();
  assert.equal(coordinator.cache.size, 10);
  assert.equal(coordinator.get("item-1").state, "unknown");
  assert.equal(coordinator.get("item-60").state, "observed");
});

test("a row past the freshness window reads as stale", async () => {
  let clock = 0;
  const coordinator = new CollectionCoordinator({ callPage: indexHost(3), yieldHost: noYield, now: () => clock, freshnessMs: 100 });
  await coordinator.collectIndex();
  clock = 101;
  assert.equal(coordinator.get("item-1").state, "stale");
});

test("a host timeout quarantines the coordinator and later collection is refused", async () => {
  const timeout = Object.assign(new Error("slow"), { code: "HOST_TIMEOUT" });
  const coordinator = new CollectionCoordinator({ callPage: () => Promise.reject(timeout), yieldHost: noYield });
  await assert.rejects(coordinator.collectIndex(), /slow/);
  await assert.rejects(coordinator.collectIndex(), /COLLECTION_UNAVAILABLE/);
});

test("an index page that is not ok or malformed is refused and nothing is cached", async () => {
  const refused = new CollectionCoordinator({ callPage: () => Promise.resolve({ ok: false, error: { code: "BUSY" } }), yieldHost: noYield });
  await assert.rejects(refused.collectIndex(), /BUSY/);
  const unsafeCursor = new CollectionCoordinator({ callPage: () => Promise.resolve({ ok: true, sessionId: "s", rows: [], nextCursor: 1 }), yieldHost: noYield });
  await assert.rejects(unsafeCursor.collectIndex(), /INVALID_PAGE/);
  const noId = new CollectionCoordinator({ callPage: () => Promise.resolve({ ok: true, sessionId: "s", rows: [{}], nextCursor: null }), yieldHost: noYield });
  await assert.rejects(noId.collectIndex(), /INVALID_PAGE/);
});

test("descriptor pages must claim no value or dependency coverage", async () => {
  const page = (coverage: string): CollectionPage => ({ ok: true, kind: "layers", sessionId: "s", rows: rowsOf(1, 2), nextCursor: null, deepComplete: false, valueCoverage: coverage, dependencyClosure: "unknown" });
  const good = new CollectionCoordinator({ callPage: () => Promise.resolve(page("not-read")), yieldHost: noYield });
  const result = await good.collectDetails({ kind: "layers" });
  assert.deepEqual(result, { state: "descriptors_observed", count: 2, valueCoverage: "not-read", dependencyClosure: "unknown", deepComplete: false, atomic: false });
  const leaky = new CollectionCoordinator({ callPage: () => Promise.resolve(page("read")), yieldHost: noYield });
  await assert.rejects(leaky.collectDetails({ kind: "layers" }), /INVALID_PAGE/);
  await assert.rejects(good.collectDetails({ kind: "effects" }), /INVALID_TARGET/);
});

test("a mutation pause cancels a walk and drops late pages", async () => {
  const coordinator = new CollectionCoordinator({ callPage: indexHost(60), yieldHost: noYield });
  const pages: Array<CollectionPage | undefined> = [];
  const result = await coordinator.collectIndex({ onPage: (page) => { pages.push(page); coordinator.pauseForMutation(); } });
  assert.deepEqual(result, { state: "cancelled", count: 25 });
  assert.equal(pages.length, 1);
  assert.equal(coordinator.cache.size, 0);
  await assert.rejects(coordinator.collectIndex(), /COLLECTION_UNAVAILABLE/);
  coordinator.resumeAfterMutation();
  assert.equal((await coordinator.collectIndex()).state, "index_observed");
});
