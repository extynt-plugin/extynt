// Cancellation, mutation and timeout of a collection page that is in flight on the native lane: the late page never publishes,
// nothing further is asked of the plugin, and every ticket the lane held is settled exactly once.
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostRig } from '../apps/sidecar/dist/tests/host-rig.js';
import { fieldOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import {
  askDemand, codeOf, collectionRig, demandPage, gate, hostCalls, interceptCollection, refusalOf, rowKey, runCollectionTool, shortTimeouts, simulatedHost, sleep,
  startDemand, waitingDeps,
} from './collection-native-support.ts';
import type { CollectionRigOptions, SimulatedHost } from './collection-native-support.ts';

const INDEX = { kind: 'index' };
const retained = (rig: HostRig, id: string): string => textOf(rig.sidecar.collection.lookup(rowKey('index', id)), 'state');
const dispatchTicket = (rig: HostRig): string => textOf(rig.bodies.find(entry => entry.call === 'collection:dispatch')?.args, '1.ticket');
const completionOf = (ticket: string, generation: number) => ({
  ticket, outcome: { schemaVersion: 'collection-dispatch-outcome/1', kind: 'native-not-started', requestId: ticket, generation },
});

async function withRig(options: CollectionRigOptions, body: (rig: HostRig, host: SimulatedHost) => Promise<void>): Promise<void> {
  const host = simulatedHost(300), rig = await collectionRig(host, options);
  try { await body(rig, host); } finally { await rig.close(); }
}

test('cancelling a demand while its page is in flight discards the late page: nothing is retained and no further page is asked for', async () => {
  const waiting = gate();
  await withRig({ hooks: { before: waiting.hook } }, async rig => {
    const controller = new AbortController();
    const call = runCollectionTool(waitingDeps(rig), 'ae_read_graph_page', { target: INDEX, limit: 25 }, { wait: 5, signal: controller.signal });
    const run = rig.drain();
    await waiting.entered;
    controller.abort();
    assert.equal(fieldOf(await call, 'error.code'), 'DEMAND_CANCELLED');
    waiting.release();
    await run;
    assert.equal(hostCalls(rig).length, 1, 'no next call');
    assert.equal(retained(rig, '1'), 'unknown', 'the late page is not published');
    assert.equal(rig.sidecar.agentMailbox.length, 0);
    assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
    assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null);
    const ticket = dispatchTicket(rig);
    assert.equal(rig.sidecar.collection.hasUnsettled(ticket), false, 'the callback settled the abandoned read');
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(ticket), 'error.code'), 'COLLECTION_CANCELLED');
  });
});

test('a mutation lease clears what was retained and holds the collection back: no page reaches the plugin until the mutation settles', async () => {
  await withRig({}, async rig => {
    await demandPage(rig, { target: INDEX, limit: 25 });
    assert.equal(retained(rig, '1'), 'observed');
    const reserved = await rig.receivers.nativeBridge('reserve', { requestId: 'apply-1', kind: 'mutation' });
    assert.equal(reserved.outcome, 'succeeded');
    assert.equal(retained(rig, '1'), 'unknown', 'the mutation retires every observation');
    const calls = hostCalls(rig).length;
    const { result } = await startDemand(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(result, 'ok'), true, 'the demand is queued');
    assert.equal(rig.readers.claimAhead(rig.context.now()), undefined, 'but the lane does not claim it while native access is held');
    assert.equal(hostCalls(rig).length, calls);
    const lease = rig.sidecar.nativeBridge.accessQuarantine();
    assert.equal(fieldOf(lease, 'requestId'), 'apply-1');
    const settled = await rig.receivers.nativeBridge('settle', jsonOf({ lease: reserved.body.lease, outcome: 'callback-received' }));
    assert.equal(settled.outcome, 'succeeded');
    assert.deepEqual(await rig.drain(), ['collection_page']);
    assert.equal(retained(rig, '1'), 'observed', 'the page runs once the mutation has settled');
  });
});

