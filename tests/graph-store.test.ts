/** Tests the project graph's relational store: strict typed tables, reopening and bounded observation. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject as ResponseObject } from '../apps/sidecar/dist/tests/http-json.js';
import { identity, indexTarget as target, item, sampleCensus, samplePresets } from './graph-test-support.ts';

interface StoreFiles { directory: string; path: string; open(): GraphStore }

const page = (rows: JsonObject[], extra: JsonObject = {}): JsonObject => ({ ...identity, stamp: { epoch: 1, revision: 4 }, rows, ...extra });
const completion = (ticket: string, sessionId: string, rows: JsonObject[]): JsonObject => ({
  ...page(rows), ok: true, requestId: ticket, sessionId, nextCursor: null, deepComplete: false,
});
function fixture(t: TestContext, maxRows = 100000): StoreFiles {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-typed-store-')), path = join(directory, 'project-graph.extynt');
  const stores: GraphStore[] = [], open = (): GraphStore => { const store = new GraphStore(path, maxRows); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, open };
}
function queryAll(store: GraphStore, queryTarget: JsonObject, now = 10): ResponseObject[] {
  const rows: ResponseObject[] = []; let cursor: number | undefined;
  do {
    const result = store.query(jsonOf({ target: queryTarget, cursor }), now), next = result.nextCursor;
    rows.push(...recordsOf(result, 'rows')); cursor = typeof next === 'number' ? next : undefined;
  } while (cursor !== undefined);
  return rows;
}
const ticketOf = (demand: JsonObject): string => textOf(demand, 'ticket');

test('extynt is a private STRICT typed relational SQLite database with no payload columns', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  assert.equal(fieldOf(store.observe(target, page([item(7, "Comp'; DROP TABLE nodes;--")]), 'panel', 10), 'state'), 'ready');
  assert.equal(readFileSync(f.path).subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.equal(statSync(f.path).mode & 0o777, 0o600);
  const db = new DatabaseSync(f.path, { readOnly: true }); t.after(() => db.close());
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all();
  assert.ok(tables.length >= 10);
  for (const table of tables) {
    assert.match(textOf(table, 'sql'), /STRICT/);
    for (const column of db.prepare(`PRAGMA table_info(${textOf(table, 'name')})`).all()) {
      assert.ok(['INTEGER', 'TEXT', 'REAL'].includes(textOf(column, 'type')), `${textOf(table, 'name')}.${textOf(column, 'name')} has ${textOf(column, 'type')}`);
      assert.doesNotMatch(textOf(column, 'name'), /json|jsx|blob|payload|script|expression_source/i);
    }
  }
  const row = db.prepare('SELECT n.name,typeof(n.ordinal) AS ordinal_type,i.type FROM nodes n JOIN items i ON i.node_id=n.id').get();
  assert.equal(fieldOf(row, 'ordinal_type'), 'integer'); assert.equal(fieldOf(row, 'type'), 'composition');
  assert.equal(fieldOf(store.query({ target }, 11), 'rows.0.row.name'), fieldOf(row, 'name'));
});

test('reopen retains descriptors but only a new bounded observation becomes current', (t: TestContext) => {
  const f = fixture(t), first = f.open();
  const properties = { kind: 'properties', compositionId: '7', layerId: '8' };
  const amount: JsonObject = {
    id: 'Effect/Amount', name: 'Amount', path: 'Effect/Amount', matchName: 'Vendor-Amount', children: 0, valueType: 'OneD', propertyType: 'PROPERTY',
    minimum: 0, maximum: 100, propertyIndices: [1, 2], canVaryOverTime: true, canSetExpression: false,
  };
  first.observe(target, page([item(7)]), 'old-panel', 10);
  first.observe(properties, page([amount]), 'old-panel', 10);
  first.close();
  const restored = f.open();
  assert.equal(fieldOf(restored.query({ target }, 11), 'state'), 'unknown');
  restored.observe(target, page([item(7)]), 'new-panel', 11);
  const old = restored.query({ target: properties }, 12);
  assert.equal(fieldOf(old, 'rows.0.freshness'), 'stale'); assert.equal(fieldOf(old, 'rows.0.writeAuthorizing'), false);
  assert.deepEqual(fieldOf(old, 'rows.0.row.propertyIndices'), [1, 2]); assert.equal(fieldOf(old, 'rows.0.row.minimum'), 0); assert.equal(fieldOf(old, 'rows.0.row.maximum'), 100);
  assert.equal(fieldOf(old, 'rows.0.row.valueType'), 'OneD'); assert.equal(fieldOf(old, 'rows.0.row.canVaryOverTime'), true); assert.equal(fieldOf(old, 'rows.0.row.canSetExpression'), false);
  assert.equal(fieldOf(restored.query({ target }, 12), 'rows.0.freshness'), 'observed');
});

test('scalar/vector key observations normalize to REAL components and unknown custom values stay unknown', (t: TestContext) => {
  const f = fixture(t), store = f.open(), values = { kind: 'values', compositionId: '7', layerId: '8', propertyIndices: [1, 2] };
  const key: JsonObject = { id: 'key-1', name: 'Point', keyIndex: 1, time: 0.5, value: [10, 20], valueState: 'observed-key-value' };
  store.observe(values, page([key, { id: 'static', name: 'Custom', value: null, valueState: 'unknown' }]), 'panel', 10);
  const result = store.query({ target: values }, 11);
  assert.deepEqual(fieldOf(result, 'rows.0.row.value'), [10, 20]); assert.equal(fieldOf(result, 'rows.0.row.time'), 0.5);
  assert.equal(fieldOf(result, 'rows.1.row.value'), null); assert.equal(fieldOf(result, 'rows.1.row.valueState'), 'unknown');
  const db = new DatabaseSync(f.path, { readOnly: true }); t.after(() => db.close());
  const components = db.prepare('SELECT component,value,typeof(value) AS type FROM number_components ORDER BY component').all();
  assert.deepEqual(components.map(row => ({ ...row })), [{ component: 0, value: 10, type: 'real' }, { component: 1, value: 20, type: 'real' }]);
});

test('2000 items persist beyond the old 1024-row limit while queries remain bounded', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  for (let start = 1; start <= 2000; start += 25) store.observe(target, page(Array.from({ length: 25 }, (_, index) => item(start + index))), 'panel', 10);
  assert.equal(queryAll(store, target).length, 2000);
  assert.equal(recordsOf(store.query({ target, limit: 5000 }, 11), 'rows').length, 25);
  store.close(); const reopened = f.open();
  reopened.observe(target, page([item(1)]), 'new-panel', 12);
  const retained = queryAll(reopened, target, 13);
  assert.equal(retained.length, 2000); assert.equal(retained.filter(row => fieldOf(row, 'freshness') === 'observed').length, 1);
});

test('retention eviction and external deletion never imply current absence', (t: TestContext) => {
  const f = fixture(t, 40), store = f.open();
  for (let start = 1; start <= 100; start += 25) store.observe(target, page(Array.from({ length: 25 }, (_, index) => item(start + index))), 'panel', start);
  const rows = queryAll(store, target, 101);
  assert.equal(rows.length, 40); assert.equal(rows.some(row => fieldOf(row, 'row.id') === '1'), false);
  store.observe(target, page([item(100)], { stamp: { epoch: 1, revision: 5 } }), 'panel', 102);
  const result = store.query({ target }, 103);
  assert.equal(fieldOf(result, 'coverage.absentOutsidePage'), 'unknown'); assert.equal(fieldOf(result, 'coverage.deletionReconciliation'), 'not-established');
  assert.equal(fieldOf(result, 'rows.0.freshness'), 'stale');
});

test('unsaved projects and saved project paths are isolated, filename does not confer freshness', (t: TestContext) => {
  const f = fixture(t), store = f.open(), untitled: JsonObject = { name: 'Untitled', filePath: null };
  const ids = (now: number): string[] => recordsOf(store.query({ target }, now), 'rows').map(row => textOf(row, 'row.id'));
  store.observe(target, page([item(1)], { project: untitled }), 'panel', 10);
  store.observe(target, page([item(2)], { project: untitled, stamp: { epoch: 2, revision: 4 } }), 'panel', 11);
  assert.deepEqual(ids(12), ['2']);
  store.observe(target, page([item(7)]), 'panel', 12);
  store.observe(target, page([item(9)], { project: { name: 'Saved.aep', filePath: '/different/Saved.aep' } }), 'panel', 13);
  assert.deepEqual(ids(14), ['9']);
  store.observe(target, page([item(7)], { stamp: { epoch: 3, revision: null } }), 'panel', 14);
  assert.equal(fieldOf(store.query({ target }, 15), 'rows.0.freshness'), 'unknown');
  store.invalidate(); assert.equal(fieldOf(store.query({ target }, 15), 'state'), 'unknown');
});

test('failed page transaction rolls back every row and leaves the previous database intact', (t: TestContext) => {
  const f = fixture(t), store = f.open(); store.observe(target, page([item(7)]), 'panel', 10);
  const status = store.observe(target, page([item(8), { ...item(9), type: 'invalid' }]), 'panel', 11);
  assert.equal(fieldOf(status, 'state'), 'degraded'); assert.equal(fieldOf(status, 'code'), 'GRAPH_ITEM_UNSUPPORTED');
  const db = new DatabaseSync(f.path, { readOnly: true }); t.after(() => db.close());
  assert.deepEqual(db.prepare('SELECT native_id FROM nodes').all().map(row => row.native_id), ['7']);
  assert.equal(fieldOf(store.observe(target, page([item(9)]), 'panel', 12), 'state'), 'ready');
});

test('a page write that fails on lock contention reports degraded, never leaves earlier rows current, and a later write proceeds', (t: TestContext) => {
  const f = fixture(t), store = f.open(); store.observe(target, page([item(7)]), 'panel', 10);
  assert.equal(fieldOf(store.query({ target }, 11), 'rows.0.freshness'), 'observed');
  const holder = new DatabaseSync(f.path); t.after(() => holder.close());
  holder.exec('BEGIN IMMEDIATE');
  const status = store.observe(target, page([item(8)]), 'panel', 12);
  assert.equal(fieldOf(status, 'state'), 'degraded');
  assert.equal(fieldOf(store.query({ target }, 13), 'state'), 'unknown', 'rows that may now be stale are not reported as current');
  holder.exec('ROLLBACK');
  assert.equal(fieldOf(store.observe(target, page([item(8)]), 'panel', 14), 'state'), 'ready');
  assert.ok(recordsOf(store.query({ target }, 15), 'rows').some(row => fieldOf(row, 'row.id') === '8'));
});

test('corrupt, future-version, symlink and journal-symlink files are preserved', (t: TestContext) => {
  const f = fixture(t); writeFileSync(f.path, 'not a database', { mode: 0o600 });
  const before = readFileSync(f.path), corrupt = f.open(); corrupt.observe(target, page([item(7)]), 'panel', 10);
  assert.equal(fieldOf(corrupt.status(), 'state'), 'unavailable'); assert.deepEqual(readFileSync(f.path), before);
  rmSync(f.path); const initial = f.open(); initial.observe(target, page([item(7)]), 'panel', 10); initial.close();
  const db = new DatabaseSync(f.path); db.exec('PRAGMA user_version=99'); db.close();
  const futureBytes = readFileSync(f.path), future = f.open(); future.observe(target, page([item(8)]), 'panel', 11);
  assert.equal(fieldOf(future.status(), 'code'), 'GRAPH_SCHEMA_UNSUPPORTED'); assert.deepEqual(readFileSync(f.path), futureBytes);
  const untouched = join(f.directory, 'untouched'); writeFileSync(untouched, 'preserve'); rmSync(f.path); symlinkSync(untouched, f.path);
  const linked = f.open(); linked.observe(target, page([item(9)]), 'panel', 12);
  assert.equal(fieldOf(linked.status(), 'code'), 'GRAPH_FILE_UNSAFE'); assert.equal(readFileSync(untouched, 'utf8'), 'preserve');
  rmSync(f.path); symlinkSync(untouched, f.path + '-journal'); const journal = f.open(); journal.observe(target, page([item(9)]), 'panel', 12);
  assert.equal(fieldOf(journal.status(), 'code'), 'GRAPH_FILE_UNSAFE'); assert.equal(readFileSync(untouched, 'utf8'), 'preserve');
});

test('cache failure does not cancel a validated native demand or publish malformed pages', (t: TestContext) => {
  const f = fixture(t); writeFileSync(f.path, 'preserve broken cache', { mode: 0o600 });
  const service = new CollectionService(() => 10, f.open()); service.pair('panel');
  const demand = service.demand({ begin: true, target }, false), ticket = ticketOf(demand); service.authorizeDispatch({ ticket });
  const result = service.complete({ ticket, page: completion(ticket, 'index-1', [item(7)]) });
  assert.equal(fieldOf(result, 'storage.state'), 'unavailable'); assert.equal(fieldOf(service.demandResult(ticket), 'state'), 'observed');
  assert.equal(fieldOf(service.demandResult(ticket), 'page.rows.0.id'), '7');
  const next = ticketOf(service.demand({ begin: true, target }, false)); service.authorizeDispatch({ ticket: next });
  assert.throws(() => service.complete({ ticket: next, page: { ok: false, error: { code: 'INDEX_READ_FAILED' } } }), /INDEX_READ_FAILED/);
  assert.equal(fieldOf(service.demandResult(next), 'error.code'), 'INDEX_READ_FAILED'); assert.equal(fieldOf(service.queryCache({ target }), 'state'), 'unknown');
});

test('explicit census stores installed effects and preset metadata in typed rows', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  assert.equal(fieldOf(store.observeCensus(sampleCensus(), 10, samplePresets()), 'state'), 'ready');
  const db = new DatabaseSync(f.path, { readOnly: true }); t.after(() => db.close());
  assert.deepEqual({ ...db.prepare('SELECT version,installed,completeness FROM installed_effects').get() }, { version: '1.2', installed: 1, completeness: 'partial' });
  assert.deepEqual({ ...db.prepare('SELECT name,root,truncated FROM presets').get() }, { name: 'Preset', root: 'user-presets', truncated: 1 });
});

test('typed native rows reject unsupported observed values and forged descriptor facts', (t: TestContext) => {
  const f = fixture(t), service = new CollectionService(() => 10, f.open()); service.pair('panel');
  const descriptor: JsonObject = { id: 'Effect/Amount', path: 'Effect/Amount', name: 'Amount', matchName: 'Amount', children: 0, propertyIndices: [1, 2], valueType: 'OneD', propertyType: 'PROPERTY' };
  const malformed: Array<[string, JsonObject]> = [
    ['values', { id: 'static', name: 'Amount', valueState: 'observed-static', value: { text: 'not numeric' } }],
    ['values', { id: 'key-1', name: 'Amount', valueState: 'observed-key-value', value: 5 }],
    ['values', { id: 'key-0', name: 'Amount', valueState: 'observed-key-value', value: 5, keyIndex: 0, time: 0 }],
    ['values', { id: 'key-1', name: 'Amount', valueState: 'observed-key-value', value: 5, keyIndex: 1, time: 'wrong' }],
    ['properties', { ...descriptor, valueType: '{"invalid":"payload"}' }],
    ['properties', { ...descriptor, propertyType: 'SCRIPT_SOURCE' }],
    ['properties', { ...descriptor, children: 'not-a-number' }],
    ['properties', { ...descriptor, propertyIndices: [0] }],
  ];
  for (const [kind, row] of malformed) {
    const scoped = { kind, compositionId: '7', itemIndex: 1, layerId: '8', layerIndex: 1, propertyIndices: [1, 2], expectedStamp: { epoch: 1, revision: 4 } };
    const ticket = ticketOf(service.demand({ begin: true, target: scoped }, false)); service.authorizeDispatch({ ticket });
    assert.throws(() => service.complete({ ticket, page: completion(ticket, 'bad-row', [row]) }), /INVALID_COLLECTION_(VALUE|DESCRIPTOR)/);
    assert.equal(fieldOf(service.demandResult(ticket), 'state'), 'unknown'); assert.equal(fieldOf(service.storageStatus(), 'state'), 'not-opened');
  }
});

test('new database preserves regular adjacent journal collisions without initializing SQLite', (t: TestContext) => {
  const f = fixture(t), journal = f.path + '-journal';
  writeFileSync(journal, 'pre-existing adjacent file', { mode: 0o600 });
  const store = f.open(); store.observe(target, page([item(7)]), 'panel', 10);
  assert.equal(fieldOf(store.status(), 'code'), 'GRAPH_FILE_COLLISION');
  assert.equal(readFileSync(journal, 'utf8'), 'pre-existing adjacent file');
});

test('accepted same-stamp target metadata retains cache but explicit changed snapshot retires it', (t: TestContext) => {
  const f = fixture(t), service = new CollectionService(() => 10, f.open()); service.pair('panel');
  const ticket = ticketOf(service.demand({ begin: true, target }, false)); service.authorizeDispatch({ ticket });
  service.complete({ ticket, page: completion(ticket, 'snapshot-source', [item(7)]) });
  service.reconcileSnapshot({ result: { ...identity, hostStamp: { epoch: 1, revision: 4 } } });
  assert.equal(fieldOf(service.queryCache({ target }), 'rows.0.freshness'), 'observed');
  service.reconcileSnapshot({ result: { ...identity, project: { name: 'B.aep', filePath: '/synthetic/B.aep' }, hostStamp: { epoch: 2, revision: 1 } } });
  assert.equal(fieldOf(service.queryCache({ target }), 'state'), 'unknown'); assert.equal(fieldOf(service.demandResult(ticket), 'freshness'), 'stale');
});

test('a hot rollback journal from an interrupted write is recovered, and an empty file is initialized', (t: TestContext) => {
  const f = fixture(t), store = f.open(); store.observe(target, page([item(7)]), 'panel', 10); store.close();
  const db = new DatabaseSync(f.path); db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; DELETE FROM nodes;');
  copyFileSync(f.path + '-journal', f.path + '-saved-journal'); db.exec('ROLLBACK'); db.close();
  copyFileSync(f.path + '-saved-journal', f.path + '-journal'); chmodSync(f.path + '-journal', 0o600); rmSync(f.path + '-saved-journal');
  const reopened = f.open(); assert.equal(fieldOf(reopened.observe(target, page([item(8)]), 'panel', 11), 'state'), 'ready'); reopened.close();
  rmSync(f.path); if (existsSync(f.path + '-journal')) rmSync(f.path + '-journal');
  writeFileSync(f.path, '', { mode: 0o600 });
  const empty = f.open(); assert.equal(fieldOf(empty.observe(target, page([item(9)]), 'panel', 12), 'state'), 'ready'); empty.close();
});
