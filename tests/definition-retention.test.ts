/** Tests that repeated observations and censuses keep bounded definition rows and drop only superseded ones. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { SQLInputValue } from 'node:sqlite';
import type { DefinitionProvenance, EffectDefinitionBundle, ParameterDefinitionFacts } from '../packages/project-graph/dist/src/effect-definitions.js';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { censusWith } from './catalogue-support.ts';
import { GAUSSIAN_BLUR, blurPage, censusFixture, column, countRows, oneRow, retentionFixture, scalar } from './definition-retention-fixture.ts';
import { writeEffectDefinitions } from '../apps/sidecar/dist/src/effect-definition-write.js';
import { DEFINITION_RETENTION_FACT_QUERY, DEFINITION_RETENTION_SOURCE_QUERY } from '../apps/sidecar/dist/src/definition-retention.js';

test('repeated blur-only observations retain bounded native metadata without any core nodes', (t: TestContext) => {
  const f = retentionFixture(t);
  for (let at = 1; at <= 80; at++) assert.equal(fieldOf(f.observe(at), 'state'), 'ready');
  const db = f.database();
  assert.equal(countRows(db, 'nodes'), 0);
  assert.ok(countRows(db, 'parameter_definition_facts') <= 8);
  assert.ok(countRows(db, 'definition_sources') <= 9);
  const control = f.firstControl(81);
  assert.equal(control.state, 'observed'); assert.equal(control.current.value, 4);
  assert.equal(control.writeAuthorizing, false);
  assert.equal(control.coverage.absentOutsidePage, 'unknown');
});

test('repeated census retains current effect inventory and removes only superseded orphan sources', (t: TestContext) => {
  const f = retentionFixture(t);
  for (let at = 1; at <= 80; at++) {
    const census = censusWith(censusFixture(), { runtime: { buildNumber: String(at) } });
    assert.equal(fieldOf(f.store.observeCensus(census, at), 'state'), 'ready');
  }
  const db = f.database();
  assert.equal(countRows(db, 'definition_sources'), 1);
  assert.equal(countRows(db, 'effect_definitions'), 1);
  assert.equal(scalar(db, 'SELECT observed_at FROM definition_sources'), 80);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('a census larger than a property page budget does not leave accumulating orphan sources', (t: TestContext) => {
  const f = retentionFixture(t);
  const census = censusWith(censusFixture(), { installedEffects: Array.from({ length: 80 }, (_, index) => ({
    matchName: `SYN Effect ${index}`, displayName: `Synthetic ${index}`, category: 'Synthetic', version: 'fixture-1', available: true,
  })) });
  for (let at = 1; at <= 3; at++) {
    assert.equal(fieldOf(f.store.observeCensus(census, at), 'state'), 'ready');
    const db = f.database();
    assert.equal(countRows(db, 'definition_sources'), 80);
    assert.equal(countRows(db, 'effect_definitions'), 80);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  }
});

test('shared parameter definitions retain recent metadata for each native instance', (t: TestContext) => {
  const f = retentionFixture(t);
  for (let at = 1; at <= 80; at++) {
    assert.equal(fieldOf(f.observe(at, 'layer-1'), 'state'), 'ready');
    assert.equal(fieldOf(f.observe(at, 'layer-2'), 'state'), 'ready');
  }
  const db = f.database();
  const groups = db.prepare(`SELECT s.instance_binding,count(*) AS n,max(s.observed_at) AS newest
    FROM parameter_definition_facts f JOIN definition_sources s ON s.id=f.provenance_id GROUP BY s.instance_binding`).all();
  assert.equal(groups.length, 2);
  for (const group of groups) { assert.equal(column(group, 'n'), 8); assert.equal(column(group, 'newest'), 80); }
  assert.equal(countRows(db, 'parameter_definitions'), 1);
  for (const layer of ['layer-1', 'layer-2']) {
    assert.equal(f.firstControl(81, layer).current.value, 4);
    assert.equal(f.firstControl(81, layer).writeAuthorizing, false);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

const SOURCE_KINDS = ['official-documentation', 'authored-documentation', 'native-observation'] as const;

function documentedBundle(parameter: string, hostKey: string): EffectDefinitionBundle {
  const sources = SOURCE_KINDS.map((kind, index): DefinitionProvenance => ({
    id: `protected-${index}`, kind, title: 'Synthetic provenance', hostKey,
    sourceUrl: kind === 'native-observation' ? null : 'https://example.invalid/fixture',
    observedAt: kind === 'native-observation' ? 1 : null,
    observationContext: kind === 'native-observation' ? 'factory-default' : null,
    instanceBinding: kind === 'native-observation' ? 'controlled-factory-fixture' : null,
  }));
  const facts = sources.map((source): ParameterDefinitionFacts => ({ parameterDefinitionId: parameter, provenanceId: source.id,
    valueType: 'OneD', units: null, minimum: 0, maximum: 500, defaultValue: { state: 'known', value: 0 },
    description: source.kind === 'native-observation' ? null : 'Documented synthetic control',
    meaning: null, canVaryOverTime: null, canSetExpression: null }));
  return { sources, facts, plugins: [], effects: [], parameters: [] };
}

test('official, authored, factory defaults and referenced native provenance survive retention', (t: TestContext) => {
  const f = retentionFixture(t); f.observe(1);
  const db = f.database(), fact = oneRow(db, 'SELECT * FROM parameter_definition_facts');
  const provenance = column(fact, 'provenance_id'), host = scalar(db, 'SELECT host_key FROM definition_sources WHERE id=?', provenance);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  writeEffectDefinitions(db, documentedBundle(String(column(fact, 'parameter_definition_id')), String(host)));
  db.prepare('INSERT INTO plugin_definitions VALUES(?,?,?,?,?,?)').run('protected-plugin', 'synthetic', 'Synthetic plugin', null, null, provenance);
  db.exec('COMMIT');
  for (let at = 2; at <= 80; at++) assert.equal(fieldOf(f.observe(at), 'state'), 'ready');
  const protectedFacts = db.prepare("SELECT provenance_id,default_state FROM parameter_definition_facts WHERE provenance_id LIKE 'protected-%' ORDER BY provenance_id").all();
  assert.equal(protectedFacts.length, 3);
  assert.ok(protectedFacts.every(row => column(row, 'default_state') === 'known'));
  assert.equal(countRows(db, 'parameter_default_components'), 3);
  assert.ok(db.prepare('SELECT 1 FROM parameter_definition_facts WHERE provenance_id=?').get(provenance));
  assert.ok(db.prepare('SELECT 1 FROM definition_sources WHERE id=?').get(provenance));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('equal or backward collection times do not establish supersession', (t: TestContext) => {
  const f = retentionFixture(t);
  for (let index = 0; index < 20; index++) {
    const at = index < 15 ? 100 : 50, page = blurPage(at);
    page.sessionId = `distinct-clock-${index}`;
    assert.equal(fieldOf(f.store.observe({ kind: 'blur' }, jsonOf(page), 'panel-1', at), 'state'), 'ready');
  }
  const db = f.database();
  assert.equal(countRows(db, 'parameter_definition_facts'), 20);
  const counts = db.prepare('SELECT observed_at,count(*) AS n FROM definition_sources GROUP BY observed_at ORDER BY observed_at').all();
  assert.deepEqual(counts.map(row => [column(row, 'observed_at'), column(row, 'n')]), [[50, 10], [100, 30]]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('inventory retention preserves other versions, hosts and backward-clock provenance', (t: TestContext) => {
  const f = retentionFixture(t), census = censusFixture();
  assert.equal(fieldOf(f.store.observeCensus(census, 100), 'state'), 'ready');
  const db = f.database(), original = scalar(db, 'SELECT id FROM definition_sources');
  const otherBuild = censusWith(census, { runtime: { buildNumber: '7' } });
  assert.equal(fieldOf(f.store.observeCensus(otherBuild, 50), 'state'), 'ready');
  assert.ok(db.prepare('SELECT 1 FROM definition_sources WHERE id=?').get(original));
  const otherEffects = censusWith(otherBuild, { installedEffects: [{ ...GAUSSIAN_BLUR, version: 'fixture-2' }] });
  assert.equal(fieldOf(f.store.observeCensus(otherEffects, 101), 'state'), 'ready');
  const otherVersion = censusWith(otherEffects, { runtime: { appVersion: '26.3' } });
  assert.equal(fieldOf(f.store.observeCensus(otherVersion, 102), 'state'), 'ready');
  assert.equal(countRows(db, 'effect_definitions'), 3);
  assert.equal(countRows(db, 'definition_sources'), 4);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('retention queries search native instance age and indexed provenance without global scans', (t: TestContext) => {
  const f = retentionFixture(t); f.observe(1);
  const db = f.database(), source = oneRow(db, 'SELECT * FROM definition_sources WHERE instance_binding IS NOT NULL');
  const parameter = scalar(db, 'SELECT id FROM parameter_definitions');
  const scope = [column(source, 'host_key'), column(source, 'instance_binding'), 2];
  const queries: ReadonlyArray<readonly [string, SQLInputValue[]]> = [[DEFINITION_RETENTION_FACT_QUERY, [...scope, parameter, 64]],
    [DEFINITION_RETENTION_SOURCE_QUERY, [...scope, 64]]];
  for (const [sql, values] of queries) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => String(column(row, 'detail')));
    assert.ok(plan.some(detail => detail.includes('SEARCH s USING INDEX definition_sources_native_age') || detail.includes('SEARCH s USING COVERING INDEX definition_sources_native_age')), plan.join('\n'));
    assert.ok(plan.every(detail => !detail.startsWith('SCAN ')), plan.join('\n'));
    assert.ok(plan.every(detail => !detail.includes('TEMP B-TREE')), plan.join('\n'));
    assert.ok(plan.some(detail => detail.includes('plugin_definition_source')), plan.join('\n'));
    assert.ok(plan.some(detail => detail.includes('effect_definition_source')), plan.join('\n'));
    assert.ok(plan.some(detail => detail.includes('parameter_definition_source')), plan.join('\n'));
  }
});
