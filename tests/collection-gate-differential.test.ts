/** Tests that the collection gate's normalised transcript keeps user ids, values and freshness exactly. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, listOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { compareTranscript, layer, metadata, normalizeCollectionTranscript, page, stamp, target } from './collection-gate-support.ts';
import type { TranscriptEntry } from './collection-gate-support.ts';

test('differential normalization preserves all user UUID IDs and values verbatim', () => {
  const ticket = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
  const transcript: TranscriptEntry[] = [{ label: 'demand', value: { ok: true, ticket, jobId: '33333333-3333-4333-8333-333333333333' } }, { label: 'complete', value: { page: { requestId: ticket, rows: [{ id: ticket, value: user, requestId: ticket }] } } }];
  const normalized = normalizeCollectionTranscript(transcript);
  assert.equal(fieldOf(normalized, '0.value.ticket'), 'token-1'); assert.equal(fieldOf(normalized, '1.value.page.requestId'), 'token-1');
  assert.deepEqual(fieldOf(normalized, '1.value.page.rows'), fieldOf(transcript, '1.value.page.rows'));
});

const malformedPages: ReadonlyArray<readonly [string, JsonObject, string]> = [
  ['native refusal', { ok: false, error: { code: 'STALE_TARGET' } }, 'STALE_TARGET'],
  ['invalid native code', { ok: false, error: { code: 'unsafe-code' } }, 'INVALID_COLLECTION_PAGE'],
  ['request identity', { requestId: 'other' }, 'INVALID_COLLECTION_PAGE'],
  ['empty session', { sessionId: '' }, 'INVALID_COLLECTION_PAGE'],
  ['array session', { sessionId: [] }, 'INVALID_COLLECTION_PAGE'],
  ['unbounded rows', { rows: Array.from({ length: 26 }, () => ({ id: 'a', name: 'A' })) }, 'INVALID_COLLECTION_PAGE'],
  ['deep claim', { deepComplete: true }, 'INVALID_COLLECTION_PAGE'],
  ['backward cursor', { nextCursor: 1 }, 'INVALID_COLLECTION_PAGE'],
  ['fractional cursor', { nextCursor: 2.5 }, 'INVALID_COLLECTION_PAGE'],
  ['epoch zero', { stamp: { epoch: 0, revision: 2 } }, 'INVALID_COLLECTION_STAMP'],
  ['revision string', { stamp: { epoch: 1, revision: '2' } }, 'INVALID_COLLECTION_STAMP'],
  ['malformed second row', { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 2 }] }, 'INVALID_COLLECTION_ROW'],
  ['row bytes', { rows: [{ id: 'a', name: 'A', payload: 'x'.repeat(16384) }] }, 'COLLECTION_ROW_BYTE_LIMIT'],
  ['page bytes', { payload: 'x'.repeat(131072) }, 'INVALID_COLLECTION_PAGE'],
];
for (const [name, overrides, code] of malformedPages) test(`immutable transcript: ${name} publishes no evidence`, () => {
  compareTranscript(h => {
    const d = h.start(); h.admit(d);
    assert.deepEqual(h.finish(d, page(d, overrides)), { thrown: code });
    assert.equal(fieldOf(h.service.demandResult(d.ticket), 'error.code'), code);
    assert.equal(fieldOf(h.service.lookup(JSON.stringify(['index', null, null, null, 'a'])), 'state'), 'unknown');
    assert.equal(listOf(h.service.queryCache({ target: { kind: 'index' } }), 'rows').length, 0);
    h.evidence(d, { kind: 'index' }, ['a', 'b']);
  });
});

const malformedLayers: ReadonlyArray<readonly [string, readonly JsonObject[], number, number | null, JsonObject, string]> = [
  ['kind', [layer(1)], 1, null, { kind: 'index' }, 'INVALID_LAYER_INVENTORY'],
  ['duplicate id', [layer(1, 'a'), layer(2, 'a')], 2, null, {}, 'INVALID_LAYER_INVENTORY'],
  ['ordinal', [layer(1), layer(3)], 2, null, {}, 'INVALID_LAYER_INVENTORY'],
  ['boolean', [layer(1), { ...layer(2), locked: 'false' }], 2, null, {}, 'INVALID_LAYER_INVENTORY'],
  ['binding', [{ ...layer(1), compositionId: 'other' }], 1, null, {}, 'INVALID_LAYER_INVENTORY'],
  ['row stamp', [{ ...layer(1), stamp: { epoch: 1, revision: 3 } }], 1, null, {}, 'INVALID_LAYER_INVENTORY'],
  ['skipped continuation', [layer(1)], 3, 3, {}, 'INVALID_LAYER_INVENTORY'],
  ['empty nonterminal', [], 1, 2, {}, 'INVALID_LAYER_INVENTORY'],
  ['terminal extent', [layer(1)], 2, null, {}, 'INCOMPLETE_LAYER_INVENTORY'],
  ['missing metadata', [layer(1)], 1, null, { metadata: null }, 'INVALID_LAYER_METADATA'],
  ['metadata identity', [layer(1)], 1, null, { metadata: { ...metadata(1), composition: { ...metadata(1).composition, id: 'other' } } }, 'INVALID_LAYER_METADATA'],
  ['metadata finite', [layer(1)], 1, null, { metadata: { ...metadata(1), composition: { ...metadata(1).composition, width: Infinity } } }, 'INVALID_LAYER_METADATA'],
];
for (const [name, rows, count, nextCursor, overrides, code] of malformedLayers) test(`immutable layer transcript: ${name}`, () => {
  compareTranscript(h => {
    const scope = target('layers'), d = h.start({ begin: true, target: scope }); h.admit(d);
    assert.deepEqual(h.finish(d, page(d, { kind: 'layers', rows, nextCursor, metadata: metadata(count), ...overrides })), { thrown: code });
    assert.equal(fieldOf(h.service.demandResult(d.ticket), 'error.code'), code);
    assert.equal(listOf(h.service.queryCache({ target: scope }), 'rows').length, 0);
    h.evidence(d, scope, rows.map(row => textOf(row, 'id')));
  });
});

test('immutable transcript preserves multi-page metadata, freshness and snapshot authority', () => {
  compareTranscript(h => {
    const scope = target('layers'), first = h.start({ begin: true, target: scope }); h.admit(first);
    assert.equal(fieldOf(h.finish(first, page(first, { kind: 'layers', rows: [layer(1)], nextCursor: 2, metadata: metadata(2) })), 'snapshot'), undefined);
    h.evidence(first, scope, ['1']);
    const final = h.start({ jobId: first.jobId }); h.admit(final);
    const accepted = h.finish(final, page(final, { kind: 'layers', rows: [layer(2)], metadata: metadata(2) }));
    assert.equal(fieldOf(accepted, 'snapshot.result.coverage.properties'), 'unknown');
    assert.deepEqual(fieldOf(accepted, 'snapshot.result.selectedLayerIds'), ['1']);
    h.evidence(final, scope, ['1', '2']); h.time(16000); h.evidence(final, scope, ['1', '2']);
    h.time(500); h.evidence(final, scope, ['1']);
    h.emit('reconcile', () => h.service.reconcileSnapshot(jsonOf(fieldOf(accepted, 'snapshot')))); h.evidence(final, scope, ['1']);
    h.emit('different-stamp', () => h.service.reconcileSnapshot({ result: { hostStamp: { epoch: 1, revision: 3 } } })); h.evidence(final, scope, ['1']);
  });
});
for (const count of [2, 1025]) test(`immutable metadata drift invalidates earlier page for ${count} layers`, () => {
  compareTranscript(h => {
    const scope = target('layers'), first = h.start({ begin: true, target: scope }); h.admit(first);
    h.finish(first, page(first, { kind: 'layers', rows: [layer(1)], nextCursor: 2, metadata: metadata(count) }));
    const next = h.start({ jobId: first.jobId }); h.admit(next);
    const changed = { ...metadata(count), project: { name: 'Changed' } };
    assert.deepEqual(h.finish(next, page(next, { kind: 'layers', rows: [layer(2)], nextCursor: 3, metadata: changed })), { thrown: 'PROJECT_CHANGED' });
    h.evidence(first, scope, ['1', '2']); h.evidence(next, scope, ['1', '2']);
  });
});
test('immutable null revision remains unknown without assembling metadata', () => {
  compareTranscript(h => {
    const scope = target('layers'), d = h.start({ begin: true, target: scope }); h.admit(d);
    const result = h.finish(d, page(d, { kind: 'layers', rows: [layer(1)], stamp: { ...stamp, revision: null }, metadata: null }));
    assert.equal(fieldOf(result, 'snapshot'), undefined); assert.equal(fieldOf(h.service.demandResult(d.ticket), 'freshness'), 'unknown');
    h.evidence(d, scope, ['1']);
  });
});
for (const kind of ['blur', 'effect-create']) test(`immutable exact ${kind} local snapshot remains scoped`, () => {
  compareTranscript(h => {
    const scope = target(kind), d = h.start({ begin: true, target: scope }); h.admit(d);
    const localEffect = { effectMatchName: 'ADBE Gaussian Blur 2', effectIndex: 1, inventory: [], effectEnabled: true,
      matchNames: ['ADBE Effect Parade', 'ADBE Gaussian Blur 2', 'ADBE Gaussian Blur 2-0001'], valueType: 'number', canSetValue: true,
      keyframeCount: 0, expressionEnabled: false, expression: '', value: 12, minimum: 0, maximum: 500, dependencyPolicy: 'local-literal-assignment' };
    const result = h.finish(d, page(d, { metadata: { ...metadata(1), layer: layer(1) }, localCreation: { available: true }, localEffect }));
    assert.equal(fieldOf(result, 'snapshot.result.coverage.otherLayers'), 'unknown');
    assert.equal(listOf(result, 'snapshot.result.compositions.0.layers').length, 1); h.evidence(d, scope);
  });
});
