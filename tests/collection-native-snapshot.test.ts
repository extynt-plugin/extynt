// A scoped collection snapshot is the current observation scoped plans and parameter changes bind to,
// and the whole-project read it displaces is kept beside it.
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { blurWorld } from './readset-native-blur-world.ts';
import { demand, stampOf, worldRig } from './readset-native-rig.ts';

test('a collection snapshot becomes the current observation beside the whole-project read, which is kept with its provenance', async (t) => {
  const world = blurWorld(), rig = await worldRig(t, world);
  const whole = rig.sidecar.latest;
  assert.equal(fieldOf(whole, 'snapshot.result.coverage'), undefined, 'the pairing read is a whole-project read');
  const page = await demand(rig, { target: world.target(stampOf(rig, world)) });
  assert.equal(fieldOf(page, 'data.state'), 'observed', JSON.stringify(page));
  const current = rig.sidecar.latest;
  assert.equal(typeof fieldOf(current, 'snapshot.result.coverage.collectionSessionId'), 'string', 'the scoped snapshot is current, so scoped plans and approvals bind to it');
  assert.equal(current?.fullBase, whole, 'the whole-project read is not dropped');
});

test('a scoped read folds into the kept whole-project read instead of being refused for a scoped base', async (t) => {
  const world = blurWorld(), rig = await worldRig(t, world);
  const whole = rig.sidecar.latest;
  await demand(rig, { target: world.target(stampOf(rig, world)) });
  if (whole === undefined) throw new Error('the pairing read is missing');
  const read = { ...whole.snapshot, requestId: 'scoped-after-collection', result: { ...whole.snapshot.result, readScope: { compositions: 'listed', items: 'skipped' } } };
  const answer = await rig.sidecar.receivers.acceptSnapshot(jsonOf(read), { bytes: 1 });
  assert.equal(answer.status, 201, JSON.stringify(answer.body));
  assert.equal(fieldOf(rig.sidecar.latest, 'snapshot.result.coverage'), undefined, 'the merged read is a whole-project one again');
});
