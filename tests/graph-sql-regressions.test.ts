/** Tests graph store refresh behaviour: stable node keys, in-place fact refresh and rollback on failure. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';
import { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import { graphProject } from '../apps/sidecar/dist/src/graph-record.js';
import { GRAPH_SCHEMA_VERSION } from '../apps/sidecar/dist/src/graph-schema.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, numberOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { identity, indexTarget, item } from './graph-test-support.ts';

type SqlRow = Record<string, SQLOutputValue>;
type TableFacts = Record<string, SqlRow[]>;
interface RollbackCase { original: JsonObject; update: JsonObject; invalid: JsonObject }
interface SqlFixture { directory: string; path: string; store: GraphStore }

const page = (rows: JsonObject[], revision = 4): JsonObject => ({ ...identity, stamp: { epoch: 1, revision }, rows });
const descriptor = (id = 'Effect/Amount', extra: JsonObject = {}): JsonObject => ({
  id, name: 'Amount', path: id, matchName: 'Amount', children: 0, valueType: 'OneD', propertyType: 'PROPERTY', propertyIndices: [1, 2],
  minimum: 0, maximum: 100, canVaryOverTime: true, canSetExpression: false, ...extra,
});
const properties: JsonObject = { kind: 'properties', compositionId: '7', layerId: '8' };
const values: JsonObject = { kind: 'values', compositionId: '7', layerId: '8', propertyIndices: [1, 2] };
const TABLES = ['projects', 'scopes', 'nodes', 'items', 'layers', 'properties', 'property_indices', 'value_observations', 'number_components', 'installed_effects', 'presets'];
const V1_OBSERVATIONS = [
  "INSERT INTO items VALUES(101,'composition','0',1)", "INSERT INTO layers VALUES(102,0,1)",
  "INSERT INTO properties VALUES(103,'Effect/Amount','Amount',0,'OneD',0,100,'PROPERTY',1,0)", 'INSERT INTO property_indices VALUES(103,0,1),(103,1,2)',
  "INSERT INTO value_observations VALUES(104,'observed-key-value','vector',1,0.5)", 'INSERT INTO number_components VALUES(104,0,10),(104,1,20)',
].join(';');
const V1_CATALOGUE = [
  "INSERT INTO installed_effects VALUES('host','Vendor Effect','Effect','Vendor','1.2',1,10,'partial')",
  "INSERT INTO presets VALUES('host','preset','Preset','User','user-presets','fingerprint','2026-10-01T00:00:00.000Z',0)",
].join(';');
const NODE_KEYS = 'SELECT id,native_id FROM nodes ORDER BY id';
function fixture(t: TestContext): SqlFixture {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-sql-regression-')), path = join(directory, 'project.extynt'), store = new GraphStore(path);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, store };
}
function inspect<Result>(path: string, read: (database: DatabaseSync) => Result): Result {
  const database = new DatabaseSync(path, { readOnly: true });
  try { return read(database); } finally { database.close(); }
}
const copies = (database: DatabaseSync, sql: string): SqlRow[] => database.prepare(sql).all().map(row => ({ ...row }));
const rowIds = (result: JsonObject): string[] => recordsOf(result, 'rows').map(row => textOf(row, 'row.id'));
const nodeKeys = (path: string): SqlRow[] => inspect(path, database => copies(database, NODE_KEYS));
const nodeId = (path: string): number => inspect(path, database => numberOf(database.prepare('SELECT id FROM nodes').get(), 'id'));
const userVersion = (database: DatabaseSync): number => numberOf(database.prepare('PRAGMA user_version').get(), 'user_version');
const countOf = (database: DatabaseSync, sql: string): number => numberOf(database.prepare(sql).get(), 'count');
const facts = (database: DatabaseSync): TableFacts => Object.fromEntries(TABLES.map(table => [table, copies(database, `SELECT * FROM ${table} ORDER BY rowid`)]));
function seedV1(path: string): DatabaseSync {
  writeFileSync(path, '', { mode: 0o600 });
  const database = new DatabaseSync(path), project = graphProject(page([]), 'old');
  database.exec(readFileSync(new URL('./fixtures/graph-schema-v1.sql', import.meta.url), 'utf8'));
  database.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(project.id, project.path, project.name, project.version, project.platform);
  const scope = database.prepare('INSERT INTO scopes VALUES(?,?,?,?,?,?)');
  scope.run(1, project.id, 'index', '', '', ''); scope.run(2, project.id, 'layers', '7', '', '');
  scope.run(3, project.id, 'properties', '7', '8', ''); scope.run(4, project.id, 'values', '7', '8', '1/2');
  const node = database.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?,?,?)');
  node.run(101, 1, '7', 'Comp', 1, 'old-owner', 1, 4, 10); node.run(102, 2, '8', 'Layer', 1, 'old-owner', 1, 4, 10);
  node.run(103, 3, 'Effect/Amount', 'Amount', null, 'old-owner', 1, 4, 10); node.run(104, 4, 'key-1', 'Point', 1, 'old-owner', 1, 4, 10);
  database.exec(V1_OBSERVATIONS);
  database.exec(V1_CATALOGUE);
  return database;
}

test('same-stamp refresh preserves node keys and cannot duplicate a native identity between pages', (t: TestContext) => {
  const f = fixture(t); f.store.observe(indexTarget, page([1, 2, 3, 4].map(id => item(id))), 'panel', 10);
  const before = nodeKeys(f.path);
  const first = f.store.query({ target: indexTarget, limit: 2 }, 11);
  f.store.observe(indexTarget, page([item(1, 'Updated')]), 'panel', 12);
  const second = f.store.query(jsonOf({ target: indexTarget, cursor: first.nextCursor, limit: 2 }), 13);
  const tail = second.nextCursor === null ? [] : rowIds(f.store.query(jsonOf({ target: indexTarget, cursor: second.nextCursor, limit: 2 }), 13));
  assert.deepEqual([...rowIds(first), ...rowIds(second), ...tail], ['1', '2', '3', '4']);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(nodeKeys(f.path), before);
  assert.equal(fieldOf(f.store.query({ target: indexTarget }, 13), 'rows.0.row.name'), 'Updated');
});

test('item and layer facts refresh in place with bound values and unchanged conservative coverage', (t: TestContext) => {
  const f = fixture(t), layers: JsonObject = { kind: 'layers', compositionId: '7' };
  const revisedItem: JsonObject = Object.fromEntries(Object.entries({ ...item(7, "Bound'; DROP TABLE nodes;--"), type: 'footage', parentFolderId: '9' }).filter(([name]) => name !== 'layers'));
  f.store.observe(indexTarget, page([item(7)]), 'panel', 10);
  f.store.observe(layers, page([{ id: '8', name: 'Layer', layerIndex: 1, locked: false, selected: true }]), 'panel', 10);
  const before = nodeKeys(f.path);
  f.store.observe(indexTarget, page([revisedItem], 5), 'panel', 11);
  f.store.observe(layers, page([{ id: '8', name: 'Layer revised', layerIndex: 2, locked: true, selected: false }], 5), 'panel', 11);
  assert.deepEqual(nodeKeys(f.path), before);
  const stored = inspect(f.path, db => copies(db, 'SELECT type,parent_folder_id,layer_count FROM items'));
  assert.deepEqual(stored, [{ type: 'footage', parent_folder_id: '9', layer_count: null }]);
  const result = f.store.query({ target: layers }, 12);
  assert.equal(fieldOf(result, 'rows.0.row.locked'), true); assert.equal(fieldOf(result, 'rows.0.row.selected'), false);
  assert.equal(fieldOf(result, 'rows.0.row.index'), 2); assert.equal(fieldOf(result, 'writeAuthorizing'), false);
  assert.equal(fieldOf(result, 'coverage.absentOutsidePage'), 'unknown');
});

test('descriptor refresh replaces old path components without replacing the node identity', (t: TestContext) => {
  const f = fixture(t); f.store.observe(properties, page([descriptor()]), 'panel', 10);
  const node = nodeId(f.path);
  const extra: JsonObject = { propertyIndices: [9], minimum: -50, maximum: 500, children: 2, canVaryOverTime: false, canSetExpression: true };
  f.store.observe(properties, page([descriptor('Effect/Amount', extra)]), 'panel', 11);
  assert.equal(nodeId(f.path), node);
  const result = f.store.query({ target: properties }, 12);
  assert.deepEqual(fieldOf(result, 'rows.0.row.propertyIndices'), [9]); assert.equal(fieldOf(result, 'rows.0.row.minimum'), -50);
  assert.equal(fieldOf(result, 'rows.0.row.maximum'), 500); assert.equal(fieldOf(result, 'rows.0.row.children'), 2);
  assert.equal(fieldOf(result, 'rows.0.row.canVaryOverTime'), false); assert.equal(fieldOf(result, 'rows.0.row.canSetExpression'), true);
});

test('value refresh replaces vector components and obsolete key facts while keeping its node key', (t: TestContext) => {
  const f = fixture(t), observation: JsonObject = { id: 'point', name: 'Point', valueState: 'observed-key-value', keyIndex: 1, time: 0.5, value: [10, 20, 30] };
  f.store.observe(values, page([observation]), 'panel', 10);
  const node = nodeId(f.path);
  f.store.observe(values, page([{ id: 'point', name: 'Point', valueState: 'observed-static', value: 42 }]), 'panel', 11);
  const result = f.store.query({ target: values }, 12);
  assert.equal(fieldOf(result, 'rows.0.row.value'), 42); assert.equal(fieldOf(result, 'rows.0.row.keyIndex'), null);
  assert.equal(fieldOf(result, 'rows.0.row.time'), null);
  assert.deepEqual(inspect(f.path, db => copies(db, 'SELECT component,value FROM number_components')), [{ component: 0, value: 42 }]);
  f.store.observe(values, page([{ id: 'point', name: 'Point', valueState: 'unknown', value: null }]), 'panel', 12);
  assert.equal(nodeId(f.path), node);
  assert.deepEqual(inspect(f.path, db => copies(db, 'SELECT * FROM number_components')), []);
  assert.equal(fieldOf(f.store.query({ target: values }, 13), 'rows.0.row.valueState'), 'unknown');
});

function rollbackCase(t: TestContext, scoped: JsonObject, { original, update, invalid }: RollbackCase): void {
  const f = fixture(t); f.store.observe(scoped, page([original]), 'panel', 10);
  const before = inspect(f.path, facts);
  const result = f.store.observe(scoped, page([update, invalid], 5), 'panel', 11);
  assert.equal(fieldOf(result, 'state'), 'degraded'); assert.equal(fieldOf(f.store.query({ target: scoped }, 12), 'state'), 'unknown');
  assert.deepEqual(inspect(f.path, facts), before);
}
test('failed later descriptor restores the earlier upsert, typed path facts and stamp atomically', (t: TestContext) => {
  const update = descriptor('Effect/Amount', { name: 'Updated', propertyIndices: [9], minimum: -20 });
  rollbackCase(t, properties, { original: descriptor(), update, invalid: descriptor('Other', { children: -1 }) });
});
test('failed later value restores all earlier numeric components and key facts atomically', (t: TestContext) => {
  rollbackCase(t, values, {
    original: { id: 'point', name: 'Point', valueState: 'observed-key-value', keyIndex: 1, time: 0.5, value: [10, 20] },
    update: { id: 'point', name: 'Updated', valueState: 'observed-static', value: 42 },
    invalid: { id: 'bad', name: 'Bad', valueState: 'observed-static', value: {} },
  });
});

test('v1 migrates its keyset index and adds definitions while preserving all typed observations', (t: TestContext) => {
  const f = fixture(t), old = seedV1(f.path), before = facts(old); old.close();
  assert.equal(fieldOf(f.store.query({ target: indexTarget }, 19), 'state'), 'unknown');
  assert.equal(fieldOf(f.store.observe(indexTarget, page([]), 'new-panel', 20), 'state'), 'ready');
  inspect(f.path, db => {
    assert.equal(userVersion(db), 3);
    assert.deepEqual(facts(db), before);
    assert.deepEqual(copies(db, 'PRAGMA index_info(nodes_scope_id)').map(row => row.name), ['scope_id', 'id']);
    assert.equal(countOf(db, "SELECT count(*) AS count FROM sqlite_master WHERE name='nodes_scope_order'"), 0);
  });
  assert.equal(fieldOf(f.store.query({ target: properties }, 21), 'rows.0.freshness'), 'stale');
  assert.deepEqual(fieldOf(f.store.query({ target: values }, 21), 'rows.0.row.value'), [10, 20]);
  assert.equal(fieldOf(f.store.status(), 'schemaVersion'), GRAPH_SCHEMA_VERSION); assert.equal(GRAPH_SCHEMA_VERSION, 3);
  const wrapper = new ProjectGraphStore(f.directory); assert.equal(fieldOf(wrapper.status(), 'schemaVersion'), 3); wrapper.close();
});

test('a real v1 migration failure rolls back the removed index and preserves version and data', (t: TestContext) => {
  const f = fixture(t), old = seedV1(f.path), indexSql = "SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name";
  old.exec('CREATE TABLE nodes_scope_id (preserved TEXT) STRICT');
  const before = facts(old), indexes = copies(old, indexSql); old.close();
  const bytes = readFileSync(f.path), result = f.store.observe(indexTarget, page([]), 'panel', 20);
  assert.equal(fieldOf(result, 'state'), 'unavailable'); assert.equal(fieldOf(f.store.query({ target: indexTarget }, 21), 'state'), 'unknown');
  inspect(f.path, db => {
    assert.equal(userVersion(db), 1);
    assert.deepEqual(facts(db), before);
    assert.deepEqual(copies(db, indexSql), indexes);
    assert.equal(countOf(db, "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='nodes_scope_id'"), 1);
  });
  assert.deepEqual(readFileSync(f.path), bytes);
});

function nodeQuery(): string {
  const source = readFileSync('apps/sidecar/dist/src/graph-read.js', 'utf8'), match = /const NODE_QUERY = `([\s\S]*?)`;/.exec(source);
  const query = match?.[1];
  if (query === undefined) throw new Error('NODE_QUERY not found');
  return query;
}

test('the actual 10000-node keyset query uses scope/id index with no temporary sort', (t: TestContext) => {
  const f = fixture(t), query = nodeQuery();
  for (let start = 1; start <= 10000; start += 25) f.store.observe(indexTarget, page(Array.from({ length: 25 }, (_, index) => item(start + index))), 'panel', 10);
  inspect(f.path, db => {
    assert.equal(countOf(db, 'SELECT count(*) AS count FROM nodes'), 10000);
    const scope = numberOf(db.prepare("SELECT id FROM scopes WHERE kind='index'").get(), 'id');
    for (const cursor of [0, 5000, 9975]) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(scope, cursor, 26).map(row => textOf(row, 'detail')).join('\n');
      assert.match(plan, /SEARCH n USING INDEX nodes_scope_id/); assert.doesNotMatch(plan, /TEMP B-TREE/);
      assert.ok(recordsOf(f.store.query({ target: indexTarget, cursor }, 11), 'rows').length <= 25);
    }
  });
});

test('unknown, foreign, future and corrupt files remain byte-for-byte preserved', (t: TestContext) => {
  for (const kind of ['unknown', 'foreign', 'future', 'corrupt']) {
    const f = fixture(t);
    if (kind === 'corrupt') writeFileSync(f.path, 'preserve damaged SQLite', { mode: 0o600 });
    else {
      const database = seedV1(f.path);
      if (kind === 'unknown') database.exec('PRAGMA user_version=0');
      if (kind === 'foreign') database.exec('PRAGMA application_id=0');
      if (kind === 'future') database.exec('PRAGMA user_version=99');
      database.close();
    }
    const bytes = readFileSync(f.path), result = f.store.observe(indexTarget, page([item(8)]), 'panel', 20);
    assert.equal(fieldOf(result, 'state'), 'unavailable'); assert.equal(fieldOf(f.store.query({ target: indexTarget }, 21), 'state'), 'unknown');
    assert.deepEqual(readFileSync(f.path), bytes);
  }
});
