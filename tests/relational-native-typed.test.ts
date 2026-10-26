// Typed relational control pages, the scripted agent's parameter proposal, and the typed parameter API's refusals, on the native lane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fieldOf, listAt } from '../apps/panel/dist/tests/json-narrow.js';
import { agentPage, blurObservation, controlPage, desiredEvidence, firstControl, parameterProposal, relationalRig, sqlNumber, storagePath } from './relational-native-agent.ts';
import { scriptedParameterProposal } from './relational-native-scripted.ts';

test('bounded typed SQL control/definition pages preserve provenance and unknown semantics for multiple native controls', async t => {
  const rig = await relationalRig(t);
  const first = await agentPage(rig, { target: rig.host.target('properties'), limit: 25 });
  assert.equal(first.completed.status, 200, JSON.stringify(first.completed.body));
  const second = await agentPage(rig, { jobId: first.jobId, limit: 25 });
  assert.equal(fieldOf(second.native, 'nextCursor'), null);
  const page = await controlPage(rig, { limit: 2 });
  assert.equal(listAt(page, 'rows').length, 2);
  assert.ok(page.nextCursor);
  const continued = await controlPage(rig, { limit: 2, cursor: page.nextCursor });
  assert.equal(listAt(continued, 'rows').length, 2);
  assert.notEqual(fieldOf(continued, 'rows', 0, 'controlInstanceId'), fieldOf(page, 'rows', 0, 'controlInstanceId'));
  assert.equal(rig.host.counters.values, 0);
  const control = firstControl(page);
  assert.equal(fieldOf(control, 'current', 'value'), null);
  assert.equal(fieldOf(control, 'current', 'units'), null);
  const described = await rig.tool('ae_describe_control', { parameterDefinitionId: control.parameterDefinitionId });
  assert.equal(described.status, 200, JSON.stringify(described.body));
  assert.ok(listAt(described.body, 'data', 'rows').length > 0);
  const source = fieldOf(described.body, 'data', 'rows', 0);
  assert.equal(fieldOf(source, 'provenance', 'kind'), 'native-observation');
  assert.equal(fieldOf(source, 'provenance', 'observationContext'), 'property-metadata');
  assert.ok(fieldOf(source, 'provenance', 'instanceBinding'));
  assert.equal(fieldOf(source, 'facts', 'description'), null);
  assert.equal(fieldOf(source, 'facts', 'meaning'), null);
  assert.deepEqual(fieldOf(source, 'facts', 'defaultValue'), { state: 'unknown' });
  const nativeUnits = await controlPage(rig, { controlMatchName: 'SYN Control 1' });
  assert.equal(fieldOf(nativeUnits, 'rows', 0, 'current', 'units'), 'native-fixture-units');
  const expressed = await controlPage(rig, { controlMatchName: 'SYN Control 2' });
  assert.equal(fieldOf(expressed, 'rows', 0, 'current', 'expressionEnabled'), true);
  assert.equal(fieldOf(expressed, 'rows', 0, 'current', 'expressionPresent'), true);
  assert.equal(fieldOf(expressed, 'rows', 0, 'current', 'keyframeCount'), 0);
  const keyed = await controlPage(rig, { controlMatchName: 'SYN Control 3' });
  assert.equal(fieldOf(keyed, 'rows', 0, 'current', 'keyframeCount'), 2);
  assert.equal(fieldOf(keyed, 'rows', 0, 'current', 'expressionEnabled'), false);
});

test('scripted real agent queries exact SQL state and prepares a typed desired request without reporting AE mutation', async t => {
  const rig = await relationalRig(t);
  const observed = await blurObservation(rig);
  const { result, proposal, provider, toolReplies } = await scriptedParameterProposal(rig);
  assert.equal(result.failure, undefined, JSON.stringify(result));
  assert.deepEqual(result.tools.map(tool => [tool.name, tool.ok]), [['ae_query_relational_graph', true], ['ae_prepare_parameter_change', true]]);
  assert.equal(provider.calls, 3);
  assert.ok(proposal.planId);
  assert.equal(rig.host.counters.setters, 0);
  assert.equal(rig.calls.filter(call => call.entry === 'aeApplyPlan').length, 0, 'preparing a request never reaches the plugin');
  const current = await controlPage(rig, { controlMatchName: 'ADBE Gaussian Blur 2-0001' });
  assert.equal(fieldOf(current, 'rows', 0, 'current', 'value'), 4);
  assert.equal(fieldOf(current, 'rows', 0, 'observationId'), observed.control.observationId);
  const database = new DatabaseSync(storagePath(rig), { readOnly: true });
  t.after(() => database.close());
  const desired = desiredEvidence(rig, proposal.planId);
  assert.equal(desired.status, 'prepared');
  assert.equal(desired.source_observation_id, observed.control.observationId);
  assert.equal(sqlNumber(database, 'SELECT value FROM desired_control_components WHERE plan_id=?', 'value', proposal.planId), 8);
  assert.equal(toolReplies.length, 2);
});

test('typed parameter API refuses unknown conversion, range violation and unsupported native controls before authoring', async t => {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const base = { controlInstanceId: control.controlInstanceId, observationId: control.observationId };
  for (const [value, code] of [[{ kind: 'number', value: 8, unit: 'pixels' }, 'PARAMETER_UNIT_CONVERSION_UNSUPPORTED'], [{ kind: 'number', value: 1001 }, 'PARAMETER_VALUE_RANGE']]) {
    const refused = await rig.tool('ae_prepare_parameter_change', { ...base, value });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(fieldOf(refused.body, 'error', 'code'), code);
  }
  const malformed = await rig.tool('ae_query_relational_graph', { query: { kind: 'controls', compositionId: rig.host.comp.id, layerId: rig.host.title.id, sql: 'SELECT * FROM nodes' } });
  assert.equal(malformed.status, 422);
  assert.equal(fieldOf(malformed.body, 'error', 'code'), 'INVALID_RELATIONAL_ARGUMENT');
  assert.equal(rig.sidecar.plans.size, 0);
  const proposal = await parameterProposal(rig, control);
  assert.ok(proposal.planId);
  const descriptors = await agentPage(rig, { target: rig.host.target('properties'), limit: 25 });
  assert.equal(descriptors.completed.status, 200);
  const unsupported = firstControl(await controlPage(rig, { controlMatchName: 'SYN Control 1' }));
  const refused = await rig.tool('ae_prepare_parameter_change', { controlInstanceId: unsupported.controlInstanceId, observationId: unsupported.observationId, value: { kind: 'number', value: 8 } });
  assert.equal(refused.status, 422);
  assert.equal(fieldOf(refused.body, 'error', 'code'), 'PARAMETER_WRITE_UNSUPPORTED');
  assert.equal(rig.host.counters.setters, 0);
});
