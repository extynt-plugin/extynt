// The whole route, with nothing stood in for the lane: an external agent's `ae_read_graph_page` over the MCP endpoint, the sidecar's own
// host lane pumping the queued page to the fake plugin, and the real collection host script answering it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeRig } from '../apps/sidecar/dist/tests/native-rig.js';
import { fieldOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { PageRequest } from './collection-native-support.ts';
import { collectionEntries, simulatedHost } from './collection-native-support.ts';

test('an agent browses the project index page by page through the MCP route and the real host lane', async t => {
  const host = simulatedHost(60), rig = await nativeRig(t, { plugin: { hostCalls: collectionEntries(host) } });
  const rows: string[] = [];
  let args: PageRequest & { readonly waitSeconds: number } = { target: { kind: 'index' }, limit: 25, waitSeconds: 10 };
  for (let turn = 0; turn < 5; turn += 1) {
    const answer = await rig.agent('ae_read_graph_page', args);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(fieldOf(answer.body, 'data.state'), 'observed', JSON.stringify(fieldOf(answer.body, 'data')));
    rows.push(...recordsOf(answer.body, 'data.page.rows').map(row => textOf(row, 'id')));
    if (fieldOf(answer.body, 'data.continuation') === null) break;
    args = { jobId: textOf(answer.body, 'data.continuation.jobId'), limit: 25, waitSeconds: 10 };
    await rig.waitFor(() => rig.sidecar.inFlight === undefined);
  }
  assert.deepEqual(rows, Array.from({ length: 60 }, (_, index) => String(index + 1)));
  const pages = rig.plugin.requestsFor('host_call').filter(call => String(call.body.entry).startsWith('aeCollect'));
  assert.deepEqual(pages.map(call => call.body.entry), ['aeCollectIndexPage', 'aeCollectIndexPage', 'aeCollectIndexPage']);
  const completed = rig.logged.filter(entry => entry.event === 'host.collection').map(entry => entry.fields.completed);
  assert.deepEqual(completed, [true, true, true], 'each page was completed under its own ticket');
  assert.equal(rig.sidecar.nativeBridge.accessQuarantine(), null);
  assert.equal(rig.sidecar.collection.nativeAccessQuarantine(), null);
});
