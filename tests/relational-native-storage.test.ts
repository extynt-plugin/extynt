// Real SQLite write contention while an agent prepares a typed proposal, on the native lane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fieldOf, numberAt } from '../apps/panel/dist/tests/json-narrow.js';
import { blurObservation, controlPage, relationalRig, sqlNumber, storagePath } from './relational-native-agent.ts';

test('real SQLite write contention rolls back the unapproved typed proposal, reports degraded storage, keeps the unaffected observation retained, and lets a later write proceed', async t => {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const request = { controlInstanceId: control.controlInstanceId, observationId: control.observationId, value: { kind: 'number', value: 8 } };
  const database = new DatabaseSync(storagePath(rig));
  try {
    database.exec('BEGIN IMMEDIATE');
    const refused = await rig.tool('ae_prepare_parameter_change', request);
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(fieldOf(refused.body, 'error', 'code'), 'PARAMETER_DESIRED_STORAGE_UNAVAILABLE');
    database.exec('ROLLBACK');
    assert.equal(rig.sidecar.plans.size, 0, 'no approvable draft survives a failed desired transaction');
    assert.equal(sqlNumber(database, 'SELECT count(*) AS count FROM desired_control_requests', 'count'), 0);
    assert.equal(sqlNumber(database, 'SELECT value FROM control_observation_components WHERE control_id=?', 'value', numberAt(control, 'controlInstanceId')), 4);
    const current = await controlPage(rig);
    assert.equal(fieldOf(current, 'state'), 'retained');
    assert.equal(fieldOf(current, 'storage', 'state'), 'degraded');
    assert.equal(fieldOf(current, 'writeAuthorizing'), false);
    assert.equal(rig.sidecar.agentMailbox.length, 0, 'nothing was queued for the plugin');
    assert.equal(rig.calls.filter(call => call.entry === 'aeApplyPlan').length, 0);
    assert.equal(rig.host.counters.setters, 0);
    const retried = await rig.tool('ae_prepare_parameter_change', request);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(rig.sidecar.plans.size, 1);
    assert.equal(fieldOf(rig.sidecar.collection.storageStatus(), 'state'), 'ready');
  } finally { database.close(); }
});
