// Bounded detail browsing through the native lane: one 25-row page per explicit demand, no silent rediscovery,
// nothing resurrected after a cancel, bad pages refused.
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fieldOf, listOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import type { NativeRig } from '../apps/sidecar/dist/tests/native-rig.js';
import type { ToolCallEnvelope } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { pagesWorld, LAYER_COUNT } from './manual-detail-native-world.ts';
import type { PagesWorld } from './manual-detail-native-world.ts';
import { lastAnswer } from './readset-native-host.ts';
import { worldRig, demand, hostHandler, patchHostAnswer } from './readset-native-rig.ts';

const hostCalls = (world: PagesWorld): number => world.log.length;
const rowNames = (answer: ToolCallEnvelope): string[] => recordsOf(answer, 'data.page.rows').map((row) => textOf(row, 'name'));
const rowCount = (answer: ToolCallEnvelope): number => recordsOf(answer, 'data.page.rows').length;
const cachedRows = (rig: NativeRig, world: PagesWorld): number => listOf(rig.sidecar.collection.queryCache({ target: world.layers }), 'rows').length;
const continuationOf = (answer: ToolCallEnvelope): JsonObject => ({ jobId: textOf(answer, 'data.continuation.jobId') });

async function browsing(t: TestContext): Promise<{ world: PagesWorld; rig: NativeRig }> {
  const world = pagesWorld(), rig = await worldRig(t, world);
  const index = await demand(rig, { target: world.index });
  assert.equal(fieldOf(index, 'data.state'), 'observed', JSON.stringify(index));
  return { world, rig };
}

function holdDetail(rig: NativeRig): () => void {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inner = hostHandler(rig, 'aeCollectDetailPage');
  rig.plugin.hostCalls.set('aeCollectDetailPage', async (args, request, plugin) => { await gate; return inner(args, request, plugin); });
  return release;
}

test('manual detail browsing demands one 25-row page per explicit action and restarts safely', async (t) => {
  const { world, rig } = await browsing(t);
  const first = await demand(rig, { target: world.layers });
  assert.equal(hostCalls(world), 2);
  assert.equal(rowCount(first), 25);
  assert.equal(rowNames(first)[0], 'Layer 1');
  assert.equal(fieldOf(first, 'data.coverage.absentOutsidePage'), 'unknown');
  assert.equal(fieldOf(first, 'data.coverage.properties'), 'unknown');
  const second = await demand(rig, continuationOf(first));
  assert.deepEqual([hostCalls(world), rowCount(second), rowNames(second)[0]], [3, 25, 'Layer 26']);
  const third = await demand(rig, continuationOf(first));
  assert.deepEqual([hostCalls(world), rowCount(third), fieldOf(third, 'data.page.nextCursor'), fieldOf(third, 'data.continuation')], [4, LAYER_COUNT - 50, null, null]);
  const past = await demand(rig, continuationOf(first));
  assert.equal(fieldOf(past, 'error.code'), 'STALE_COLLECTION', 'nothing continues past the end');
  assert.equal(hostCalls(world), 4);
  const restarted = await demand(rig, { target: world.layers });
  assert.deepEqual([hostCalls(world), rowNames(restarted)[0]], [5, 'Layer 1']);
  await demand(rig, { target: world.index });
  assert.equal(hostCalls(world), 6);
  const stale = await demand(rig, continuationOf(restarted));
  assert.equal(fieldOf(stale, 'error.code'), 'STALE_COLLECTION', 'a new index demand retires the earlier detail job');
  assert.equal(hostCalls(world), 6);
});

test('same-count external edits refuse the old detail continuation rather than silently rediscovering', async (t) => {
  const { world, rig } = await browsing(t);
  const first = await demand(rig, { target: world.layers });
  world.project.revision++;
  const refused = await demand(rig, continuationOf(first));
  assert.equal(hostCalls(world), 3, 'the host was asked once and said no');
  assert.equal(fieldOf(refused, 'data.state'), 'unknown');
  assert.equal(fieldOf(refused, 'data.error.code'), fieldOf(lastAnswer(world, 'aeCollectDetailPage'), 'error.code'));
  assert.equal(fieldOf(refused, 'data.page'), undefined);
  const again = await demand(rig, continuationOf(first));
  assert.equal(fieldOf(again, 'error.code'), 'STALE_COLLECTION');
  assert.equal(hostCalls(world), 3);
  const restarted = await demand(rig, { target: world.layers });
  assert.equal(hostCalls(world), 4);
  assert.equal(rowNames(restarted)[0], 'Layer 1');
});

