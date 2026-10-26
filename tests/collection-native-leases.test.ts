// The collection ticket and the read lease around each page on the native lane: how a page that never ran, or that failed, is
// settled, which acknowledgements the sidecar accepts, and how a read that cannot finish is retired instead of blocking access.
import assert from 'node:assert/strict';
import test from 'node:test';
import { hangUp, refuse } from '../tools/fake-plugin/dist/src/index.js';
import type { FakePluginOptions } from '../tools/fake-plugin/dist/src/index.js';
import type { HostRig } from '../apps/sidecar/dist/tests/host-rig.js';
import { fieldOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { askDemand, collectionRig, hostCalls, interceptCollection, refusalOf, repair, shortTimeouts, simulatedHost, sleep, startDemand } from './collection-native-support.ts';
import type { CollectionRigOptions, Dispatch, StartedDemand } from './collection-native-support.ts';

const INDEX = { kind: 'index' };
const SCHEMA = 'collection-dispatch-outcome/1';

interface DispatchOutcome {
  readonly schemaVersion: string;
  readonly kind: string;
  readonly requestId: string;
  readonly generation: number;
}

const acknowledgement = (dispatch: Dispatch, extra: Partial<DispatchOutcome> = {}) => ({
  ticket: dispatch.ticket,
  outcome: { schemaVersion: SCHEMA, kind: 'native-not-started', requestId: dispatch.ticket, generation: dispatch.generation, ...extra },
});

async function withRig(options: CollectionRigOptions, body: (rig: HostRig) => Promise<void>): Promise<void> {
  const host = simulatedHost(100), rig = await collectionRig(host, options);
  try { await body(rig); } finally { await rig.close(); }
}

async function admitted(rig: HostRig): Promise<StartedDemand> {
  const started = await startDemand(rig, { target: INDEX, limit: 25 });
  rig.sidecar.agentMailbox.length = 0;
  const outcome = await rig.receivers.collection('dispatch', { ticket: started.ticket });
  assert.equal(outcome.outcome, 'succeeded');
  return started;
}

const release = async (rig: HostRig, started: StartedDemand): Promise<void> => { await rig.receivers.collection('complete', acknowledgement(started.dispatch)); };
const retained = (rig: HostRig): string => textOf(rig.sidecar.collection.lookup(JSON.stringify(['index', null, null, null, '1'])), 'state');

test('a generic undispatched cancel cannot erase an admitted ticket, and the next demand waits', async () => {
  await withRig({}, async rig => {
    const started = await admitted(rig);
    await rig.receivers.collection('cancel', { ticket: started.ticket, undispatched: true });
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), true);
    const next = await askDemand(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(next, 'error.code'), 'COLLECTION_BUSY');
  });
});

test('a page the plugin never started is completed as not started once: the lease says so, no evidence is published, a duplicate is stale, and the next demand runs', async () => {
  await withRig({ plugin: { hostCalls: { aeCollectIndexPage: () => refuse('SHUTTING_DOWN', 'quitting') } } }, async rig => {
    const started = await startDemand(rig, { target: INDEX, limit: 25 });
    await rig.drain();
    const completed = rig.bodies.find(entry => entry.call === 'collection:complete')?.args[1];
    assert.deepEqual(completed, acknowledgement(started.dispatch));
    assert.equal(fieldOf(rig.bodies.find(entry => entry.call === 'bridge:settle')?.args, '1.outcome'), 'native-not-started');
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false, 'released');
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(started.ticket), 'state'), 'unknown', 'no observational evidence');
    assert.equal(retained(rig), 'unknown');
    const duplicate = await rig.receivers.collection('complete', completed);
    assert.equal(refusalOf(duplicate), 'STALE_COLLECTION_TICKET');
    assert.equal(fieldOf(await askDemand(rig, { target: INDEX, limit: 25 }), 'ok'), true);
  });
});

test('forged, mixed and unadmitted acknowledgements keep the ticket; only the exact one releases it', async () => {
  await withRig({}, async rig => {
    for (const forged of [{ generation: -1 }, { requestId: 'wrong' }, { kind: 'native-started' }, { schemaVersion: 'wrong' }]) {
      const started = await admitted(rig);
      const refused = await rig.receivers.collection('complete', acknowledgement(started.dispatch, forged));
      assert.equal(refusalOf(refused), 'INVALID_COLLECTION_DISPATCH_OUTCOME', JSON.stringify(forged));
      assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), true);
      await release(rig, started);
      assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false);
    }
    const mixed = await admitted(rig);
    const refusedMixed = await rig.receivers.collection('complete', { ...acknowledgement(mixed.dispatch), page: {} });
    assert.equal(refusalOf(refusedMixed), 'INVALID_COLLECTION_DISPATCH_OUTCOME');
    assert.equal(rig.sidecar.collection.hasUnsettled(mixed.ticket), true);
    await release(rig, mixed);
    const unadmitted = await startDemand(rig, { target: INDEX, limit: 25 });
    const refusedUnadmitted = await rig.receivers.collection('complete', acknowledgement(unadmitted.dispatch));
    assert.equal(refusalOf(refusedUnadmitted), 'COLLECTION_NOT_ADMITTED');
    assert.equal(rig.sidecar.collection.hasUnsettled(unadmitted.ticket), true);
  });
});

