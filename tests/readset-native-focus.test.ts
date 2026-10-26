// A scoped plan binds to the composition it names, not to the one After Effects has open:
// a focus change alone must not discard its observation or make plan and approve wait.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { blurOps, blurWorld } from './readset-native-blur-world.ts';
import { worldRig, demand, propose, approve, stampOf, receiptOf } from './readset-native-rig.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

test('opening another composition keeps the scoped observation, makes no read, and plan and approve do not wait', async (t) => {
  const world = blurWorld(), rig = await worldRig(t, world, { sidecar: { panelSnapshotWaitMs: 4000 } });
  const page = await demand(rig, { target: world.target(stampOf(rig, world)) });
  assert.equal(fieldOf(page, 'data.state'), 'observed', JSON.stringify(page));
  const scoped = rig.sidecar.latest, batches = rig.batches().length;
  rig.plugin.change({ activeCompId: '7', activeCompName: 'Another', selection: [], selectedLayers: [] });
  await rig.waitFor(() => rig.sidecar.liveFocus?.activeCompositionId === '7');
  await pause(400);
  assert.equal(rig.sidecar.latest, scoped, 'the scoped observation was not replaced');
  assert.equal(rig.batches().length, batches, 'a focus change alone asks the host for nothing');
  const started = Date.now();
  const planId = await propose(rig, blurOps(20));
  assert.ok(Date.now() - started < 1500, `proposing waited ${Date.now() - started} ms`);
  const approving = Date.now();
  await approve(rig, planId);
  assert.ok(Date.now() - approving < 1500, `approving waited ${Date.now() - approving} ms`);
  assert.equal(fieldOf(receiptOf(rig, planId), 'status'), 'executed', JSON.stringify(receiptOf(rig, planId)));
  assert.equal(rig.entries().filter((entry) => entry === 'aeApplyPlan').length, 1);
});
