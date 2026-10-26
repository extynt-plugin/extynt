/**
 * Tests that the observation cache keeps completed reads across same-stamp refreshes and cancellations, and what a
 * cancelled read leaves behind.
 */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, numberOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { array, decodeOrThrow, fail, number, object, string } from '../packages/decode/dist/src/index.js';
import type { Decoder } from '../packages/decode/dist/src/index.js';

interface NativeStamp { readonly epoch: number; readonly revision: number | null }
interface Dispatch { readonly ticket: string; readonly jobId: string; readonly generation: number }
interface PageFixture {
  readonly ok: true;
  readonly requestId: string;
  readonly sessionId: string;
  readonly stamp: NativeStamp;
  readonly rows: readonly JsonObject[];
  readonly nextCursor: number | null;
  readonly deepComplete: false;
}
interface RetainedView { readonly rows: ReadonlyArray<{ readonly bytes: number }>; readonly bytes: number }

const stamp: NativeStamp = { epoch: 1, revision: 4 };
const target = { kind: 'index' };
const key = (id: string): string => JSON.stringify(['index', null, null, null, id]);
const stateOf = (service: CollectionService, rowKey: string): string => decodeOrThrow(string(), fieldOf(service.lookup(rowKey), 'state'));
const freshnessOf = (service: CollectionService, dispatch: Dispatch): string => decodeOrThrow(string(), fieldOf(service.demandResult(dispatch.ticket), 'freshness'));

function dispatchOf(response: JsonObject): Dispatch {
  return { ticket: textOf(response, 'ticket'), jobId: textOf(response, 'jobId'), generation: numberOf(response, 'generation') };
}
const retainedRows: Decoder<RetainedView['rows']> = { run: rows => rows instanceof Map ? array(object({ bytes: number() })).run(Array.from(rows.values())) : fail('Map', rows) };
const retainedViewDecoder: Decoder<RetainedView> = object({ rows: retainedRows, bytes: number() });
const retainedOf = (service: CollectionService): RetainedView => decodeOrThrow(retainedViewDecoder, Reflect.get(service, 'retained'));
function hasJob(service: CollectionService): boolean {
  return Reflect.get(service, 'job') !== undefined;
}
function page(dispatch: Dispatch, rows: readonly JsonObject[], nativeStamp: NativeStamp = stamp, nextCursor: number | null = null): PageFixture {
  return { ok: true, requestId: dispatch.ticket, sessionId: 's-' + dispatch.jobId, stamp: nativeStamp, rows, nextCursor, deepComplete: false };
}
function observe(service: CollectionService, rows: readonly JsonObject[], nativeStamp: NativeStamp = stamp): Dispatch {
  const dispatch = dispatchOf(service.demand({ begin: true, target }, false));
  service.authorizeDispatch({ ticket: dispatch.ticket });
  service.complete(jsonOf({ ticket: dispatch.ticket, page: page(dispatch, rows, nativeStamp) }));
  return dispatch;
}
const row = (id: string): JsonObject => ({ id, name: 'Item ' + id, properties: 'unknown' });

test('same-stamp replacement preserves completed observations without renewing their TTL', () => {
  let now = 0;
  const service = new CollectionService(() => now); service.pair('p');
  const first = observe(service, [row('a')]);
  now = 10000;
  observe(service, [row('b')]);
  assert.equal(stateOf(service, key('a')), 'observed');
  assert.equal(freshnessOf(service, first), 'observed');
  assert.equal(fieldOf(service.lookup(key('a')), 'writeAuthorizing'), false);
  assert.equal(fieldOf(service.lookup(key('a')), 'dependencyClosure'), 'unknown');
  now = 15000;
  assert.equal(stateOf(service, key('a')), 'stale');
  assert.equal(freshnessOf(service, first), 'stale');
  assert.equal(stateOf(service, key('b')), 'observed');
});

test('cancelled admitted job retains the native lease and suppresses its late page only', () => {
  const service = new CollectionService(); service.pair('p');
  const first = observe(service, [row('a')]);
  const late = dispatchOf(service.demand({ begin: true, target }, false));
  service.authorizeDispatch({ ticket: late.ticket });
  service.cancelDemand(late.ticket);
  assert.equal(service.hasUnsettled(late.ticket), true);
  assert.throws(() => service.prepare({ begin: true, target }, false), /COLLECTION_BUSY/);
  assert.throws(() => service.complete(jsonOf({ ticket: late.ticket, page: page(late, [row('late')]) })), /COLLECTION_CANCELLED/);
  assert.equal(stateOf(service, key('late')), 'unknown');
  assert.equal(stateOf(service, key('a')), 'observed');
  assert.equal(freshnessOf(service, first), 'observed');
});

test('unadmitted cancellation and proven no-native outcome preserve unrelated observations', () => {
  const service = new CollectionService(); service.pair('p');
  observe(service, [row('a')]);
  const unadmitted = dispatchOf(service.demand({ begin: true, target }, false));
  service.cancel({ ticket: unadmitted.ticket, undispatched: true });
  assert.equal(service.hasUnsettled(unadmitted.ticket), false);
  assert.equal(stateOf(service, key('a')), 'observed');
  const admitted = dispatchOf(service.demand({ begin: true, target }, false));
  service.authorizeDispatch({ ticket: admitted.ticket });
  service.complete({ ticket: admitted.ticket, outcome: { schemaVersion: 'collection-dispatch-outcome/1', kind: 'native-not-started', requestId: admitted.ticket, generation: admitted.generation } });
  assert.equal(stateOf(service, key('a')), 'observed');
});

