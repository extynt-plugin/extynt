// Bounded descriptor and value pages demanded through the native lane, the SQLite relations they persist, and invalidation by a native edit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fieldOf, listAt, recordsAt, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import type { Found } from '../apps/panel/dist/tests/json-narrow.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { agentPage, relationalRig, sqlNumber } from './relational-native-agent.ts';
import type { Rig } from './relational-native-rig.ts';

async function descriptorPages(rig: Rig, target: JsonObject): Promise<JsonObject[]> {
  const rows: JsonObject[] = [];
  let jobId: Found;
  let cursor: Found = 1;
  do {
    const page = await agentPage(rig, jobId ? { jobId, limit: 2 } : { target, limit: 2 });
    assert.equal(fieldOf(page.native, 'ok'), true, JSON.stringify(page.native));
    assert.equal(page.completed.status, 200, JSON.stringify(page.completed.body));
    assert.ok(listAt(page.native, 'rows').length <= 2);
    assert.equal(fieldOf(page.observed, 'writeAuthorizing'), false);
    assert.equal(fieldOf(page.observed, 'coverage', 'dependencyClosure'), 'unknown');
    assert.equal(fieldOf(page.observed, 'page', 'deepComplete'), false);
    rows.push(...recordsAt(page.native, 'rows'));
    jobId = page.jobId;
    cursor = fieldOf(page.native, 'nextCursor');
  } while (cursor !== null);
  return rows;
}

test('agent demand executes bounded shipped native descriptor pages and persists real SQLite relations', async t => {
  const rig = await relationalRig(t);
  const target = rig.host.target('properties');
  const rows = await descriptorPages(rig, target);
  assert.ok(rows.some(row => row.matchName === 'ADBE Gaussian Blur 2-0002'));
  assert.ok(rows.some(row => row.matchName === 'SYN Control 30'));
  assert.equal(rig.host.counters.values, 0, 'descriptors must not invoke native value getters');
  assert.equal(rig.host.counters.keys, 0);
  const cached = await rig.tool('ae_query_graph_cache', { target, limit: 2 });
  assert.equal(cached.status, 200, JSON.stringify(cached.body));
  assert.equal(listAt(cached.body, 'data', 'rows').length, 2);
  assert.equal(fieldOf(cached.body, 'data', 'writeAuthorizing'), false);
  assert.equal(fieldOf(cached.body, 'data', 'coverage', 'absentOutsidePage'), 'unknown');
  const coverage = await rig.tool('ae_query_relational_graph', { query: { kind: 'coverage', compositionId: target.compositionId, layerId: target.layerId } });
  assert.equal(coverage.status, 200, JSON.stringify(coverage.body));
  const scope = recordsAt(coverage.body, 'data', 'rows').find(row => row.kind === 'properties');
  assert.deepEqual({ ...scope }, { ...scope, descriptorState: 'observed-end', valueState: 'not-read', keyMetadata: 'not-read', dependencyClosure: 'unknown', completeMirror: 'not-established', absentOutsidePage: 'unknown', writeAuthorizing: false });
  const database = new DatabaseSync(textAt(cached.body, 'data', 'storage', 'path'), { readOnly: true });
  t.after(() => database.close());
  assert.equal(sqlNumber(database, 'SELECT count(*) AS total FROM properties', 'total'), rows.length);
  assert.ok(sqlNumber(database, 'SELECT count(*) AS total FROM property_indices', 'total') > rows.length);
  const pageCalls = rig.calls.filter(call => call.entry === 'aeCollectDetailPage').length;
  assert.equal(rig.completions.length, pageCalls, 'every plugin call completed exactly one ticket and none was retried');
  assert.equal(rig.sidecar.inFlight, undefined, 'the lane is free once every demanded page has settled');
  assert.equal(rig.sidecar.panel.busy, false);
});

test('actual native value demands keep enabled expressions unknown and preserve underlying keys separately', async t => {
  const rig = await relationalRig(t);
  const target = rig.host.target('values');
  const stamp = rig.host.stamp();
  const expressed = await agentPage(rig, { target: { ...target, propertyIndices: [3, 2, 2], expectedStamp: stamp }, limit: 2 });
  assert.equal(expressed.completed.status, 200, JSON.stringify(expressed.completed.body));
  assert.equal(fieldOf(expressed.native, 'rows', 0, 'valueState'), 'unknown');
  assert.equal(fieldOf(expressed.native, 'rows', 0, 'value'), null);
  assert.equal(rig.host.counters.values, 0);
  const keyed = await agentPage(rig, { target: { ...target, propertyIndices: [3, 2, 3], expectedStamp: stamp }, limit: 1 });
  assert.equal(fieldOf(keyed.native, 'rows', 0, 'valueState'), 'observed-key-value');
  assert.equal(fieldOf(keyed.native, 'rows', 0, 'time'), 0);
  assert.equal(fieldOf(keyed.native, 'rows', 0, 'value'), 3);
  const second = await agentPage(rig, { jobId: keyed.jobId, limit: 1 });
  assert.equal(fieldOf(second.native, 'rows', 0, 'time'), 1);
  assert.equal(fieldOf(second.native, 'rows', 0, 'value'), 9);
  assert.equal(rig.host.counters.keys, 2);
  assert.equal(rig.host.counters.values, 0);
  assert.equal(fieldOf(second.observed, 'writeAuthorizing'), false);
  assert.equal(fieldOf(second.native, 'nextCursor'), null);
});

test('native edit after a query invalidates retained SQL on the next guarded bounded demand', async t => {
  const rig = await relationalRig(t);
  const target = { ...rig.host.target('values'), propertyIndices: [3, 1, 1], expectedStamp: rig.host.stamp() };
  const first = await agentPage(rig, { target, limit: 1 });
  assert.equal(fieldOf(first.native, 'rows', 0, 'value'), 4);
  rig.host.edit(7);
  const stale = await agentPage(rig, { target, limit: 1 });
  assert.equal(fieldOf(stale.native, 'ok'), false);
  assert.equal(stale.completed.status, 409);
  assert.equal(fieldOf(stale.observed, 'state'), 'unknown');
  const cached = await rig.tool('ae_query_graph_cache', { target, limit: 1 });
  assert.equal(fieldOf(cached.body, 'data', 'state'), 'unknown');
  assert.deepEqual(fieldOf(cached.body, 'data', 'rows'), []);
  assert.equal(rig.host.counters.setters, 1, 'only the simulated manual edit ran a setter');
});