test('a new plugin connection retires the old connection\'s unfinished read as stale, with no quarantine, and the next demand runs', async () => {
  await withRig({}, async rig => {
    const started = await admitted(rig);
    repair(rig, 'native:1:2');
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false, 'a read cannot change the project, so the replaced connection\'s read is retired');
    const late = await rig.receivers.collection('complete', acknowledgement(started.dispatch));
    assert.equal(refusalOf(late), 'STALE_COLLECTION_TICKET');
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(started.ticket), 'state'), 'unknown');
    assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
    const next = await startDemand(rig, { target: INDEX, limit: 25 });
    assert.notEqual(next.ticket, started.ticket);
    assert.equal(fieldOf(next.result, 'ok'), true);
  });
});

type HostCalls = NonNullable<FakePluginOptions['hostCalls']>;

const FAILURES: ReadonlyArray<readonly [string, HostCalls]> = [
  ['HOST_DISPATCH_UNKNOWN', { aeCollectIndexPage: () => hangUp() }],
  ['HOST_QUARANTINED', { aeCollectIndexPage: () => refuse('HOST_QUARANTINED', 'held') }],
  ['HOST_TIMEOUT', { aeCollectIndexPage: async () => { await sleep(600); return refuse('LATE', 'too late'); } }],
];
for (const [code, entries] of FAILURES) {
  test(`a read page that fails with ${code} retires its ticket with that code, quarantines nothing, survives pairing and blocks no later demand`, async () => {
    await withRig({ plugin: { hostCalls: entries } }, async rig => {
      shortTimeouts(rig, 250);
      const started = await startDemand(rig, { target: INDEX, limit: 25 });
      await rig.drain();
      const result = rig.sidecar.collection.demandResult(started.ticket);
      assert.equal(fieldOf(result, 'state'), 'unknown');
      assert.equal(fieldOf(result, 'error.code'), code);
      assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false);
      assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
      assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null);
      const late = await rig.receivers.collection('complete', acknowledgement(started.dispatch));
      assert.equal(refusalOf(late), 'STALE_COLLECTION_TICKET', 'a later no-native-started acknowledgement is stale');
      repair(rig, 'native:1:2');
      assert.equal(fieldOf(rig.sidecar.collection.demandResult(started.ticket), 'error.code'), code, 'the reason survives pairing');
      assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
      assert.equal(fieldOf(await askDemand(rig, { target: INDEX, limit: 25 }), 'ok'), true);
    });
  });
}

test('a link that goes away after admission acknowledges that no native work started, with the ticket\'s own generation, and never calls the plugin', async () => {
  await withRig({}, async rig => {
    interceptCollection(rig, { after: async action => { if (action === 'dispatch') rig.client.close(); } });
    const started = await startDemand(rig, { target: INDEX, limit: 25 });
    await rig.drain();
    assert.equal(hostCalls(rig).length, 0, 'the plugin was never called');
    assert.deepEqual(rig.calls, ['collection:dispatch', 'bridge:reserve', 'bridge:settle', 'collection:complete']);
    assert.equal(fieldOf(rig.bodies.find(entry => entry.call === 'bridge:settle')?.args, '1.outcome'), 'native-not-started');
    assert.deepEqual(rig.bodies.find(entry => entry.call === 'collection:complete')?.args[1], acknowledgement(started.dispatch));
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false);
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(started.ticket), 'state'), 'unknown');
  });
});

test('a ticket whose admission is refused starts no native work, takes no lease and is reported', async () => {
  await withRig({}, async rig => {
    interceptCollection(rig, { before: async action => { if (action === 'dispatch') rig.sidecar.collection.invalidate(); } });
    const started = await startDemand(rig, { target: INDEX, limit: 25 });
    await rig.drain();
    assert.deepEqual(rig.calls, ['collection:dispatch', 'collection:cancel', 'acceptPanelEvent'], 'no lease, no call and no completion: the refused ticket is released at once');
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false, 'a new demand is not turned away as busy for the next minute');
    assert.equal(hostCalls(rig).length, 0);
    assert.equal(rig.sidecar.panel.lastError?.code, 'COLLECTION_DISPATCH_UNKNOWN');
    assert.equal(rig.sidecar.collection.admittedNativeTicket(), null, `${started.ticket} was never admitted`);
  });
});

test('an admitted read older than 60 s is retired by the next demand instead of quarantining, and its demand says it timed out', async () => {
  const clock = { ms: Date.parse('2026-10-04T12:00:00.000Z') };
  await withRig({ sidecar: { now: () => new Date(clock.ms) } }, async rig => {
    const started = await admitted(rig);
    clock.ms += 59999;
    assert.equal(fieldOf(await askDemand(rig, { target: INDEX, limit: 25 }), 'error.code'), 'COLLECTION_BUSY');
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), true);
    clock.ms += 1;
    const next = await startDemand(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(next.result, 'ok'), true);
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false);
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(started.ticket), 'error.code'), 'COLLECTION_TIMED_OUT');
    assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
    await rig.drain();
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(next.ticket), 'state'), 'observed', 'and the new read runs');
  });
});