test('revision, epoch, unavailable revision and explicit invalidation discard retained reuse', () => {
  const changes: readonly NativeStamp[] = [{ epoch: 1, revision: 3 }, { epoch: 1, revision: 5 }, { epoch: 2, revision: 4 }, { epoch: 1, revision: null }];
  for (const changed of changes) {
    const service = new CollectionService(); service.pair('p');
    const first = observe(service, [row('a')]);
    const next = observe(service, [row('b')], changed);
    assert.equal(stateOf(service, key('a')), 'unknown');
    assert.equal(freshnessOf(service, first), 'stale');
    if (changed.revision === null) {
      assert.equal(stateOf(service, key('b')), 'stale');
      assert.equal(freshnessOf(service, next), 'unknown');
    }
  }
  const service = new CollectionService(); service.pair('p');
  const first = observe(service, [row('a')]); service.invalidate();
  assert.equal(stateOf(service, key('a')), 'unknown');
  assert.equal(freshnessOf(service, first), 'stale');
  observe(service, [row('b')]); service.pair('replacement');
  assert.equal(stateOf(service, key('b')), 'unknown');
});

test('malformed later row and intra-job stamp changes cannot publish partial cache pages', () => {
  const service = new CollectionService(); service.pair('p');
  const bad = dispatchOf(service.demand({ begin: true, target }, false));
  service.authorizeDispatch({ ticket: bad.ticket });
  assert.throws(() => service.complete(jsonOf({ ticket: bad.ticket, page: page(bad, [row('good'), { id: 'bad' }]) })), /INVALID_COLLECTION_ROW/);
  assert.equal(stateOf(service, key('good')), 'unknown');
  const first = dispatchOf(service.demand({ begin: true, target }, false));
  service.authorizeDispatch({ ticket: first.ticket });
  service.complete(jsonOf({ ticket: first.ticket, page: page(first, [row('a')], stamp, 2) }));
  const second = dispatchOf(service.demand({ begin: false, jobId: first.jobId }, false));
  service.authorizeDispatch({ ticket: second.ticket });
  const changed = { ...page(second, [row('b')], { epoch: 1, revision: 5 }), sessionId: 's-' + first.jobId };
  assert.throws(() => service.complete(jsonOf({ ticket: second.ticket, page: changed })), /PROJECT_CHANGED/);
  assert.equal(stateOf(service, key('a')), 'unknown');
  assert.equal(stateOf(service, key('b')), 'unknown');
});

test('retention preserves row and byte bounds and demand eviction under repeated jobs', () => {
  const service = new CollectionService(); service.pair('p');
  const batchRows = (batch: number): JsonObject[] => Array.from({ length: 25 }, (_, i) => row(String(batch * 25 + i)));
  const first = observe(service, batchRows(0));
  for (let batch = 1; batch < 704; batch++) observe(service, batchRows(batch));
  assert.equal(stateOf(service, key('0')), 'unknown');
  assert.equal(stateOf(service, key('17599')), 'observed');
  assert.equal(fieldOf(service.demandResult(first.ticket), 'error.code'), 'DEMAND_NOT_FOUND');
  assert.ok(retainedOf(service).rows.length <= 16384);
  for (let batch = 0; batch < 1400; batch++) observe(service, Array.from({ length: 4 }, (_, i) => ({ ...row('large-' + batch + '-' + i), payload: 'x'.repeat(9000) })));
  assert.ok(retainedOf(service).rows.length <= 16384);
  assert.ok(retainedOf(service).bytes <= 33554432);
  assert.equal(fieldOf(service.lookup(key('large-1399-3')), 'writeAuthorizing'), false);
  const expectedBytes = retainedOf(service).rows.reduce((sum, cached) => sum + cached.bytes, 0);
  assert.equal(retainedOf(service).bytes, expectedBytes);
});

function layerRows(batch: number): JsonObject[] {
  return Array.from({ length: 10 }, (_, i) => ({
    ...row(String(batch * 10 + i)), index: batch * 10 + i + 1, layerIndex: batch * 10 + i + 1, locked: false, selected: false,
    detail: 'layer-index', values: 'not-read', payload: 'x'.repeat(9000),
  }));
}
const COMPOSITION_METADATA = {
  runtime: {}, project: {},
  composition: { id: 'comp', itemIndex: 1, name: 'Comp', width: 1920, height: 1080, duration: 10, frameRate: 30 }, layerCount: 1024,
};

test('metadata assembly refuses its aggregate byte cap before committing the new page', () => {
  const service = new CollectionService(); service.pair('p');
  const layerTarget = { kind: 'layers', itemIndex: 1, compositionId: 'comp' };
  let jobId: string | undefined, failed = false;
  for (let batch = 0; batch < 60; batch++) {
    const dispatch = dispatchOf(service.demand(jsonOf({ begin: !jobId, jobId, target: layerTarget }), false));
    service.authorizeDispatch({ ticket: dispatch.ticket });
    const response = { ...page(dispatch, layerRows(batch), stamp, (batch + 1) * 10 + 1), sessionId: 'layers-session', kind: 'layers', metadata: COMPOSITION_METADATA };
    try { service.complete(jsonOf({ ticket: dispatch.ticket, page: response })); }
    catch (error) {
      assert.ok(error instanceof Error);
      assert.match(error.message, /METADATA_BYTE_LIMIT/);
      assert.equal(retainedOf(service).bytes, 0);
      assert.equal(hasJob(service), false);
      failed = true; break;
    }
    jobId = dispatch.jobId;
  }
  assert.equal(failed, true);
});
