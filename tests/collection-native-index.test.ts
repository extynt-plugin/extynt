// Index browsing through the native host lane: the sidecar demands bounded pages of the project's items from the plugin
// (aeCollectIndexPage, run by the real collection host script) and retains what it observed.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostRig } from '../apps/sidecar/dist/tests/host-rig.js';
import { fieldOf, listOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { codeOf, collectionRig, demandPage, hostCalls, rowKey, scanPages, simulatedHost } from './collection-native-support.ts';
import type { CollectionRigOptions, SimulatedHost } from './collection-native-support.ts';

const INDEX = { kind: 'index' };
const entriesOf = (rig: HostRig): Array<string | undefined> => hostCalls(rig).map(request => request.body.entry);
const stateOf = (rig: HostRig, id: string): string => textOf(rig.sidecar.collection.lookup(rowKey('index', id)), 'state');

type RigBody = (rig: HostRig, host: SimulatedHost) => Promise<void>;

async function withRig(size: number, options: CollectionRigOptions, body: RigBody): Promise<void> {
  const host = simulatedHost(size), rig = await collectionRig(host, options);
  try { await body(rig, host); } finally { await rig.close(); }
}

test('300 compositions are 12 bounded index pages with no layer read, every row retained as observed and its properties unknown', async () => {
  await withRig(300, {}, async rig => {
    const { pages, failed } = await scanPages(rig, { target: INDEX, limit: 25 });
    assert.equal(failed, null, 'a layer read would have failed the page');
    assert.equal(pages.length, 12);
    assert.ok(pages.every(page => listOf(page, 'rows').length <= 25 && fieldOf(page, 'consistency') === 'observational' && fieldOf(page, 'deepComplete') === false));
    assert.equal(pages.reduce((total, page) => total + listOf(page, 'rows').length, 0), 300);
    assert.equal(hostCalls(rig).length, 12);
    assert.deepEqual([...new Set(entriesOf(rig))], ['aeCollectIndexPage'], 'no deep call');
    const reserved = rig.bodies.filter(entry => entry.call === 'bridge:reserve').map(entry => entry.args[1]);
    assert.equal(reserved.length, 12);
    assert.ok(reserved.every(lease => fieldOf(lease, 'kind') === 'read' && typeof fieldOf(lease, 'collectionTicket') === 'string'), 'each page runs under a read lease bound to its ticket');
    const last = rig.sidecar.collection.lookup(rowKey('index', '300'));
    assert.equal(fieldOf(last, 'state'), 'observed');
    assert.equal(fieldOf(last, 'row.properties'), 'unknown');
    assert.equal(fieldOf(last, 'writeAuthorizing'), false);
  });
});

test('a retained row goes stale after 15 s, and the next pass observes an external rename and replaces the row', async () => {
  const clock = { ms: Date.parse('2026-10-04T12:00:00.000Z') };
  await withRig(90, { sidecar: { now: () => new Date(clock.ms) } }, async (rig, host) => {
    await scanPages(rig, { target: INDEX, limit: 25 });
    assert.equal(stateOf(rig, '90'), 'observed');
    clock.ms += 16000;
    assert.equal(stateOf(rig, '90'), 'stale', 'old evidence is stale, not absent');
    host.itemAt(89).name = 'external rename';
    const { failed } = await scanPages(rig, { target: INDEX, limit: 25 });
    assert.equal(failed, null);
    const row = rig.sidecar.collection.lookup(rowKey('index', '90'));
    assert.equal(fieldOf(row, 'state'), 'observed');
    assert.equal(fieldOf(row, 'row.name'), 'external rename');
  });
});

test('the retained rows are bounded at 16384: the oldest are evicted and read back as unknown, never as absent', async () => {
  const fixed = Date.parse('2026-10-04T12:00:00.000Z');
  await withRig(16500, { sidecar: { now: () => new Date(fixed) } }, async rig => {
    const { pages, failed } = await scanPages(rig, { target: INDEX, limit: 25 });
    assert.equal(failed, null);
    assert.equal(pages.length, 660);
    assert.equal(stateOf(rig, '1'), 'unknown');
    assert.equal(stateOf(rig, '116'), 'unknown');
    assert.equal(stateOf(rig, '117'), 'observed');
    assert.equal(stateOf(rig, '16500'), 'observed');
  });
});

test('a 1500-item index streams page by page, each row delivered once and none treated as absent', async () => {
  await withRig(1500, {}, async rig => {
    const seen: string[] = [];
    const { pages, failed } = await scanPages(rig, { target: INDEX, limit: 25 });
    for (const page of pages) seen.push(...recordsOf(page, 'rows').map(row => textOf(row, 'id')));
    assert.equal(failed, null);
    assert.equal(pages.length, 60);
    assert.deepEqual(seen, Array.from({ length: 1500 }, (_, index) => String(index + 1)));
    assert.equal(stateOf(rig, '1'), 'observed');
    assert.equal(stateOf(rig, '1500'), 'observed');
  });
});

test('a page that yields before the second item getter after a slow first getter is accepted, and the next page resumes after it', async () => {
  const clock = { ms: 0 }, getters: number[] = [];
  class Clock extends Date { override getTime(): number { return clock.ms; } }
  await withRig(100, {}, async (rig, host) => {
    Reflect.set(host.context, 'Date', Clock);
    host.project.item = index => { getters.push(index); clock.ms += 30; return host.itemAt(index - 1); };
    const first = await demandPage(rig, { target: INDEX, limit: 25 });
    assert.equal(fieldOf(first, 'data.state'), 'observed');
    assert.equal(listOf(first, 'data.page.rows').length, 1);
    assert.equal(fieldOf(first, 'data.page.nextCursor'), 2);
    assert.deepEqual(getters, [1]);
    const second = await demandPage(rig, { jobId: textOf(first, 'data.continuation.jobId'), limit: 25 });
    assert.equal(fieldOf(second, 'data.page.rows.0.itemIndex'), 2, 'the job continues where the host stopped');
    assert.deepEqual(getters, [1, 2]);
  });
});

test('browsing can begin at an arbitrary page without a scan of the earlier items, and a start past the end is the host\'s INVALID_CURSOR', async () => {
  await withRig(1500, {}, async (rig, host) => {
    const reads: number[] = [];
    host.project.item = index => { reads.push(index); return host.itemAt(index - 1); };
    const page = await demandPage(rig, { target: INDEX, startCursor: 1451, limit: 25 });
    assert.equal(fieldOf(page, 'data.page.rows.0.id'), '1451');
    assert.equal(fieldOf(page, 'data.page.nextCursor'), 1476);
    assert.deepEqual(reads, Array.from({ length: 25 }, (_, index) => 1451 + index));
    const bad = await demandPage(rig, { target: INDEX, startCursor: 1502 });
    assert.equal(codeOf(bad), 'INVALID_CURSOR');
    const again = await demandPage(rig, { target: INDEX, startCursor: 1451, limit: 25 });
    assert.equal(fieldOf(again, 'data.state'), 'observed', 'a refused start leaves nothing pinned');
  });
});
