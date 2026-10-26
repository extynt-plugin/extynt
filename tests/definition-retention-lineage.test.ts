/** Definition retention preserves desired history without conferring current write authority. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { column, countRows, scalar } from './definition-retention-fixture.ts';
import { databaseImage, definitionHistory, desiredLineage, lineageFixture, lineagePage } from './definition-retention-lineage-fixture.ts';
import type { DesiredLineage, LineageFixture } from './definition-retention-lineage-fixture.ts';

function assertHistory(fixture: LineageFixture, planId: string, expected: DesiredLineage): void {
  assert.deepEqual(desiredLineage(fixture.db, planId), expected);
  assert.deepEqual(definitionHistory(fixture.db), fixture.history);
  assert.deepEqual(fixture.db.prepare('PRAGMA foreign_key_check').all(), []);
  const retained = fixture.store.desiredParameterPlan(planId);
  assert.ok(retained.state === 'present');
  assert.equal(retained.request.sourceObservationId, fixture.control.observationId);
  assert.equal(retained.request.desiredValue, 20);
  assert.equal(retained.request.status, column(expected.request, 'status'));
}

for (const status of ['prepared', 'bound', 'invalidated', 'verified']) {
  test(`repeated native observations preserve ${status} desired lineage and receipt evidence`, (t: TestContext) => {
    const f = lineageFixture(t), planId = `retained-${status}`;
    assert.equal(fieldOf(f.prepare(planId), 'state'), 'prepared');
    if (status === 'bound' || status === 'verified') assert.equal(fieldOf(f.bind(planId), 'state'), 'bound');
    if (status === 'invalidated') assert.equal(fieldOf(f.store.invalidateDesired(planId, 3), 'state'), 'invalidated');
    if (status === 'verified') {
      const verified = f.store.observeVerifiedReadback(f.proof(planId), 3);
      assert.equal(fieldOf(verified, 'ok'), true); assert.equal(fieldOf(verified, 'writeAuthorizing'), false);
    }
    const before = desiredLineage(f.db, planId);
    assert.equal(column(before.request, 'status'), status);
    f.repeat({ revision: status === 'verified' ? 5 : 4 });
    assertHistory(f, planId, before);
    const current = f.firstControl(21);
    assert.equal(current.observedAt, 20); assert.equal(current.current.value, 4);
    assert.equal(current.writeAuthorizing, false);
    assert.equal(fieldOf(f.store.queryRelational({ kind: 'desired-requests' }, 21), 'writeAuthorizing'), false);
    if (status === 'verified') {
      assert.equal(column(before.request, 'receipt_reference'), `native-receipt/${planId}`);
      assert.ok(column(before.request, 'verified_observation_id'));
      assert.equal(column(before.request, 'verified_revision'), 5);
    }
  });
}

test('a bound native proof remains verifiable after more than eight observations of another control', (t: TestContext) => {
  const f = lineageFixture(t), planId = 'delayed-bound-other-control';
  assert.equal(fieldOf(f.prepare(planId), 'state'), 'prepared');
  assert.equal(fieldOf(f.bind(planId), 'state'), 'bound');
  const before = desiredLineage(f.db, planId);
  f.repeat({ layerId: 'layer-2' });
  assertHistory(f, planId, before);
  const source = f.store.resolveParameter({ controlInstanceId: f.control.controlInstanceId,
    observationId: f.control.observationId }, 21);
  assert.equal(fieldOf(source, 'state'), 'observed'); assert.equal(fieldOf(source, 'writeAuthorizing'), false);
  const result = f.store.observeVerifiedReadback(f.proof(planId), 21);
  assert.equal(fieldOf(result, 'ok'), true); assert.equal(fieldOf(result, 'state'), 'observed');
  assert.equal(fieldOf(result, 'writeAuthorizing'), false);
  const after = desiredLineage(f.db, planId);
  assert.equal(column(after.request, 'status'), 'verified');
  assert.equal(column(after.request, 'source_observation_id'), column(before.request, 'source_observation_id'));
  assert.equal(column(after.request, 'verified_observation_id'), fieldOf(result, 'observationId'));
  assert.equal(column(after.request, 'receipt_reference'), `native-receipt/${planId}`);
  assert.deepEqual(after.components, before.components);
  assert.equal(f.firstControl(22).current.value, 20);
  f.repeat({ revision: 5 }, 22, 38);
  assertHistory(f, planId, after);
  assert.equal(f.firstControl(39).current.value, 4);
});

test('retaining definitions cannot authorize an old bound proof after the same control is observed again', (t: TestContext) => {
  const f = lineageFixture(t), planId = 'delayed-bound-replaced-control';
  assert.equal(fieldOf(f.prepare(planId), 'state'), 'prepared');
  assert.equal(fieldOf(f.bind(planId), 'state'), 'bound');
  const before = desiredLineage(f.db, planId);
  f.repeat();
  assertHistory(f, planId, before);
  assert.equal(fieldOf(f.store.resolveParameter({ controlInstanceId: f.control.controlInstanceId,
    observationId: f.control.observationId }, 21), 'state'), 'unknown');
  const result = f.store.observeVerifiedReadback(f.proof(planId), 21);
  assert.equal(fieldOf(result, 'ok'), false); assert.equal(fieldOf(result, 'code'), 'GRAPH_READBACK_BINDING_INVALID');
  assert.equal(fieldOf(result, 'writeAuthorizing'), false);
  const after = desiredLineage(f.db, planId);
  assert.equal(column(after.request, 'status'), 'invalidated');
  assert.equal(column(after.request, 'source_observation_id'), column(before.request, 'source_observation_id'));
  assert.equal(column(after.request, 'receipt_reference'), null); assert.equal(column(after.request, 'verified_observation_id'), null);
  assert.deepEqual(after.components, before.components);
  assert.deepEqual(definitionHistory(f.db), f.history);
  assert.equal(scalar(f.db, 'SELECT value FROM control_observation_components WHERE control_id=?', f.control.controlInstanceId), 4);
  assert.equal(fieldOf(f.store.queryRelational({ kind: 'controls', compositionId: 'comp-1', layerId: 'layer-1' }, 22), 'state'), 'unknown');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

for (const table of ['parameter_definition_facts', 'definition_sources']) {
  test(`a refused ${table} retention DELETE rolls back the entire incoming observation and fails closed`, (t: TestContext) => {
    const f = lineageFixture(t);
    f.repeat({}, 2, 8);
    assert.equal(countRows(f.db, 'parameter_definition_facts'), 8);
    const before = databaseImage(f.db), control = f.firstControl(9);
    f.db.exec(`CREATE TRIGGER refuse_retention BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'retention-delete-refused'); END`);
    const next = lineagePage(9, { revision: 5, value: 99 });
    next.project.name = 'Uncommitted replacement'; next.metadata.layer.index = 2;
    const result = f.store.observe({ kind: 'blur' }, jsonOf(next), 'panel-1', 9);
    assert.equal(fieldOf(result, 'state'), 'degraded'); assert.equal(fieldOf(result, 'code'), 'GRAPH_STORAGE_UNAVAILABLE');
    assert.deepEqual(databaseImage(f.db), before);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(scalar(f.db, 'SELECT observation_id FROM control_observations WHERE control_id=?', control.controlInstanceId), control.observationId);
    const unavailable = f.store.queryRelational({ kind: 'controls', compositionId: 'comp-1', layerId: 'layer-1' }, 10);
    assert.equal(fieldOf(unavailable, 'state'), 'unknown'); assert.equal(fieldOf(unavailable, 'writeAuthorizing'), false);
    assert.deepEqual(fieldOf(unavailable, 'rows'), []);
  });
}
