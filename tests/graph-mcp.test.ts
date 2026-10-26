/** Tests graph reads through the MCP surface: bootstrap, paging compositions and declared properties. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import { claimAhead } from '../apps/sidecar/dist/src/host/read-claims.js';
import { createChatAgent } from '../apps/sidecar/dist/src/server-chat-agent.js';
import { runCollectionTool } from '../apps/sidecar/dist/src/collection-tools.js';
import type { ChatAgentInput } from '../apps/sidecar/dist/src/server-chat-agent-types.js';
import type { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import { sidecarFor, authorization, token } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { fieldOf, listOf, maybeTextOf, parseJson, readJson, recordOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { loadHostFiles, hostTextFunction } from '../apps/panel/dist/tests/host-sources.js';
import { decodeOrThrow, jsonObject, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';

interface HostLeaf { readonly name: string; readonly value: number }
interface HostLayer { readonly id: number; readonly name: string; property(n: number): HostLeaf }
interface NativeCalls { items: number; values: number }
interface Native { readonly calls: NativeCalls; readonly context: vm.Context }
interface Reply { readonly status: number; readonly body: JsonObject }
type Headers = Record<string, string>;
type Post = (path: string, body: JsonObject, headers?: Headers) => Promise<Reply>;
interface Rig {
  readonly host: Native;
  readonly sidecar: ReadOnlySidecar;
  readonly post: Post;
  readonly call: (name: string, args: JsonObject) => Promise<JsonObject>;
}

function observedLayer(calls: NativeCalls): HostLayer {
  const leaf = {
    name: 'Blurriness', matchName: 'ADBE Gaussian Blur 2-0001', numProperties: 0, numKeys: 0, propertyValueType: 1, expressionEnabled: false, expression: '',
    get value(): number { calls.values++; return 4; },
  };
  const layer = { id: 900, index: 1, name: 'Observed', locked: false, selected: false, numProperties: 1, property(n: number): HostLeaf { assert.equal(n, 1); return leaf; } };
  return layer;
}

function native(): Native {
  const calls: NativeCalls = { items: 0, values: 0 };
  const layer = observedLayer(calls);
  class CompItem {
    id: number; name: string; numLayers = 1; width = 1920; height = 1080; duration = 10; frameRate = 25;
    constructor(id: number) { this.id = id; this.name = `Comp ${id}`; }
    layer(n: number): HostLayer { assert.equal(n, 1); return layer; }
  }
  const comps = Array.from({ length: 300 }, (_, i) => new CompItem(i + 1));
  const project = { revision: 4, numItems: 300, item(n: number): CompItem | undefined { calls.items++; return comps[n - 1]; } };
  const app = { project, version: '26.2.1', buildNumber: 2 };
  const context = vm.createContext({ JSON, Array, CompItem, FolderItem: class {}, PropertyValueType: { OneD: 1 }, app, $: { os: 'Macintosh OS' } });
  loadHostFiles(context, 'host-shared.jsx');
  loadHostFiles(context, 'collection.jsx');
  return { calls, context };
}

async function startRig(t: TestContext): Promise<Rig> {
  const host = native(), sidecar = sidecarFor({ port: 0, token }), address = await sidecar.start();
  t.after(() => sidecar.stop());
  const base = `http://${address.host}:${address.port}`;
  const panel = { ...authorization, 'x-ae-panel-instance': 'graph-panel', 'content-type': 'application/json' };
  await fetch(base + '/v1/pair', { headers: panel });
  const post: Post = async (path, body, headers = panel) => {
    const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, body: decodeOrThrow(jsonObject, await readJson(response)) };
  };
  const agent = { ...authorization, 'x-ae-client': 'agent', 'content-type': 'application/json' };
  const call = async (name: string, args: JsonObject): Promise<JsonObject> =>
    (await post('/v1/mcp/tools/call', { name, arguments: { waitSeconds: 0, ...args } }, agent)).body;
  return { host, sidecar, post, call };
}

async function queue(rig: Rig, args: JsonObject): Promise<JsonObject> {
  const queued = await rig.call('ae_read_graph_page', args);
  assert.equal(fieldOf(queued, 'ok'), true, JSON.stringify(queued));
  assert.equal(fieldOf(queued, 'data.state'), 'pending');
  return queued;
}

async function serve(rig: Rig): Promise<void> {
  const claimed = claimAhead(rig.sidecar, rig.sidecar.now().getTime());
  assert.equal(claimed?.kind, 'collection_page', JSON.stringify(claimed));
  const dispatch = recordOf(claimed?.item, 'dispatch'), ticket = textOf(dispatch, 'ticket');
  assert.equal(fieldOf((await rig.post('/v1/collection/dispatch', { ticket })).body, 'ok'), true);
  const before = rig.host.calls.items, run = hostTextFunction(rig.host.context, textOf(dispatch, 'hostFunction'));
  const page = decodeOrThrow(jsonObject, parseJson(run(JSON.stringify(fieldOf(dispatch, 'hostRequest')))));
  assert.ok(rig.host.calls.items - before <= 25);
  assert.ok(listOf(page, 'rows').length <= 25);
  assert.equal((await rig.post('/v1/collection/complete', { ticket, page })).status, 200);
}

async function demand(rig: Rig, args: JsonObject): Promise<JsonObject> {
  const queued = await queue(rig, args);
  await serve(rig);
  const result = await rig.call('ae_get_graph_page', { demandId: textOf(queued, 'data.demandId') });
  assert.equal(fieldOf(result, 'data.state'), 'observed', JSON.stringify(result));
  assert.equal(fieldOf(result, 'data.writeAuthorizing'), false);
  return decodeOrThrow(jsonObject, fieldOf(result, 'data'));
}

const rowIds = (page: JsonObject): string[] => recordsOf(page, 'page.rows').map(row => textOf(row, 'id'));
const valueAt = (from: JsonObject, path: string): JsonValue => decodeOrThrow(jsonValue, fieldOf(from, path));
function continuation(page: JsonObject): JsonObject | undefined {
  const next = fieldOf(page, 'continuation');
  return next ? decodeOrThrow(jsonObject, next) : undefined;
}

async function pageAllCompositions(rig: Rig): Promise<void> {
  let page = await demand(rig, { target: { kind: 'index' } }), pages = 1;
  const ids = rowIds(page);
  for (let next = continuation(page); next; next = continuation(page)) {
    page = await demand(rig, next);
    ids.push(...rowIds(page));
    pages++;
  }
  assert.equal(pages, 12);
  assert.equal(ids.length, 300);
  assert.equal(new Set(ids).size, 300);
  assert.equal(ids[299], '300');
  assert.equal(rig.host.calls.values, 0);
}

async function acquireDeclared(rig: Rig): Promise<void> {
  const layers = await demand(rig, { target: { kind: 'layers', itemIndex: 300, compositionId: '300' } });
  assert.equal(fieldOf(layers, 'page.rows.0.id'), '900');
  const properties = await demand(rig, { target: { kind: 'properties', itemIndex: 300, compositionId: '300', layerIndex: 1, layerId: '900' } });
  assert.deepEqual(fieldOf(properties, 'page.rows.0.propertyIndices'), [1]);
  assert.equal(rig.host.calls.values, 0);
  const target = { kind: 'values', itemIndex: 300, compositionId: '300', layerIndex: 1, layerId: '900', propertyIndices: [1], expectedStamp: valueAt(properties, 'page.stamp') };
  const values = await demand(rig, { target });
  assert.equal(fieldOf(values, 'page.rows.0.value'), 4);
  assert.equal(rig.host.calls.values, 1);
  assert.equal(fieldOf(values, 'coverage.dependencyClosure'), 'unknown');
  const duplicate = await rig.post('/v1/collection/dispatch', { ticket: textOf(values, 'demandId') });
  assert.equal(duplicate.status, 409);
}

test('authenticated graph demands bootstrap, page 300 comps and acquire declared properties without a full snapshot', async t => {
  const rig = await startRig(t);
  await pageAllCompositions(rig);
  await acquireDeclared(rig);
});

const indexRequest: JsonObject = { begin: true, target: { kind: 'index' } };
const idOf = (reply: JsonObject): string => textOf(reply, 'ticket');

test('known invalidation makes completed demand stale and a timed-out read is retired by the next prepare', () => {
  let now = 0;
  const service = new CollectionService(() => now);
  service.pair('p');
  const d = service.demand(indexRequest, false), ticket = idOf(d);
  service.authorizeDispatch({ ticket });
  service.complete({ ticket, page: { ok: true, requestId: ticket, sessionId: 's', stamp: { epoch: 1, revision: null }, rows: [], nextCursor: null, deepComplete: false } });
  assert.equal(fieldOf(service.demandResult(ticket), 'evidence'), 'observational-revision-unavailable');
  service.invalidate();
  assert.equal(fieldOf(service.demandResult(ticket), 'freshness'), 'stale');
  const pending = idOf(service.demand(indexRequest, false));
  now = 60001;
  assert.equal(fieldOf(service.demandResult(pending), 'error.code'), 'DEMAND_TIMEOUT');
  assert.equal(service.hasUnsettled(pending), true);
  const next = idOf(service.prepare(indexRequest, false));
  assert.notEqual(next, pending);
  assert.equal(service.hasUnsettled(pending), false);
  assert.equal(fieldOf(service.demandResult(pending), 'error.code'), 'COLLECTION_TIMED_OUT');
  assert.equal(service.nativeAccessQuarantine(), null);
});

test('cancelled and duplicate tickets cannot be admitted for native dispatch', () => {
  const service = new CollectionService();
  service.pair('p');
  const ticket = idOf(service.demand(indexRequest, false));
  assert.equal(fieldOf(service.authorizeDispatch({ ticket }), 'ok'), true);
  assert.throws(() => service.authorizeDispatch({ ticket }), /STALE_COLLECTION_TICKET/);
  service.cancel();
  assert.equal(service.dispatchCurrent(ticket), false);
  assert.throws(() => service.authorizeDispatch({ ticket }), /STALE_COLLECTION_TICKET/);
  assert.equal(service.hasUnsettled(ticket), true);
});

test('internal agent and external MCP share bounded graph infrastructure, with cancellation before dispatch', async t => {
  const sidecar = sidecarFor({ port: 0, token }), service = sidecar.collection, controller = new AbortController();
  service.pair('p');
  sidecar.activePanelInstanceId = 'p';
  t.after(() => sidecar.stop());
  const transport = {
    notifyChange(): void {},
    async waitUntil(predicate: () => boolean, seconds: number): Promise<boolean> { assert.ok(seconds <= 20); controller.abort(); return predicate(); },
  };
  const agent = createChatAgent({
    state: sidecar, applyRuntime: sidecar, chatSupport: sidecar, delivery: sidecar, focus: sidecar,
    planLog: sidecar, planState: sidecar, planView: sidecar, transport, workflowAdmission: sidecar,
  });
  const input: ChatAgentInput = { requestId: 'r', message: '', history: [], autoApply: false, workflowJobId: 'job', signal: controller.signal };
  const result = await agent.runNativeAgentTool('ae_read_graph_page', { target: { kind: 'index' } }, input);
  assert.equal(fieldOf(result, 'error.code'), 'DEMAND_CANCELLED');
  assert.equal(sidecar.agentMailbox.length, 1);
  const ticket = textOf(sidecar.agentMailbox[0]?.approvedData, 'dispatch.ticket');
  assert.equal(service.dispatchCurrent(ticket), false);
  assert.equal(service.hasUnsettled(ticket), false);
  assert.ok(idOf(service.demand(indexRequest, false)));
});

test('result cache evicts completed demands after sixteen entries without blocking further discovery', () => {
  const service = new CollectionService();
  service.pair('p');
  const tickets: string[] = [];
  for (let i = 0; i < 40; i++) {
    const ticket = idOf(service.demand(indexRequest, false));
    tickets.push(ticket);
    service.authorizeDispatch({ ticket });
    service.complete({ ticket, page: { ok: true, requestId: ticket, sessionId: 's' + i, stamp: { epoch: 1, revision: 1 }, rows: [], nextCursor: null, deepComplete: false } });
  }
  assert.equal(fieldOf(service.demandResult(tickets[0] ?? ''), 'error.code'), 'DEMAND_NOT_FOUND');
});

test('unadmitted completion cannot release a reserved ticket', () => {
  const service = new CollectionService();
  service.pair('p');
  const ticket = idOf(service.prepare(indexRequest, false));
  assert.throws(() => service.complete({ ticket, page: { ok: true } }), /COLLECTION_NOT_ADMITTED/);
  assert.equal(service.hasUnsettled(ticket), true);
  service.authorizeDispatch({ ticket });
  assert.equal(service.dispatchCurrent(ticket), true);
});

test('queued approved writes apply backpressure before a new graph demand is queued', async t => {
  const sidecar = sidecarFor({ port: 0, token });
  sidecar.collection.pair('p');
  sidecar.activePanelInstanceId = 'p';
  sidecar.agentMailbox.push({ planId: 'approved', approvedData: { kind: 'apply_plan' } });
  t.after(() => sidecar.stop());
  const transport = { notifyChange(): void {}, async waitUntil(): Promise<boolean> { return true; } };
  const result = await runCollectionTool({ state: sidecar, transport }, 'ae_read_graph_page', { target: { kind: 'index' } }, { wait: 0 });
  assert.equal(maybeTextOf(result, 'error.code'), 'COLLECTION_BUSY');
  assert.equal(sidecar.agentMailbox.length, 1);
});
