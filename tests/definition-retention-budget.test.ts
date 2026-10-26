/** Tests that a native page shares one deletion budget across its whole transaction. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { blurPage, column, countRows, retentionFixture } from './definition-retention-fixture.ts';

function descriptor(index: number): JsonObject {
  const matchName = `Synthetic control ${index}`, path = `ADBE Effect Parade/Synthetic effect/${matchName}`;
  return { id: path, path, name: matchName, matchName, children: 0, valueType: 'OneD', propertyType: 'PROPERTY',
    propertyIndices: [1, 1, index], minimum: 0, maximum: 100, canVaryOverTime: false, canSetExpression: false,
    effectContext: { effectIndex: 1, effectMatchName: 'Synthetic effect', effectName: 'Synthetic effect', effectEnabled: true,
      propertyIndices: [1, 1], relativeIndices: [index], relativeMatchNames: [matchName] } };
}
function seedBacklog(db: DatabaseSync): void {
  const facts = db.prepare('SELECT * FROM parameter_definition_facts').all();
  const source = db.prepare(`INSERT INTO definition_sources SELECT ?,kind,source_url,title,host_key,?,instance_binding,observation_context FROM definition_sources WHERE id=?`);
  const fact = db.prepare(`INSERT INTO parameter_definition_facts SELECT parameter_definition_id,?,value_type,units,minimum,maximum,
    default_state,default_shape,documentation,meaning,can_vary,can_expression FROM parameter_definition_facts WHERE parameter_definition_id=? AND provenance_id=?`);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  for (const row of facts) {
    for (let at = 2; at <= 21; at++) {
      const provenance = column(row, 'provenance_id'), id = `${provenance}-backlog-${at}`;
      source.run(id, at, provenance); fact.run(id, column(row, 'parameter_definition_id'), provenance);
    }
  }
  db.exec('COMMIT');
}
function effectRoot(): JsonObject {
  const path = 'ADBE Effect Parade/Synthetic effect';
  return { id: path, path, name: 'Synthetic effect', matchName: 'Synthetic effect', children: 24,
    valueType: 'NO_VALUE', propertyType: 'INDEXED_GROUP', propertyIndices: [1, 1],
    effectContext: { effectIndex: 1, effectMatchName: 'Synthetic effect', effectName: 'Synthetic effect', effectEnabled: true,
      propertyIndices: [1, 1], relativeIndices: [], relativeMatchNames: [] } };
}
test('a full 25-row native page shares the deletion budget across its entire transaction', (t: TestContext) => {
  const f = retentionFixture(t), target = { kind: 'properties', compositionId: 'comp-1', layerId: 'layer-1', itemIndex: 1, layerIndex: 1 };
  const page = blurPage(1); page.rows = [effectRoot(), ...Array.from({ length: 24 }, (_, index) => descriptor(index + 1))];
  assert.equal(fieldOf(f.store.observe(target, jsonOf(page), 'panel-1', 1), 'state'), 'ready');
  const db = f.database(); assert.equal(countRows(db, 'parameter_definition_facts'), 24);
  seedBacklog(db);
  const before = { facts: countRows(db, 'parameter_definition_facts'), sources: countRows(db, 'definition_sources') };
  page.sessionId = 'budget-refresh';
  assert.equal(fieldOf(f.store.observe(target, jsonOf(page), 'panel-1', 30), 'state'), 'ready');
  assert.equal(before.facts + 24 - countRows(db, 'parameter_definition_facts'), 64);
  assert.ok(before.sources + 25 - countRows(db, 'definition_sources') <= 64);
  assert.equal(countRows(db, 'parameter_definitions'), 24);
  assert.equal(countRows(db, 'control_observations'), 24);
  assert.ok(db.prepare('SELECT observed_at FROM control_observations').all().every(row => column(row, 'observed_at') === 30));
  assert.equal(fieldOf(f.store.queryRelational({ kind: 'controls', compositionId: 'comp-1', layerId: 'layer-1' }, 31), 'writeAuthorizing'), false);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
