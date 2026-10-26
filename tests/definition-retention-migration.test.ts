/** Tests that index additions to an existing graph store are additive, atomic and leave unknown stores alone. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openGraphFile } from '../apps/sidecar/dist/src/graph-file.js';
import { GRAPH_RETENTION_INDEX_CHECK } from '../apps/sidecar/dist/src/graph-retention-indexes.js';
import { column, retentionFixture, scalar } from './definition-retention-fixture.ts';
import type { DatabaseRow } from './definition-retention-fixture.ts';

const indexes = ['definition_sources_native_age', 'parameter_fact_source', 'plugin_definition_source', 'effect_definition_source', 'parameter_definition_source'];
function facts(db: DatabaseSync): Record<string, DatabaseRow[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return Object.fromEntries(tables.map(row => { const name = String(column(row, 'name')); return [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]; }));
}

test('an existing schema3 receives only additive indexes and retains every typed row', (t: TestContext) => {
  const f = retentionFixture(t); f.observe(1); f.store.close();
  const db = f.database(); indexes.forEach(name => db.exec(`DROP INDEX ${name}`));
  const before = facts(db), migrated = openGraphFile(f.path);
  try {
    assert.equal(scalar(migrated, 'PRAGMA user_version'), 3);
    assert.equal(scalar(migrated, GRAPH_RETENTION_INDEX_CHECK), 5);
    assert.deepEqual(facts(migrated), before);
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { migrated.close(); }
});

test('a failed additive index migration rolls back earlier indexes and preserves schema3 data', (t: TestContext) => {
  const f = retentionFixture(t); f.observe(1); f.store.close();
  const db = f.database(); indexes.forEach(name => db.exec(`DROP INDEX ${name}`));
  db.exec('CREATE TABLE parameter_fact_source(value TEXT) STRICT');
  db.prepare('INSERT INTO parameter_fact_source VALUES(?)').run('Preserve existing data');
  const before = facts(db);
  assert.throws(() => openGraphFile(f.path), /parameter_fact_source/);
  assert.equal(scalar(db, GRAPH_RETENTION_INDEX_CHECK), 0);
  assert.equal(scalar(db, 'PRAGMA user_version'), 3);
  assert.deepEqual(facts(db), before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('unknown application identity remains untouched instead of receiving retention indexes', (t: TestContext) => {
  const f = retentionFixture(t); f.observe(1); f.store.close();
  const db = f.database(); indexes.forEach(name => db.exec(`DROP INDEX ${name}`));
  db.exec('PRAGMA application_id=12345');
  const before = facts(db);
  assert.throws(() => openGraphFile(f.path), /GRAPH_SCHEMA_UNSUPPORTED/);
  const inspection = new DatabaseSync(f.path, { readOnly: true });
  try {
    assert.equal(scalar(inspection, 'PRAGMA application_id'), 12345);
    assert.equal(scalar(inspection, GRAPH_RETENTION_INDEX_CHECK), 0);
    assert.deepEqual(facts(inspection), before);
  } finally { inspection.close(); }
});
