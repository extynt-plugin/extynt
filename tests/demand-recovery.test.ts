/**
 * Tests recovery of read demands: polling a pending read, retiring a timed-out one, and unknown versus absent
 * coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import type { CollectionToolDeps } from '../apps/sidecar/dist/src/collection-tools.js';
import { onlineHostLink } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { fieldOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { runCollectionTool } from './collection-native-support.ts';

const INDEX = { kind: 'index' };
const READ = 'ae_read_graph_page';
const GET = 'ae_get_graph_page';

function fixture(now: () => number = Date.now): CollectionToolDeps {
  const collection = new CollectionService(now);
  collection.pair('p');
  const panel = { lastSeenAt: 0, busy: false, busyKind: null, busySinceAt: null, lastError: null };
  return {
    state: { collection, activePanelInstanceId: 'p', agentMailbox: [], inFlight: undefined, options: { token: 'test-token' }, panel, hostLink: onlineHostLink() },
    transport: { notifyChange() {}, async waitUntil() { return false; } },
  };
}

const demandIdOf = (answer: ReturnType<typeof fieldOf>): string => textOf(answer, 'data.demandId');
const mailbox = (deps: CollectionToolDeps) => deps.state.agentMailbox;
const dispatchTicketOf = (deps: CollectionToolDeps): string => textOf(mailbox(deps)[0], 'approvedData.dispatch.ticket');

test('pending read directs polling of the existing demand without redispatch', async () => {
  const deps = fixture();
  const result = await runCollectionTool(deps, READ, { target: INDEX }, 0);
  assert.equal(fieldOf(result, 'data.recovery.action'), 'wait-for-existing-demand');
  assert.equal(fieldOf(result, 'data.recovery.tool'), GET);
  assert.equal(fieldOf(result, 'data.writeAuthorizing'), false);
  const again = await runCollectionTool(deps, GET, { demandId: demandIdOf(result) }, 0);
  assert.equal(fieldOf(again, 'data.recovery.action'), 'wait-for-existing-demand');
  assert.equal(mailbox(deps).length, 1);
});

test('a timed-out read is retired on the next demand, which starts fresh native work; guidance never claims the project could have changed', async () => {
  let now = 0;
  const deps = fixture(() => now);
  const first = await runCollectionTool(deps, READ, { target: INDEX }, 0), id = demandIdOf(first);
  deps.state.collection.authorizeDispatch({ ticket: id });
  now = 60001;
  const timed = await runCollectionTool(deps, GET, { demandId: id }, 0);
  assert.equal(fieldOf(timed, 'data.error.code'), 'DEMAND_TIMEOUT');
  assert.equal(fieldOf(timed, 'data.recovery.action'), 'demand-fresh-evidence');
  assert.equal(fieldOf(timed, 'data.recovery.automaticRetry'), false);
  assert.match(textOf(timed, 'data.recovery.message'), /cannot change the project/);
  const retry = await runCollectionTool(deps, READ, { target: INDEX }, 0);
  assert.equal(fieldOf(retry, 'ok'), true);
  assert.notEqual(demandIdOf(retry), id);
  assert.equal(fieldOf(retry, 'data.state'), 'pending');
  assert.equal(deps.state.collection.hasUnsettled(id), false);
  assert.equal(deps.state.collection.hasUnsettled(demandIdOf(retry)), true);
  assert.equal(mailbox(deps).length, 2);
  const old = await runCollectionTool(deps, GET, { demandId: id }, 0);
  assert.equal(fieldOf(old, 'data.error.code'), 'COLLECTION_TIMED_OUT');
  assert.equal(fieldOf(old, 'data.recovery.action'), 'demand-fresh-evidence');
});

test('completed stale and missing demands distinguish unknown coverage from absence', async () => {
  const deps = fixture();
  const first = await runCollectionTool(deps, READ, { target: INDEX }, 0), id = demandIdOf(first);
  deps.state.collection.authorizeDispatch({ ticket: id });
  const page = { ok: true, requestId: id, sessionId: 's', stamp: { epoch: 1, revision: 1 }, rows: [], nextCursor: null, deepComplete: false };
  deps.state.collection.complete({ ticket: id, page });
  deps.state.collection.invalidate();
  const stale = await runCollectionTool(deps, GET, { demandId: id }, 0);
  assert.equal(fieldOf(stale, 'data.freshness'), 'stale');
  assert.equal(fieldOf(stale, 'data.recovery.action'), 'demand-fresh-evidence');
  assert.equal(fieldOf(stale, 'data.writeAuthorizing'), false);
  const missing = await runCollectionTool(deps, GET, { demandId: 'missing' }, 0);
  assert.equal(fieldOf(missing, 'data.state'), 'unknown');
  assert.match(textOf(missing, 'data.recovery.message'), /never absent/);
});

test('cancel after admission retains exact native lease and returns settlement instruction', async () => {
  const deps = fixture(), controller = new AbortController();
  deps.transport.waitUntil = async () => {
    deps.state.collection.authorizeDispatch({ ticket: dispatchTicketOf(deps) });
    controller.abort();
    return true;
  };
  const result = await runCollectionTool(deps, READ, { target: INDEX }, { wait: 1, signal: controller.signal }), id = dispatchTicketOf(deps);
  assert.equal(fieldOf(result, 'error.code'), 'DEMAND_CANCELLED');
  assert.match(textOf(result, 'error.message'), /Do not redispatch/);
  assert.equal(deps.state.collection.hasUnsettled(id), true);
  assert.equal(deps.state.collection.dispatchCurrent(id), false);
});

test('a read whose dispatch outcome is unknown is retired, stays retired across panel pairing, and does not block another demand', async () => {
  const deps = fixture();
  const first = await runCollectionTool(deps, READ, { target: INDEX }, 0), id = demandIdOf(first);
  deps.state.collection.authorizeDispatch({ ticket: id });
  const failed = { ok: false, mayHaveMutated: true, error: { code: 'HOST_DISPATCH_UNKNOWN' } };
  assert.throws(() => deps.state.collection.complete({ ticket: id, page: failed }), /HOST_DISPATCH_UNKNOWN/);
  deps.state.collection.pair('new-panel');
  assert.equal(deps.state.collection.hasUnsettled(id), false);
  assert.equal(deps.state.collection.nativeAccessQuarantine(), null);
  const next = await runCollectionTool(deps, READ, { target: INDEX }, 0);
  assert.equal(fieldOf(next, 'ok'), true);
  assert.equal(fieldOf(next, 'data.state'), 'pending');
  assert.equal(mailbox(deps).length, 2);
});

test('failed native reads retain their reason and tell the agent to demand fresh evidence; nothing stays pinned', async () => {
  for (const code of ['HOST_TIMEOUT', 'HOST_QUARANTINED', 'HOST_DISPATCH_UNKNOWN']) {
    const deps = fixture(), first = await runCollectionTool(deps, READ, { target: INDEX }, 0), id = demandIdOf(first);
    deps.state.collection.authorizeDispatch({ ticket: id });
    assert.throws(() => deps.state.collection.complete({ ticket: id, page: { ok: false, error: { code } } }), new RegExp(code));
    const result = await runCollectionTool(deps, GET, { demandId: id }, 0);
    assert.equal(fieldOf(result, 'data.error.code'), code);
    assert.equal(fieldOf(result, 'data.state'), 'unknown');
    assert.equal(fieldOf(result, 'data.invalidated'), true);
    assert.equal(fieldOf(result, 'data.recovery.action'), 'demand-fresh-evidence', code);
    assert.equal(fieldOf(result, 'data.recovery.automaticRetry'), false);
    assert.equal(deps.state.collection.hasUnsettled(id), false);
    assert.equal(deps.state.collection.nativeAccessQuarantine(), null);
  }
});

test('a malformed target names the fields its kind needs and queues nothing', async () => {
  const deps = fixture();
  const incomplete = { kind: 'effect-create', compositionId: '2320', layerId: '2335' };
  const missing = await runCollectionTool(deps, READ, { target: incomplete }, 0);
  assert.equal(fieldOf(missing, 'ok'), false);
  assert.equal(fieldOf(missing, 'error.code'), 'INVALID_COLLECTION_TARGET');
  assert.match(textOf(missing, 'error.message'), /itemIndex/);
  assert.match(textOf(missing, 'error.message'), /layerIndex/);
  const expectedStamp = { epoch: 1, revision: '7894' };
  const target = { kind: 'effect-create', itemIndex: 1, compositionId: '2320', layerIndex: 1, layerId: '2335', expectedStamp };
  const stamp = await runCollectionTool(deps, READ, { target }, 0);
  assert.equal(fieldOf(stamp, 'error.code'), 'INVALID_COLLECTION_STAMP');
  assert.match(textOf(stamp, 'error.message'), /epoch and revision integers/);
  assert.equal(mailbox(deps).length, 0);
});
