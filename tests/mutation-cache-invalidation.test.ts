/** Tests that native undo and apply admission invalidate typed observations and settlement never revives them. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeOrThrow, jsonObject, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import { NativeBridgeLease } from '../apps/sidecar/dist/src/native-bridge-lease.js';
import { fieldOf, numberOf, parseJson, readJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';

const target = { kind: 'index' };
const panel = 'synthetic-panel';
const identity = { project: { name: 'Saved.aep', filePath: '/synthetic/Saved.aep' }, runtime: { appVersion: '26.2', platform: 'macOS' } };

interface Reply { readonly status: number; readonly body: JsonValue }
type Headers = Readonly<Record<string, string>>;
type Call = (path: string, body?: JsonValue, headers?: Headers) => Promise<Reply>;
interface Fixture {
  readonly sidecar: ReadOnlySidecar;
  readonly directory: string;
  readonly call: Call;
  query(): Promise<JsonValue>;
  journal(): JsonValue;
  retainedCount(): number;
}

function createCall(endpoint: string): Call {
  return async (path, body, headers = {}) => {
    const response = await fetch(endpoint + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json', 'X-AE-Panel-Instance': panel, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: decodeOrThrow(jsonValue, await readJson(response)) };
  };
}

function leaseOf(reply: Reply): JsonObject {
  return decodeOrThrow(jsonObject, fieldOf(reply.body, 'lease'));
}

function countRetainedNodes(sidecar: ReadOnlySidecar, directory: string): number {
  const path = textOf(sidecar.collection.storageStatus(), 'path');
  assert.ok(path.startsWith(directory + '/'));
  const db = new DatabaseSync(path, { readOnly: true });
  try { return numberOf(db.prepare('SELECT count(*) AS total FROM nodes').get(), 'total'); } finally { db.close(); }
}

async function fixture(t: TestContext): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-mutation-cache-'));
  const sidecar = new ReadOnlySidecar({ port: 0, token: 'synthetic-token', stateDirectory: directory });
  t.after(async () => { await sidecar.stop(); rmSync(directory, { recursive: true, force: true }); });
  const address = await sidecar.start();
  const call = createCall(`http://${address.host}:${address.port}`);
  assert.equal(fieldOf((await call('/v1/pair')).body, 'paired'), true);
  const query = async (): Promise<JsonValue> => decodeOrThrow(jsonValue, fieldOf((await call('/v1/mcp/tools/call', { name: 'ae_query_graph_cache', arguments: { target } })).body, 'data'));
  const journal = (): JsonValue => decodeOrThrow(jsonValue, parseJson(readFileSync(join(directory, 'native-bridge-lease.json'), 'utf8')));
  return { sidecar, directory, call, query, journal, retainedCount: () => countRetainedNodes(sidecar, directory) };
}

async function collect(f: Fixture, revision = 4): Promise<string> {
  const dispatch = f.sidecar.collection.demand({ begin: true, target }, false);
  const ticket = textOf(dispatch, 'ticket');
  assert.equal((await f.call('/v1/collection/dispatch', { ticket })).status, 200);
  const reserved = await f.call('/v1/native-bridge/reserve', { requestId: ticket, kind: 'read', collectionTicket: ticket });
  assert.equal(reserved.status, 200);
  assert.equal((await f.call('/v1/native-bridge/settle', { lease: leaseOf(reserved), outcome: 'callback-received' })).status, 200);
  const page = { ...identity, ok: true, requestId: ticket, sessionId: `index-${revision}`, stamp: { epoch: 1, revision },
    rows: [{ id: '7', name: 'Only Composition', itemIndex: 1, type: 'composition', parentFolderId: '0', layers: 0 }], nextCursor: null, deepComplete: false };
  assert.equal((await f.call('/v1/collection/complete', { ticket, page })).status, 200);
  assert.equal(fieldOf(await f.query(), 'rows.0.freshness'), 'observed');
  return ticket;
}

async function mutationBoundary(t: TestContext, kind: 'undo_plan' | 'apply_plan'): Promise<void> {
  const f = await fixture(t), demandId = await collect(f);
  f.sidecar.inFlight = { kind, id: 'approved-plan', claimedAt: Date.now() };
  const reserved = await f.call('/v1/native-bridge/reserve', { requestId: `native-${kind}`, kind: 'mutation' });
  assert.equal(reserved.status, 200);
  assert.equal(fieldOf(f.journal(), 'active.identity.kind'), 'mutation');
  assert.deepEqual(fieldOf(f.journal(), 'active.logicalOwner'), { kind, id: 'approved-plan' });
  assert.equal(fieldOf(await f.query(), 'state'), 'unknown', 'Native mutation admission must retire current graph evidence before the ACK');
  assert.equal(fieldOf(f.sidecar.collection.demandResult(demandId), 'freshness'), 'stale');
  assert.equal(f.retainedCount(), 1, 'Invalidation must retain typed historical observations');
  const restartedLease = new NativeBridgeLease(f.directory);
  assert.equal(textOf(restartedLease.accessQuarantine(), 'accessKind'), 'mutation');
  const invalid = await f.call('/v1/native-bridge/settle', { lease: { ...leaseOf(reserved), settlementToken: 'wrong-token' }, outcome: 'callback-received' });
  assert.equal(invalid.status, 409); assert.equal(fieldOf(f.journal(), 'active.identity.leaseId'), textOf(leaseOf(reserved), 'leaseId'));
  assert.equal((await f.call('/v1/native-bridge/settle', { lease: leaseOf(reserved), outcome: 'callback-received' })).status, 200);
  assert.equal(fieldOf(f.journal(), 'active'), null); assert.equal(fieldOf(await f.query(), 'state'), 'unknown');
  const duplicate = await f.call('/v1/native-bridge/settle', { lease: leaseOf(reserved), outcome: 'callback-received' });
  assert.equal(fieldOf(duplicate.body, 'idempotent'), true); assert.equal(fieldOf(await f.query(), 'state'), 'unknown');
  f.sidecar.inFlight = undefined;
  await collect(f, 5);
  assert.equal(fieldOf(f.sidecar.collection.demandResult(demandId), 'freshness'), 'stale');
}

test('Undo native admission invalidates typed observations and exact settlement never revives them', (t: TestContext) => mutationBoundary(t, 'undo_plan'));
test('apply native admission invalidates typed observations without deleting retained typed rows', (t: TestContext) => mutationBoundary(t, 'apply_plan'));

test('native-not-started after mutation admission preserves conservative stale evidence', async (t: TestContext) => {
  const f = await fixture(t), demandId = await collect(f);
  const reserved = await f.call('/v1/native-bridge/reserve', { requestId: 'never-started', kind: 'mutation' });
  assert.equal(reserved.status, 200); assert.equal(fieldOf(await f.query(), 'state'), 'unknown');
  const settled = await f.call('/v1/native-bridge/settle', { lease: leaseOf(reserved), outcome: 'native-not-started' });
  assert.equal(settled.status, 200); assert.equal(fieldOf(f.journal(), 'active'), null);
  assert.equal(fieldOf(await f.query(), 'state'), 'unknown'); assert.equal(fieldOf(f.sidecar.collection.demandResult(demandId), 'freshness'), 'stale');
  assert.equal(f.retainedCount(), 1); assert.equal(f.sidecar.receipts.length, 0);
});

test('read admission retains current cache and an admitted collection rejects mutation without losing its exact ticket', async (t: TestContext) => {
  const f = await fixture(t), previous = await collect(f);
  const ticket = textOf(f.sidecar.collection.demand({ begin: true, target }, false), 'ticket');
  await f.call('/v1/collection/dispatch', { ticket });
  const rejected = await f.call('/v1/native-bridge/reserve', { requestId: 'undo-while-reading', kind: 'mutation' });
  assert.equal(rejected.status, 409); assert.equal(fieldOf(rejected.body, 'error.code'), 'COLLECTION_BUSY');
  assert.equal(fieldOf(rejected.body, 'nativeAdmission'), 'refused'); assert.equal(fieldOf(f.journal(), 'active'), null);
  assert.equal(f.sidecar.collection.admittedNativeTicket(), ticket);
  assert.equal(fieldOf(f.sidecar.collection.demandResult(ticket), 'state'), 'pending');
  assert.equal(fieldOf(f.sidecar.collection.demandResult(previous), 'freshness'), 'observed');
  const reserved = await f.call('/v1/native-bridge/reserve', { requestId: ticket, kind: 'read', collectionTicket: ticket });
  assert.equal(reserved.status, 200); assert.equal(fieldOf(await f.query(), 'rows.0.freshness'), 'observed');
  assert.equal(f.sidecar.collection.admittedNativeTicket(), ticket);
  assert.equal((await f.call('/v1/native-bridge/settle', { lease: leaseOf(reserved), outcome: 'callback-received' })).status, 200);
  assert.equal(f.sidecar.collection.admittedNativeTicket(), ticket, 'Durable settlement retains healthy reads until their validated page');
  const page = { ...identity, ok: true, requestId: ticket, sessionId: 'index-continued', stamp: { epoch: 1, revision: 4 }, rows: [], nextCursor: null, deepComplete: false };
  assert.equal((await f.call('/v1/collection/complete', { ticket, page })).status, 200);
  assert.equal(f.sidecar.collection.hasUnsettled(ticket), false);
  assert.equal(f.sidecar.collection.nativeAccessQuarantine(), null);
  assert.equal(fieldOf(f.journal(), 'active'), null);
  assert.equal(fieldOf(await f.query(), 'rows.0.freshness'), 'observed');
});

test('auth failures and refused reservations never report a mutation or invalidate a healthy cache; a newer read replaces an unsettled read lease', async (t: TestContext) => {
  const f = await fixture(t); await collect(f);
  const body = { requestId: 'unauthorized-mutation', kind: 'mutation' };
  assert.equal((await f.call('/v1/native-bridge/reserve', body, { Authorization: '' })).status, 401);
  const stale = await f.call('/v1/native-bridge/reserve', body, { 'X-AE-Panel-Instance': 'stale-panel' });
  assert.equal(stale.status, 409); assert.equal(fieldOf(stale.body, 'nativeAdmission'), 'refused');
  assert.equal((await f.call('/v1/native-bridge/reserve', { ...body, extra: 'invalid' })).status, 409);
  const read = await f.call('/v1/native-bridge/reserve', { requestId: 'pulse', kind: 'read' });
  assert.equal(read.status, 200); assert.equal(fieldOf(await f.query(), 'rows.0.freshness'), 'observed');
  const replacing = await f.call('/v1/native-bridge/reserve', { requestId: 'pulse-2', kind: 'read' });
  assert.equal(replacing.status, 200, 'an unsettled read cannot change the project, so the next read replaces its lease');
  assert.equal(fieldOf(f.journal(), 'active.identity.requestId'), 'pulse-2'); assert.equal(fieldOf(f.journal(), 'active.identity.kind'), 'read');
  assert.equal(fieldOf(await f.query(), 'rows.0.freshness'), 'observed'); assert.equal(f.sidecar.receipts.length, 0);
  assert.equal(f.sidecar.collection.nativeAccessQuarantine(), null);
  const lateOld = await f.call('/v1/native-bridge/settle', { lease: leaseOf(read), outcome: 'callback-received' });
  assert.equal(lateOld.status, 409, 'the replaced lease can no longer settle');
  assert.equal(fieldOf(f.journal(), 'active.identity.requestId'), 'pulse-2', 'and cannot clear its successor');
  assert.equal((await f.call('/v1/native-bridge/settle', { lease: leaseOf(replacing), outcome: 'callback-received' })).status, 200);
  assert.equal(fieldOf(await f.query(), 'rows.0.freshness'), 'observed');
});

test('a mutation reservation replaces an unsettled read lease, invalidates evidence once, and then refuses every other reservation as busy', async (t: TestContext) => {
  const f = await fixture(t); await collect(f);
  const read = await f.call('/v1/native-bridge/reserve', { requestId: 'pulse', kind: 'read' });
  assert.equal(read.status, 200);
  const mutation = await f.call('/v1/native-bridge/reserve', { requestId: 'native-mutation', kind: 'mutation' });
  assert.equal(mutation.status, 200); assert.equal(fieldOf(f.journal(), 'active.identity.kind'), 'mutation');
  assert.equal(fieldOf(await f.query(), 'state'), 'unknown', 'the admitted mutation retires current graph evidence');
  for (const kind of ['read', 'mutation']) {
    const busy = await f.call('/v1/native-bridge/reserve', { requestId: `after-${kind}`, kind });
    assert.equal(busy.status, 409); assert.equal(fieldOf(busy.body, 'error.code'), 'NATIVE_BRIDGE_BUSY'); assert.equal(fieldOf(busy.body, 'nativeAdmission'), 'refused');
    assert.equal(fieldOf(f.journal(), 'active.identity.requestId'), 'native-mutation');
  }
  assert.equal((await f.call('/v1/native-bridge/settle', { lease: leaseOf(read), outcome: 'callback-received' })).status, 409, 'the replaced read cannot settle the mutation');
  assert.equal(fieldOf(f.journal(), 'active.identity.requestId'), 'native-mutation');
});
