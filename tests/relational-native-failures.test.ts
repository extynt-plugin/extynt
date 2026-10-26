// A corrupted native descriptor page and an unknown native revision, as the native lane's collection runner hands them to the sidecar.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fieldOf, listAt, recordsAt, textAt } from '../apps/panel/dist/tests/json-narrow.js';
import type { Found } from '../apps/panel/dist/tests/json-narrow.js';
import { isJsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { agentPage, relationalRig, sqlNumber } from './relational-native-agent.ts';

function corruptSecondDescriptor(page: JsonValue): JsonValue {
  const [first, second] = listAt(page, 'rows');
  if (!isJsonObject(page) || !isJsonObject(second) || first === undefined) return page;
  return { ...page, rows: [first, { ...second, propertyIndices: [0] }] };
}

function isDetailProperties(name: string, page: Found): boolean {
  return name === 'aeCollectDetailPage' && fieldOf(page, 'kind') === 'properties';
}

test('corrupted later native descriptor rejects the whole page and retires previously observed SQL evidence', async t => {
  const rig = await relationalRig(t);
  const valueTarget = { ...rig.host.target('values'), propertyIndices: [3, 1, 1], expectedStamp: rig.host.stamp() };
  const observed = await agentPage(rig, { target: valueTarget, limit: 1 });
  assert.equal(fieldOf(observed.native, 'rows', 0, 'value'), 4);
  const path = textAt(observed.completed.body, 'storage', 'path');
  rig.rewrite = (name, page) => isDetailProperties(name, page) ? corruptSecondDescriptor(page) : page;
  const failed = await agentPage(rig, { target: rig.host.target('properties'), limit: 2 });
  assert.equal(fieldOf(failed.native, 'ok'), true);
  assert.equal(listAt(failed.native, 'rows').length, 2);
  assert.equal(failed.completed.status, 409);
  assert.equal(fieldOf(failed.completed.body, 'error', 'code'), 'INVALID_COLLECTION_DESCRIPTOR');
  assert.equal(fieldOf(failed.observed, 'error', 'code'), 'INVALID_COLLECTION_DESCRIPTOR');
  const cached = await rig.tool('ae_query_graph_cache', { target: valueTarget, limit: 1 });
  assert.equal(fieldOf(cached.body, 'data', 'state'), 'unknown');
  assert.deepEqual(fieldOf(cached.body, 'data', 'rows'), []);
  const database = new DatabaseSync(path, { readOnly: true });
  t.after(() => database.close());
  assert.equal(sqlNumber(database, 'SELECT count(*) AS total FROM properties', 'total'), 0);
  assert.equal(sqlNumber(database, 'SELECT count(*) AS total FROM value_observations', 'total'), 1, 'historical values remain separate from retired current authority');
  assert.equal(rig.sidecar.inFlight, undefined, 'the lane is free for the next demand');
});

test('unknown native revision stays nonauthorizing and prevents metadata snapshot publication', async t => {
  const rig = await relationalRig(t);
  const published = rig.sidecar.latest?.snapshot.requestId;
  assert.ok(published);
  rig.host.project.revision = undefined;
  const layers = await agentPage(rig, { target: { kind: 'layers', compositionId: rig.host.comp.id, itemIndex: 1 }, limit: 25 });
  assert.equal(layers.completed.status, 200, JSON.stringify(layers.completed.body));
  assert.equal(fieldOf(layers.native, 'stamp', 'revision'), null);
  assert.equal(fieldOf(layers.completed.body, 'snapshot'), undefined);
  assert.equal(rig.sidecar.latest?.snapshot.requestId, published, 'no snapshot was published for the page');
  assert.equal(fieldOf(layers.observed, 'freshness'), 'unknown');
  assert.equal(fieldOf(layers.observed, 'writeAuthorizing'), false);
  const cached = await rig.tool('ae_query_graph_cache', { target: { kind: 'layers', compositionId: rig.host.comp.id }, limit: 25 });
  const rows = recordsAt(cached.body, 'data', 'rows');
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.state === 'unknown'));
  assert.equal(fieldOf(cached.body, 'data', 'writeAuthorizing'), false);
  assert.equal(rig.host.counters.setters, 0);
});
