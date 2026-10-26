// A manual native edit between preparing a typed change and its apply is refused, by the sidecar before queueing and by the plugin inside the apply call.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldOf, listAt } from '../apps/panel/dist/tests/json-narrow.js';
import { agentPage, appliedPlan, approveParameter, blurObservation, controlPage, firstControl, parameterProposal, relationalRig } from './relational-native-agent.ts';

const BLURRINESS = { controlMatchName: 'ADBE Gaussian Blur 2-0001' };

test('fresh native manual edit between typed preparation and approval refuses the old plan without a setter', async t => {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const proposal = await parameterProposal(rig, control);
  rig.host.edit(7);
  const refreshed = await agentPage(rig, { target: { ...rig.host.target('blur'), expectedStamp: rig.host.stamp() }, limit: 1 });
  assert.equal(refreshed.completed.status, 200);
  const refused = await rig.tool('ae_approve_plan', { planId: proposal.planId, acknowledgeUnverified: true });
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  assert.equal(fieldOf(refused.body, 'error', 'code'), 'STALE_SNAPSHOT');
  assert.equal(rig.host.counters.setters, 1, 'the only setter was the simulated manual edit');
  const current = await controlPage(rig, BLURRINESS);
  assert.equal(fieldOf(firstControl(current), 'current', 'value'), 7);
  assert.equal(rig.sidecar.agentMailbox.length, 0, 'nothing was queued for the lane');
  assert.equal(rig.calls.filter(call => call.entry === 'aeApplyPlan').length, 0, 'the plugin never saw the old plan');
});

test('manual edit after approval and apply admission is refused inside the actual same native apply call', async t => {
  const rig = await relationalRig(t);
  const { control } = await blurObservation(rig);
  const proposal = await parameterProposal(rig, control);
  rig.beforeNative = async name => {
    if (name !== 'aeApplyPlan') return;
    rig.beforeNative = undefined;
    rig.host.edit(7);
  };
  await approveParameter(rig, proposal);
  await appliedPlan(rig, proposal.planId);
  const apply = rig.calls.find(call => call.entry === 'aeApplyPlan');
  assert.equal(fieldOf(apply?.result, 'ok'), false);
  assert.equal(fieldOf(apply?.result, 'error', 'code'), 'STALE_READ_SET');
  assert.equal(fieldOf(apply?.result, 'mayHaveMutated'), false);
  assert.equal(rig.host.counters.setters, 1);
  assert.deepEqual(rig.host.calls.begin, [], 'the guard must run before opening a native undo group');
  const current = await controlPage(rig, BLURRINESS);
  assert.deepEqual(listAt(current, 'rows'), []);
  assert.equal(fieldOf(current, 'state'), 'unknown');
  assert.equal(rig.sidecar.inFlight, undefined);
  assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, 'a refused write that provably did not run blocks nothing');
});