test('a cancelled demand cannot be resurrected by the late native answer, and costs no further host call', async (t) => {
  const { world, rig } = await browsing(t);
  const release = holdDetail(rig);
  const pending = await rig.agent('ae_read_graph_page', { target: world.layers });
  assert.equal(fieldOf(pending.body, 'data.state'), 'pending');
  await rig.waitFor(() => rig.plugin.requestsFor('host_call').length === 2);
  rig.sidecar.collection.cancelDemand(textOf(pending.body, 'data.demandId'));
  release();
  await rig.waitFor(() => !rig.sidecar.inFlight);
  const settled = rig.sidecar.collection.demandResult(textOf(pending.body, 'data.demandId'));
  assert.equal(fieldOf(settled, 'state'), 'unknown');
  assert.equal(fieldOf(settled, 'page'), undefined);
  assert.equal(hostCalls(world), 2);
  assert.equal(fieldOf(rig.sidecar.latest, 'snapshot.result.coverage'), undefined, 'the late page published nothing');
  assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
});

test('a mutation admitted behind a finished page retires its rows and its continuation without another read', async (t) => {
  const { world, rig } = await browsing(t);
  const first = await demand(rig, { target: world.layers });
  const { receivers, collection } = rig.sidecar;
  assert.equal(cachedRows(rig, world) > 0, true);
  const reserved = await receivers.nativeBridge('reserve', { requestId: 'mutation-1', kind: 'mutation' });
  assert.equal(reserved.outcome, 'succeeded', JSON.stringify(reserved));
  assert.equal(cachedRows(rig, world), 0);
  assert.equal(fieldOf(collection.demandResult(textOf(first, 'data.demandId')), 'invalidated'), true);
  await receivers.nativeBridge('settle', jsonOf({ lease: fieldOf(reserved, 'body.lease'), outcome: 'native-not-started' }));
  const continued = await demand(rig, continuationOf(first));
  assert.equal(fieldOf(continued, 'error.code'), 'STALE_COLLECTION');
  assert.equal(hostCalls(world), 2);
});

const MALFORMED_PAGES: ReadonlyArray<readonly [JsonObject, string]> = [
  [{ rows: [null] }, 'INVALID_COLLECTION_ROW'], [{ rows: [7] }, 'INVALID_COLLECTION_ROW'], [{ rows: [{ id: 'bad', name: null }] }, 'INVALID_COLLECTION_ROW'],
  [{ rows: {} }, 'INVALID_COLLECTION_PAGE'], [{ sessionId: 7 }, 'INVALID_COLLECTION_PAGE'], [{ nextCursor: '26' }, 'INVALID_COLLECTION_PAGE'], [{ deepComplete: true }, 'INVALID_COLLECTION_PAGE'],
];

test('malformed detail pages are refused before any row is kept, without another native call', async (t) => {
  for (const [patch, code] of MALFORMED_PAGES) {
    const { world, rig } = await browsing(t);
    patchHostAnswer(rig, 'aeCollectDetailPage', patch);
    const refused = await demand(rig, { target: world.layers });
    const label = JSON.stringify(patch);
    assert.equal(fieldOf(refused, 'data.state'), 'unknown', label);
    assert.equal(fieldOf(refused, 'data.error.code'), code, label);
    assert.equal(fieldOf(refused, 'data.page'), undefined, label);
    assert.equal(hostCalls(world), 2, label);
    assert.equal(fieldOf(rig.sidecar.latest, 'snapshot.result.coverage'), undefined, label);
    assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null, label);
    assert.equal(cachedRows(rig, world), 0, label);
  }
});
