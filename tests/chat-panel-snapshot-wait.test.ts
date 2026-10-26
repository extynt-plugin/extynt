/** Tests that a chat turn waits a bounded time for the paired panel's snapshot before it begins. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import type { ProbeSnapshot, SidecarOptions } from '../apps/sidecar/dist/src/server-types.js';
import { jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf } from '../apps/sidecar/dist/tests/http-json.js';
import { onlineHostLink } from '../apps/sidecar/dist/tests/sidecar-fixture.js';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';
import { MockProvider } from '../packages/llm/dist/src/index.js';

interface ChatBody {
  readonly requestId: string;
  readonly sessionId: string;
  readonly message: string;
  readonly history: readonly never[];
  readonly autoApply: boolean;
}

interface CallResult {
  readonly status: number;
  readonly body: JsonValue;
}

type Call = (path: string, body?: ProbeSnapshot | ChatBody, panel?: string) => Promise<CallResult>;

interface Fixture {
  readonly sidecar: ReadOnlySidecar;
  readonly systems: string[];
  readonly call: Call;
}

const token = 'chat-wait-token';
const snapshot: ProbeSnapshot = { schemaVersion: '0.1', ok: true, requestId: 'probe-1', warnings: [], result: {
  runtime: { application: 'After Effects', appVersion: '26.2.1', buildNumber: '2', buildName: 'After Effects 26.2.1 (Build 2)', platform: 'macOS', architecture: 'arm64', compatible: true },
  project: { name: 'Fixture', filePath: null }, activeCompositionId: 'comp-1', selectedLayerIds: [], compositions: [] } };

async function fixture(t: TestContext, options: Partial<SidecarOptions>): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-chat-wait-'));
  const systems: string[] = [];
  const provider = new MockProvider({ script: input => { systems.push(input.system); return { text: 'Done.', toolCalls: [] }; } });
  const sidecar = new ReadOnlySidecar({ port: 0, token, stateDirectory: directory, chatProvider: provider, quietAgentLog: true, ...options });
  sidecar.hostLink = onlineHostLink();
  const address = await sidecar.start(), base = `http://${address.host}:${address.port}`;
  t.after(async () => { await sidecar.stop(); rmSync(directory, { recursive: true, force: true }); });
  const call: Call = async (path, body, panel) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(panel ? { 'X-AE-Panel-Instance': panel } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: decodeOrThrow(jsonValue, await response.json()) };
  };
  return { sidecar, systems, call };
}
const chat = (f: Fixture, panel: string, id: string): Promise<CallResult> => f.call('/v1/chat', { requestId: id, sessionId: 's-' + id, message: 'rename the selected layer', history: [], autoApply: false }, panel);

test('a chat turn with no snapshot waits for the paired panel\'s refresh and then answers from that project, not from discovery', async t => {
  const f = await fixture(t, { panelSnapshotWaitMs: 5000 });
  assert.equal(fieldOf((await f.call('/v1/pair', undefined, 'panel-1')).body, 'paired'), true);
  const started = Date.now();
  const turn = chat(f, 'panel-1', 'waiting-turn');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(f.systems.length, 0, 'the turn is still waiting for the panel snapshot');
  assert.ok([200, 201].includes((await f.call('/v1/snapshots', snapshot, 'panel-1')).status));
  const answer = await turn;
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.ok(Date.now() - started >= 400, 'the turn waited for the snapshot');
  assert.ok(Date.now() - started < 4000, 'and proceeded as soon as it arrived');
  assert.doesNotMatch(f.systems[0] ?? '', /SIDECAR PREFETCH/, 'a turn with a snapshot is not a discovery turn');
});

test('the snapshot wait is bounded by panelSnapshotWaitMs and applies only to a paired panel', async t => {
  const unpaired = await fixture(t, { panelSnapshotWaitMs: 5000 });
  const early = Date.now();
  const refused = await chat(unpaired, 'nobody', 'unpaired-turn');
  assert.ok(Date.now() - early < 1500, 'no paired panel means nothing to wait for');
  assert.notEqual(refused.status, 500);
  const paired = await fixture(t, { panelSnapshotWaitMs: 600 });
  assert.equal(fieldOf((await paired.call('/v1/pair', undefined, 'panel-1')).body, 'paired'), true);
  const started = Date.now();
  const turn = chat(paired, 'panel-1', 'bounded-turn');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(paired.systems.length, 0, 'still inside the wait');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(Date.now() - started >= 600);
  assert.equal(paired.sidecar.agentMailbox.length, 1, 'after the wait the turn begins bounded discovery with its own index read');
  paired.sidecar.collection.cancel(); turn.catch(() => {});
});
