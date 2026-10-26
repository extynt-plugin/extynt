// Repeated native control matchNames keep distinct exact identities through a demanded value page, on the native lane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldOf, recordsAt, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import { agentPage, controlPage, relationalRig } from './relational-native-agent.ts';

test('repeated native control matchNames retain distinct exact descriptor identities through a demanded value page', async t => {
  const rig = await relationalRig(t);
  const first = await agentPage(rig, { target: rig.host.target('properties'), limit: 25 });
  const last = await agentPage(rig, { jobId: first.jobId, limit: 25 });
  assert.equal(fieldOf(last.native, 'nextCursor'), null);
  assert.equal(rig.host.counters.values, 0);
  const [firstBefore, secondBefore, ...extraBefore] = recordsAt(await controlPage(rig, { controlMatchName: 'SYN Repeated', limit: 2 }), 'rows');
  assert.ok(firstBefore && secondBefore);
  assert.equal(extraBefore.length, 0);
  assert.notEqual(firstBefore.controlInstanceId, secondBefore.controlInstanceId);
  assert.deepEqual([firstBefore, secondBefore].map(row => row.nativePropertyIndices), [[3, 2, 31], [3, 2, 32]]);
  assert.notEqual(fieldOf(firstBefore, 'address', 'propertyPath'), fieldOf(secondBefore, 'address', 'propertyPath'));
  assert.ok(textAt(secondBefore, 'address', 'propertyPath').endsWith('SYN Repeated#2'));
  const value = await agentPage(rig, { target: { ...rig.host.target('values'), propertyIndices: [3, 2, 32], expectedStamp: rig.host.stamp() }, limit: 1 });
  assert.equal(value.completed.status, 200, JSON.stringify(value.completed.body));
  assert.equal(fieldOf(value.native, 'rows', 0, 'value'), 22);
  const after = recordsAt(await controlPage(rig, { controlMatchName: 'SYN Repeated', limit: 2 }), 'rows');
  assert.equal(after.length, 2, 'the value page must enrich the second descriptor rather than invent a third identity');
  const [firstAfter, secondAfter] = after;
  assert.ok(firstAfter && secondAfter);
  assert.equal(firstAfter.controlInstanceId, firstBefore.controlInstanceId);
  assert.equal(firstAfter.observationId, firstBefore.observationId);
  assert.equal(fieldOf(firstAfter, 'current', 'value'), null);
  assert.equal(secondAfter.controlInstanceId, secondBefore.controlInstanceId);
  assert.equal(secondAfter.parameterDefinitionId, secondBefore.parameterDefinitionId);
  assert.equal(fieldOf(secondAfter, 'current', 'value'), 22);
  assert.equal(secondAfter.sourceKind, 'value-page');
  assert.notEqual(secondAfter.observationId, secondBefore.observationId);
  assert.equal(rig.host.counters.values, 1);
});