test('a page that outlives its timeout fails with HOST_TIMEOUT; no second demand dispatches meanwhile, the ticket is retired and the next demand runs', async () => {
  let arrivals = 0;
  const hooks = { before: async (): Promise<void> => { arrivals += 1; if (arrivals === 1) await sleep(700); } };
  await withRig({ hooks }, async rig => {
    shortTimeouts(rig, 250);
    const first = runCollectionTool(waitingDeps(rig), 'ae_read_graph_page', { target: INDEX, limit: 25 }, 5);
    const run = rig.drain();
    await sleep(60);
    const concurrent = await askDemand(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(concurrent, 'error.code'), 'COLLECTION_BUSY', 'a second scan cannot dispatch');
    assert.equal(hostCalls(rig).length, 1);
    const timedOut = await first;
    await run;
    assert.equal(fieldOf(timedOut, 'data.error.code'), 'HOST_TIMEOUT');
    assert.equal(fieldOf(timedOut, 'data.recovery.action'), 'demand-fresh-evidence');
    assert.equal(rig.sidecar.collection.hasUnsettled(textOf(timedOut, 'data.demandId')), false);
    assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null, 'a read timeout retires its ticket and quarantines nothing');
    assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null);
    assert.equal(retained(rig, '1'), 'unknown');
    await sleep(500);
    const next = await demandPage(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(next, 'data.state'), 'observed');
    assert.equal(hostCalls(rig).length, 2);
  });
});

test('a cancel between admission and the plugin call settles only the old ticket: its page never publishes and the replacement ticket is untouched', async () => {
  await withRig({}, async rig => {
    let old = '';
    interceptCollection(rig, { after: async action => {
      if (action !== 'dispatch') return;
      old = dispatchTicket(rig);
      rig.sidecar.collection.cancelDemand(old);
    } });
    const started = await startDemand(rig, { target: INDEX, limit: 25 });
    await rig.drain();
    assert.equal(rig.sidecar.collection.hasUnsettled(started.ticket), false, 'the old ticket is settled');
    assert.equal(fieldOf(rig.sidecar.collection.demandResult(old), 'state'), 'unknown');
    assert.equal(retained(rig, '1'), 'unknown', 'a page the cancel overtook is never published');
    const replacement = await startDemand(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(replacement.result, 'ok'), true);
    const late = await rig.receivers.collection('complete', completionOf(old, started.dispatch.generation));
    assert.equal(refusalOf(late), 'STALE_COLLECTION_TICKET');
    assert.equal(rig.sidecar.collection.hasUnsettled(replacement.ticket), true, 'the old ticket\'s late acknowledgement cannot release the new one');
  });
});

test('callback settlement retires only the exact abandoned admitted read, and never lets an old page publish', async () => {
  await withRig({}, async rig => {
    const service = rig.sidecar.collection;
    const unadmitted = await startDemand(rig, { target: INDEX, limit: 25 });
    assert.equal(service.admittedNativeTicket(), null);
    service.settleNativeAfterBridge(unadmitted.ticket);
    assert.equal(service.hasUnsettled(unadmitted.ticket), true, 'an unadmitted ticket is not retired by a settlement');
    await rig.receivers.collection('dispatch', { ticket: unadmitted.ticket });
    assert.equal(service.admittedNativeTicket(), unadmitted.ticket);
    service.settleNativeAfterBridge(unadmitted.ticket);
    assert.equal(service.hasUnsettled(unadmitted.ticket), true, 'a healthy owner still submits its page through complete()');
    service.cancelDemand(unadmitted.ticket);
    service.settleNativeAfterBridge('wrong');
    assert.equal(service.hasUnsettled(unadmitted.ticket), true, 'another id settles nothing');
    service.settleNativeAfterBridge(unadmitted.ticket);
    assert.equal(service.hasUnsettled(unadmitted.ticket), false);
    assert.equal(service.nativeAccessQuarantine(), null);
    assert.equal(fieldOf(service.demandResult(unadmitted.ticket), 'state'), 'unknown');
    const stale = await rig.receivers.collection('complete', { ticket: unadmitted.ticket, page: { ok: true } });
    assert.equal(refusalOf(stale), 'STALE_COLLECTION_TICKET');
    rig.sidecar.agentMailbox.length = 0;
    const next = await startDemand(rig, { target: INDEX, limit: 25 });
    await rig.receivers.collection('dispatch', { ticket: next.ticket });
    service.settleNativeAfterBridge(unadmitted.ticket);
    assert.equal(service.hasUnsettled(next.ticket), true, 'the old ticket\'s settlement cannot retire the new read');
    assert.equal(codeOf(await runCollectionTool(waitingDeps(rig), 'ae_get_graph_page', { demandId: unadmitted.ticket }, 0)), 'COLLECTION_CANCELLED');
  });
});
