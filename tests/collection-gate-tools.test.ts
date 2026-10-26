/** Tests the collection gate through the agent tools: pending, cached, observed and stale outcomes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeOrThrow, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import type { CollectionToolDeps } from '../apps/sidecar/dist/src/collection-tools.js';
import { onlineHostLink } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { compareToolTranscript, dispatchRefOf, page } from './collection-gate-support.ts';
import type { Dispatch, Harness, ToolOutcome, ToolRunner } from './collection-gate-support.ts';

type DepsState = CollectionToolDeps['state'];
interface ToolRig {
  readonly state: { -readonly [Field in keyof DepsState]: DepsState[Field] };
  readonly transport: CollectionToolDeps['transport'];
}
interface ToolCall {
  readonly deps: ToolRig;
  readonly name: string;
  readonly args: JsonObject;
  readonly wait?: number;
  readonly signal?: AbortSignal;
}

function deps(h: Harness): ToolRig {
  return {
    state: {
      collection: h.service, activePanelInstanceId: 'panel', agentMailbox: [], options: { token: 'gate' }, inFlight: undefined,
      panel: { lastSeenAt: 0, busy: false, busyKind: null, busySinceAt: null, lastError: null }, hostLink: onlineHostLink(),
    },
    transport: { notifyChange() { h.emit('notify', () => true); }, async waitUntil(predicate, seconds) { h.emit('wait', () => ({ seconds, settled: predicate() })); return false; } },
  };
}
async function call(h: Harness, tool: ToolRunner, input: ToolCall): Promise<ToolOutcome> {
  const result = await tool(input.deps, input.name, input.args, { wait: input.wait ?? 0, signal: input.signal });
  h.emit('tool-result', () => result); h.emit('mailbox', () => input.deps.state.agentMailbox);
  return result;
}
function queuedDispatch(rig: ToolRig): Dispatch {
  return dispatchRefOf(decodeOrThrow(jsonValue, fieldOf(rig.state.agentMailbox[0], 'approvedData.dispatch')));
}
test('immutable tool transcript preserves pending, cache, observed and stale recovery', async () => {
  await compareToolTranscript(async (h, tool) => {
    const d = deps(h), first = await call(h, tool, { deps: d, name: 'ae_read_graph_page', args: { target: { kind: 'index' }, limit: 2 }, wait: 99 });
    assert.equal(fieldOf(first, 'data.recovery.action'), 'wait-for-existing-demand');
    const dispatch = queuedDispatch(d); h.admit(dispatch); h.finish(dispatch, page(dispatch));
    const observed = await call(h, tool, { deps: d, name: 'ae_get_graph_page', args: { demandId: dispatch.ticket } });
    assert.equal(fieldOf(observed, 'data.freshness'), 'observed');
    await call(h, tool, { deps: d, name: 'ae_query_graph_cache', args: { target: { kind: 'index' } } });
    h.time(16000); const stale = await call(h, tool, { deps: d, name: 'ae_get_graph_page', args: { demandId: dispatch.ticket } });
    assert.equal(fieldOf(stale, 'data.recovery.action'), 'demand-fresh-evidence');
    await call(h, tool, { deps: d, name: 'ae_get_graph_page', args: { demandId: 'missing' } });
  });
});
test('immutable no-wait tool result settles before a subsequent synchronous abort', async () => {
  await compareToolTranscript(async (h, tool) => {
    const d = deps(h), controller = new AbortController();
    const pending = tool(d, 'ae_read_graph_page', { target: { kind: 'index' } }, { wait: 0, signal: controller.signal });
    controller.abort(); const result = await pending; h.emit('tool-result', () => result); h.emit('mailbox', () => d.state.agentMailbox);
    assert.equal(fieldOf(result, 'ok'), true); assert.equal(fieldOf(result, 'data.state'), 'pending');
    const dispatch = queuedDispatch(d);
    assert.equal(h.service.hasUnsettled(dispatch.ticket), true); h.evidence(dispatch, { kind: 'index' });
  });
});
for (const admitted of [false, true]) test(`immutable tool abort preserves ${admitted ? 'admitted' : 'undispatched'} lease`, async () => {
  await compareToolTranscript(async (h, tool) => {
    const d = deps(h), controller = new AbortController();
    d.transport.waitUntil = async predicate => {
      const dispatch = queuedDispatch(d);
      if (admitted) h.admit(dispatch);
      controller.abort(); h.emit('wait-aborted', () => predicate()); return true;
    };
    const result = await call(h, tool, { deps: d, name: 'ae_read_graph_page', args: { target: { kind: 'index' } }, wait: 1, signal: controller.signal });
    const dispatch = queuedDispatch(d);
    assert.equal(fieldOf(result, 'error.code'), 'DEMAND_CANCELLED'); assert.equal(h.service.hasUnsettled(dispatch.ticket), admitted);
    h.evidence(dispatch, { kind: 'index' });
    await call(h, tool, { deps: d, name: 'ae_query_graph_cache', args: { target: { kind: 'index' } }, signal: controller.signal });
  });
});
for (const mode of ['panel', 'busy', 'write', 'mailbox', 'invalid-id', 'notify-error']) test(`immutable tool infrastructure failure ${mode}`, async () => {
  await compareToolTranscript(async (h, tool) => {
    const d = deps(h);
    if (mode === 'panel') d.state.activePanelInstanceId = undefined;
    if (mode === 'busy') d.state.panel.busy = true;
    if (mode === 'write') d.state.agentMailbox.push({ approvedData: { kind: 'apply_plan' } });
    if (mode === 'mailbox') d.state.agentMailbox = Array.from({ length: 128 }, () => ({ approvedData: { kind: 'other' } }));
    if (mode === 'notify-error') d.transport.notifyChange = () => { throw Error('TRANSPORT_UNAVAILABLE'); };
    const name = mode === 'invalid-id' ? 'ae_get_graph_page' : 'ae_read_graph_page';
    const result = await call(h, tool, { deps: d, name, args: { target: { kind: 'index' }, demandId: 3 } });
    assert.equal(fieldOf(result, 'ok'), false);
    h.emit('active-ticket', () => h.service.admittedNativeTicket());
  });
});
