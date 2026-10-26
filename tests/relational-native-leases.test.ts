// The ticket-bound read lease of a collection page: a plugin call that times out, and a cancel while the page is in the plugin.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldOf, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import { NativeBridgeLease } from '../apps/sidecar/dist/src/native-bridge-lease.js';
import { agentPage, relationalRig } from './relational-native-agent.ts';
import { until } from './relational-native-rig.ts';
import type { Rig } from './relational-native-rig.ts';

interface Hold {
  entered: boolean;
  release: () => void;
}

function holdNextCall(rig: Rig): Hold {
  const hold: Hold = { entered: false, release: () => undefined };
  const held = new Promise<void>(resolve => { hold.release = resolve; });
  rig.beforeNative = async () => {
    rig.beforeNative = undefined;
    hold.entered = true;
    await held;
  };
  return hold;
}

test('native read timeout frees the lane and blocks nothing; the next read replaces the orphaned lease and a late plugin answer cannot restore cancelled evidence', async t => {
  const rig = await relationalRig(t);
  rig.callTimeoutMs = 150;
  const target = { ...rig.host.target('values'), propertyIndices: [3, 1, 1], expectedStamp: rig.host.stamp() };
  await agentPage(rig, { target, limit: 1 });
  const hold = holdNextCall(rig);
  const timeout = await agentPage(rig, { target, limit: 1 });
  assert.equal(hold.entered, true);
  assert.equal(fieldOf(timeout.observed, 'error', 'code'), 'HOST_TIMEOUT');
  assert.equal(timeout.completed.status, 409);
  assert.equal(fieldOf(timeout.completed.body, 'error', 'code'), 'HOST_TIMEOUT');
  assert.equal(new NativeBridgeLease(rig.directory).accessQuarantine(), null, 'a read cannot change the project, so its orphaned lease blocks nothing');
  assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
  assert.equal(rig.sidecar.inFlight, undefined);
  assert.equal(rig.sidecar.panel.busy, false);
  const orphan = rig.leases.at(-1);
  assert.ok(orphan);
  const cached = await rig.tool('ae_query_graph_cache', { target, limit: 1 });
  assert.equal(fieldOf(cached.body, 'data', 'state'), 'unknown');
  assert.deepEqual(fieldOf(cached.body, 'data', 'rows'), []);
  const answered = rig.calls.length;
  hold.release();
  await until(() => rig.calls.length === answered + 1);
  const late = await rig.tool('ae_query_graph_cache', { target, limit: 1 });
  assert.equal(fieldOf(late.body, 'data', 'state'), 'unknown', 'the plugin answering late restores nothing');
  assert.deepEqual(fieldOf(late.body, 'data', 'rows'), []);
  const fresh = await agentPage(rig, { target, limit: 1 });
  assert.equal(fresh.completed.status, 200);
  assert.equal(fieldOf(fresh.native, 'rows', 0, 'value'), 4);
  assert.notEqual(fieldOf(rig.leases.at(-1), 'leaseId'), fieldOf(orphan, 'leaseId'), 'the fresh read replaced the orphaned lease');
  const forged = await rig.collectionReceivers?.nativeBridge('settle', { lease: orphan, outcome: 'callback-received' });
  assert.equal(forged?.status, 409, 'the replaced read lease can no longer settle');
  assert.equal(rig.sidecar.inFlight, undefined);
  assert.equal(new NativeBridgeLease(rig.directory).accessQuarantine(), null);
  const after = await rig.tool('ae_query_graph_cache', { target, limit: 1 });
  assert.equal(fieldOf(after.body, 'data', 'rows', 0, 'freshness'), 'observed', 'a settle by the orphaned lease did not disturb the fresh evidence');
});

test('cancel during an admitted collection keeps the ticket busy until the plugin answers and cannot accept its stale page, without blocking native access', async t => {
  const rig = await relationalRig(t);
  const hold = holdNextCall(rig);
  const target = rig.host.target('properties');
  const demand = await rig.tool('ae_read_graph_page', { target, limit: 2 });
  const ticket = textAt(demand.body, 'data', 'demandId');
  await until(() => hold.entered);
  const cancelled = await rig.collectionReceivers?.collection('cancel', { ticket });
  assert.equal(cancelled?.status, 200);
  assert.equal(rig.sidecar.panel.busy, true, 'the lane stays busy until the plugin answers');
  assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null, 'the admitted lease is a read');
  const refused = await rig.tool('ae_read_graph_page', { target });
  assert.equal(fieldOf(refused.body, 'ok'), false);
  assert.equal(fieldOf(refused.body, 'error', 'code'), 'COLLECTION_BUSY');
  hold.release();
  await until(() => rig.completions.some(entry => entry.ticket === ticket));
  await rig.quiet();
  const late = rig.completions.find(entry => entry.ticket === ticket);
  assert.equal(late?.status, 409);
  assert.equal(fieldOf(late?.body, 'error', 'code'), 'STALE_COLLECTION_TICKET');
  assert.equal(fieldOf(rig.calls.find(call => call.args.requestId === ticket)?.result, 'ok'), true, 'the plugin did answer the cancelled page');
  assert.equal(rig.sidecar.inFlight, undefined);
  assert.equal(rig.sidecar.panel.busy, false);
  const cached = await rig.tool('ae_query_graph_cache', { target, limit: 2 });
  assert.equal(fieldOf(cached.body, 'data', 'state'), 'unknown');
  assert.equal(fieldOf(cached.body, 'data', 'writeAuthorizing'), false);
});
