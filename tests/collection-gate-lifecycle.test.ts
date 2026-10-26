/** Tests collection admission, cancellation and settlement of serialized read leases. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf, listOf } from '../apps/sidecar/dist/tests/http-json.js';
import { compareTranscript, layer, metadata, outcome, page, target } from './collection-gate-support.ts';

const invalidRequests: ReadonlyArray<readonly [JsonValue, string]> = [
  [null, 'INVALID_COLLECTION_REQUEST'],
  [{ begin: true, target: { kind: 'all' } }, 'INVALID_COLLECTION_TARGET'],
  [{ begin: true, target: { kind: 'layers', itemIndex: 0, compositionId: 'comp' } }, 'INVALID_COLLECTION_TARGET'],
  [{ begin: true, target: { ...target('properties'), layerId: '' } }, 'INVALID_COLLECTION_TARGET'],
  [{ begin: true, target: { ...target('values'), propertyIndices: [] } }, 'INVALID_COLLECTION_TARGET'],
  [{ begin: true, target: { ...target('values'), propertyIndices: Array.from({ length: 17 }, () => 1) } }, 'INVALID_COLLECTION_TARGET'],
  [{ begin: true, target: { ...target('values'), expectedStamp: { epoch: 1, revision: null } } }, 'INVALID_COLLECTION_STAMP'],
  [{ begin: true, target: { kind: 'index' }, startCursor: 0 }, 'INVALID_CURSOR'],
  [{ jobId: 'foreign' }, 'STALE_COLLECTION'],
];
for (const [input, code] of invalidRequests) test(`immutable request rejection ${code}: ${JSON.stringify(input)}`, () => {
  compareTranscript(h => {
    assert.deepEqual(h.demand(input), { thrown: code });
    assert.deepEqual(h.demand(input, true), { thrown: 'COLLECTION_BUSY' });
    const d = h.start();
    assert.equal(d.generation, 2); h.evidence(d, { kind: 'index' });
  });
});
test('immutable admission, cancellation and exact settlement preserve serialized leases', () => {
  compareTranscript(h => {
    const d = h.start();
    assert.deepEqual(h.finish(d, page(d)), { thrown: 'COLLECTION_NOT_ADMITTED' });
    h.emit('wrong-admission', () => h.service.authorizeDispatch({ ticket: 'wrong' })); h.admit(d); h.admit(d);
    h.emit('healthy-settlement', () => h.service.settleNativeAfterBridge(d.ticket)); h.evidence(d, { kind: 'index' });
    h.emit('generic-cancel', () => h.service.cancel({ ticket: d.ticket, undispatched: true }));
    assert.deepEqual(h.demand(), { thrown: 'COLLECTION_BUSY' });
    h.emit('wrong-settlement', () => h.service.settleNativeAfterBridge('wrong')); h.evidence(d, { kind: 'index' });
    assert.deepEqual(h.finish(d, page(d)), { thrown: 'COLLECTION_CANCELLED' }); h.evidence(d, { kind: 'index' });
    const next = h.start(); h.admit(next);
    assert.deepEqual(h.finish(d, page(d)), { thrown: 'STALE_COLLECTION_TICKET' });
    h.emit('old-settlement', () => h.service.settleNativeAfterBridge(d.ticket)); h.evidence(next, { kind: 'index' });
  });
});
for (const code of ['HOST_TIMEOUT', 'HOST_QUARANTINED', 'HOST_DISPATCH_UNKNOWN']) test(`a failed read page ${code} retires the ticket with its code, survives pairing and blocks nothing`, () => {
  compareTranscript(h => {
    const d = h.start(); h.admit(d);
    assert.deepEqual(h.finish(d, { ok: false, error: { code } }), { thrown: code });
    assert.equal(fieldOf(h.service.demandResult(d.ticket), 'error.code'), code); h.evidence(d, { kind: 'index' });
    h.emit('new-panel', () => h.service.pair('replacement')); h.emit('wrong-settlement', () => h.service.settleNativeAfterBridge('wrong'));
    assert.deepEqual(h.emit('outcome-after-failure', () => h.service.complete(outcome(d))), { thrown: 'STALE_COLLECTION_TICKET' }); h.evidence(d, { kind: 'index' });
    h.emit('old-settlement', () => h.service.settleNativeAfterBridge(d.ticket)); h.evidence(d, { kind: 'index' });
    assert.equal(h.service.hasUnsettled(d.ticket), false); assert.equal(h.service.nativeAccessQuarantine(), null);
    assert.deepEqual(h.finish(d, page(d)), { thrown: 'STALE_COLLECTION_TICKET' }); h.demand();
  });
});
const outcomeOverrides: readonly JsonObject[] = [{ generation: 0 }, { requestId: 'wrong' }, { kind: 'native-started' }, { schemaVersion: 'wrong' }];
for (const override of outcomeOverrides) test(`immutable dispatch-outcome rejection ${JSON.stringify(override)}`, () => {
  compareTranscript(h => {
    const d = h.start(); h.admit(d);
    assert.deepEqual(h.emit('forged-outcome', () => h.service.complete(outcome(d, override))), { thrown: 'INVALID_COLLECTION_DISPATCH_OUTCOME' });
    assert.equal(h.service.hasUnsettled(d.ticket), true);
    h.emit('cancel', () => h.service.cancel());
    assert.equal(fieldOf(h.emit('exact-outcome', () => h.service.complete(outcome(d))), 'nativeStarted'), false); h.evidence(d, { kind: 'index' });
    h.emit('duplicate-outcome', () => h.service.complete(outcome(d))); h.demand();
  });
});
test('immutable undispatched demand cancellation releases once and admitted abandonment waits', () => {
  compareTranscript(h => {
    const unadmitted = h.start(); h.emit('cancel-demand', () => h.service.cancelDemand(unadmitted.ticket)); h.evidence(unadmitted, { kind: 'index' });
    const admitted = h.start(); h.admit(admitted); h.emit('cancel-demand', () => h.service.cancelDemand(admitted.ticket));
    assert.equal(h.service.hasUnsettled(admitted.ticket), true); h.emit('settle', () => h.service.settleNativeAfterBridge(admitted.ticket));
    h.evidence(admitted, { kind: 'index' }); h.demand();
  });
});
test('an outstanding read past 60 s is retired by the next request with COLLECTION_TIMED_OUT instead of quarantining', () => {
  compareTranscript(h => {
    const d = h.start(); h.admit(d); h.time(60999); h.evidence(d, { kind: 'index' });
    assert.deepEqual(h.demand(null, true), { thrown: 'COLLECTION_BUSY' }); assert.equal(h.service.hasUnsettled(d.ticket), true);
    h.time(61000); h.evidence(d, { kind: 'index' });
    assert.equal(fieldOf(h.service.demandResult(d.ticket), 'error.code'), 'DEMAND_TIMEOUT');
    assert.deepEqual(h.demand(null, true), { thrown: 'COLLECTION_BUSY' }); h.evidence(d, { kind: 'index' });
    assert.equal(h.service.hasUnsettled(d.ticket), false); assert.equal(fieldOf(h.service.demandResult(d.ticket), 'error.code'), 'COLLECTION_TIMED_OUT'); assert.equal(h.service.nativeAccessQuarantine(), null);
    h.emit('settle', () => h.service.settleNativeAfterBridge(d.ticket)); h.demand();
  });
});
test('immutable numeric and descriptor validation reject malformed later rows atomically', () => {
  for (const kind of ['values', 'properties']) compareTranscript(h => {
    const scope = target(kind), d = h.start({ begin: true, target: scope }); h.admit(d);
    const good = kind === 'values' ? { id: 'a', name: 'A', valueState: 'observed-static', value: 12 } : { id: 'a', name: 'A', path: 'a', propertyIndices: [1], matchName: 'ADBE A', children: 0 };
    const bad = kind === 'values' ? { ...good, id: 'b', value: [1, Infinity] } : { ...good, id: 'b', path: 'b', minimum: 2, maximum: 1 };
    const code = kind === 'values' ? 'INVALID_COLLECTION_VALUE' : 'INVALID_COLLECTION_DESCRIPTOR';
    assert.deepEqual(h.finish(d, page(d, { rows: [good, bad] })), { thrown: code }); h.evidence(d, scope, ['a', 'b']);
    assert.equal(listOf(h.service.queryCache({ target: scope }), 'rows').length, 0);
  });
});
test('immutable metadata byte bound invalidates retained prefix before terminal snapshot', () => {
  compareTranscript(h => {
    const scope = target('layers'); let d = h.start({ begin: true, target: scope }), cursor = 1, last: JsonObject = {};
    while (cursor <= 1000) {
      h.admit(d);
      const rows = Array.from({ length: 25 }, (_, i) => ({ ...layer(cursor + i), payload: 'x'.repeat(4500) }));
      last = h.finish(d, page(d, { kind: 'layers', rows, nextCursor: cursor + 25, metadata: metadata(1000) }));
      if (fieldOf(last, 'thrown')) break;
      assert.equal(fieldOf(last, 'snapshot'), undefined); cursor += 25; d = h.start({ jobId: d.jobId });
    }
    assert.deepEqual(last, { thrown: 'METADATA_BYTE_LIMIT' }); assert.ok(cursor > 25);
    h.evidence(d, scope, ['1', String(cursor)]); assert.equal(listOf(h.service.queryCache({ target: scope }), 'rows').length, 0);
  });
});
test('immutable zero-layer terminal inventory publishes empty scoped metadata', () => {
  compareTranscript(h => {
    const scope = target('layers'), d = h.start({ begin: true, target: scope }); h.admit(d);
    const result = h.finish(d, page(d, { kind: 'layers', rows: [], metadata: metadata(0) }));
    assert.deepEqual(fieldOf(result, 'snapshot.result.compositions.0.layers'), []); h.evidence(d, scope);
  });
});
