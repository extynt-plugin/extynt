/** Tests the effect-notes tools over HTTP and chat dispatch for external and in-panel agents. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { agentToolDefinitions, listTools, TOOL_DEFINITIONS } from '../packages/mcp-server/dist/src/index.js';
import { decodeOrThrow, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import { fieldOf, flagOf, listOf, numberOf, readJson, recordsOf, textOf, textsOf } from '../apps/sidecar/dist/tests/http-json.js';
import { isCollectionTool, runChatCollectionTool } from '../apps/sidecar/dist/src/collection-tools.js';
import { census, HOST_KEY } from './catalogue-support.ts';
import { controlPath, glowControls, present, probeResult, succeeded } from './effect-notes-support.ts';

const GLOW = 'ADBE Glo2', AMOUNT = controlPath(GLOW, 1), TOKEN = 'notes-token';

interface HttpAnswer { readonly status: number; readonly body: JsonValue }
type HeaderSet = Readonly<Record<string, string>>;
interface HttpHarness {
  readonly sidecar: ReadOnlySidecar;
  readonly directory: string;
  readonly base: string;
  readonly headers: HeaderSet;
  tool(name: string, args: JsonObject, extra?: HeaderSet): Promise<HttpAnswer>;
  panel(method: string, path: string, body?: JsonObject, extra?: HeaderSet): Promise<HttpAnswer>;
}

async function answerOf(response: Response): Promise<HttpAnswer> {
  return { status: response.status, body: decodeOrThrow(jsonValue, await readJson(response)) };
}

async function sidecarHarness(t: TestContext): Promise<HttpHarness> {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-notes-http-'));
  const sidecar = new ReadOnlySidecar({ port: 0, token: TOKEN, stateDirectory: directory, quietAgentLog: true });
  t.after(async () => { try { await sidecar.stop(); } catch { } rmSync(directory, { recursive: true, force: true }); });
  const address = await sidecar.start(), base = `http://${address.host}:${address.port}`;
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-AE-Panel-Instance': 'panel-1' };
  await fetch(`${base}/v1/pair`, { headers });
  assert.equal((await fetch(`${base}/v1/host-census`, { method: 'POST', headers, body: JSON.stringify(census([GLOW, 'ADBE Blur'])) })).status, 201);
  sidecar.collection.writeCatalogueProbe([GLOW, 'ADBE Blur'].map(name => ({
    hostKey: HOST_KEY, runId: 'run-1', observedAt: 5, hostBuild: '2', version: 'v1', effect: probeResult(name, glowControls(name)),
  })));
  return {
    sidecar, directory, base, headers,
    tool: async (name, args, extra = {}) => answerOf(await fetch(`${base}/v1/mcp/tools/call`, {
      method: 'POST', headers: { ...headers, 'X-AE-Client': 'agent', ...extra }, body: JSON.stringify({ name, arguments: args }),
    })),
    panel: async (method, path, body, extra = {}) => answerOf(await fetch(`${base}${path}`, {
      method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })),
  };
}

test('both tools are on the in-panel agent surface, external agents are listed only the read, and only the write is not read-only', () => {
  for (const name of ['ae_read_effect_notes', 'ae_write_effect_note']) {
    assert.ok(TOOL_DEFINITIONS.some(tool => tool.name === name), name);
    assert.equal(listTools('agent').some(tool => tool.name === name), name === 'ae_read_effect_notes', `${name}: external clients are listed the read, not the write`);
    assert.ok(agentToolDefinitions().some(tool => tool.name === name), `${name} reaches the in-panel agent`);
    assert.equal(isCollectionTool(name), true, `${name} dispatches in the sidecar beside the relational tools`);
  }
  const read = present(listTools().find(tool => tool.name === 'ae_read_effect_notes'));
  const write = present(listTools().find(tool => tool.name === 'ae_write_effect_note'));
  assert.equal(read.annotations.readOnlyHint, true); assert.equal(write.annotations.readOnlyHint, undefined);
  for (const definition of [read, write]) assert.match(definition.description, /never authorizes? a write/);
  assert.match(write.description, /never overrides? observed facts/); assert.match(write.description, /Not a project write/);
  assert.deepEqual(write.inputSchema.required, ['matchName', 'text', 'expectedNoteIds']);
  assert.equal('kind' in (write.inputSchema.properties ?? {}), false, 'no MCP write for measured notes');
});

test('an external agent reads and writes notes through the sidecar, without a snapshot or an approval', async t => {
  const harness = await sidecarHarness(t);
  const read = await harness.tool('ae_read_effect_notes', { matchName: GLOW });
  assert.equal(read.status, 200); assert.equal(fieldOf(read.body, 'ok'), true);
  assert.equal(recordsOf(read.body, 'data.observed.controls').some(control => control.controlPath === AMOUNT), true);
  assert.equal(fieldOf(read.body, 'data.writeAuthorizing'), false);
  const off = await harness.tool('ae_write_effect_note', { matchName: GLOW, text: 'x', expectedNoteIds: [] });
  assert.equal(off.status, 422); assert.equal(fieldOf(off.body, 'error.code'), 'EFFECT_NOTES_DOCUMENTATION_OFF');
  assert.equal((await harness.panel('POST', '/v1/notes/plugins', { pluginKey: 'Synthetic', enabled: true })).status, 200);
  const written = await harness.tool('ae_write_effect_note', { matchName: GLOW, controlPath: AMOUNT, text: 'Amount sets glow strength.', value: 40, expectedNoteIds: [], kind: 'measured' });
  assert.equal(written.status, 200); assert.equal(fieldOf(written.body, 'data.written.kind'), 'agent-inferred', 'a caller cannot choose the kind');
  const stale = await harness.tool('ae_write_effect_note', { matchName: GLOW, text: 'again', expectedNoteIds: [] });
  assert.equal(stale.status, 422); assert.equal(fieldOf(stale.body, 'error.code'), 'EFFECT_NOTES_STALE'); assert.equal(listOf(stale.body, 'error.current.notes').length, 1);
  const again = await harness.tool('ae_read_effect_notes', { matchName: GLOW, controlPath: AMOUNT });
  assert.deepEqual(textsOf(again.body, 'data.noteIds'), [textOf(written.body, 'data.written.id')]);
  assert.equal(fieldOf(await harness.tool('ae_read_effect_notes', { matchName: 'Nope' }).then(answer => answer.body), 'error.code'), 'EFFECT_NOTES_UNKNOWN_EFFECT');
  assert.equal(harness.sidecar.plans.size, 0, 'no plan, approval or native work was created');
});

test('the in-panel agent reaches the same tools through the chat dispatch', async t => {
  const harness = await sidecarHarness(t);
  succeeded(harness.sidecar.collection.effectNotes.setPluginOptIn({ pluginKey: 'Synthetic', enabled: true }));
  const deps = { state: harness.sidecar, transport: { notifyChange() {}, waitUntil: async () => true } };
  const input = { requestId: 'chat-1' };
  const read = await runChatCollectionTool(deps, 'ae_read_effect_notes', { matchName: GLOW }, input);
  assert.equal(read.ok, true); assert.deepEqual(listOf(read, 'data.noteIds'), []);
  const written = await runChatCollectionTool(deps, 'ae_write_effect_note', { matchName: GLOW, text: 'From the panel agent.', expectedNoteIds: textsOf(read, 'data.noteIds') }, input);
  assert.equal(written.ok, true); assert.equal(listOf(written, 'data.notes').length, 1);
  const refused = await runChatCollectionTool(deps, 'ae_write_effect_note', { matchName: GLOW, text: 'Stale.', expectedNoteIds: [] }, input);
  assert.equal(refused.ok, false); assert.equal(fieldOf(refused, 'error.code'), 'EFFECT_NOTES_STALE'); assert.equal(listOf(refused, 'error.current.noteIds').length, 1);
});

test('panel routes need the paired panel instance', async t => {
  const harness = await sidecarHarness(t);
  const routes = [['GET', '/v1/notes/settings'], ['POST', '/v1/notes/learn-from-work'], ['POST', '/v1/notes/plugins'], ['GET', '/v1/notes/history'],
    ['POST', '/v1/notes/forget'], ['POST', '/v1/notes/restore'], ['POST', '/v1/notes/usage/forget']] as const;
  for (const [method, path] of routes) {
    const stranger = await harness.panel(method, path, method === 'POST' ? {} : undefined, { 'X-AE-Panel-Instance': 'someone-else' });
    assert.equal(stranger.status, 409, path); assert.equal(fieldOf(stranger.body, 'error.code'), 'STALE_PANEL_INSTANCE');
    const missing = await fetch(`${harness.base}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(missing.status, 409, `${path} without a panel header`);
  }
  const unauthenticated = await fetch(`${harness.base}/v1/notes/settings`, { headers: { 'X-AE-Panel-Instance': 'panel-1' } });
  assert.notEqual(unauthenticated.status, 200);
});

async function exerciseSettings(harness: HttpHarness): Promise<void> {
  const { panel } = harness, usage = { planId: 'p', matchName: GLOW, controlPath: AMOUNT, value: 3 };
  const settings = await panel('GET', '/v1/notes/settings');
  assert.equal(settings.status, 200); assert.equal(flagOf(settings.body, 'learnFromWork'), true); assert.deepEqual(fieldOf(settings.body, 'optedIn'), []);
  assert.deepEqual(fieldOf(settings.body, 'plugins'), [{ pluginKey: 'Synthetic', effectCount: 2, optedIn: false }]);
  assert.equal(fieldOf((await panel('POST', '/v1/notes/plugins', { pluginKey: 'Synthetic', enabled: true })).body, 'enabled'), true);
  assert.equal(textOf((await panel('GET', '/v1/notes/settings')).body, 'optedIn.0.pluginKey'), 'Synthetic');
  assert.equal((await panel('POST', '/v1/notes/plugins', { pluginKey: 'Synthetic', enabled: 'maybe' })).status, 422);
  assert.equal((await panel('POST', '/v1/notes/learn-from-work', { enabled: 'maybe' })).status, 422);
  assert.equal(flagOf((await panel('POST', '/v1/notes/learn-from-work', { enabled: false })).body, 'learnFromWork'), false);
  assert.equal(flagOf((await panel('GET', '/v1/notes/settings')).body, 'learnFromWork'), false);
  assert.equal(succeeded(harness.sidecar.collection.effectNotes.recordKeptUsage(usage)).recorded, 0);
  assert.equal(flagOf((await panel('POST', '/v1/notes/learn-from-work', { enabled: true })).body, 'learnFromWork'), true);
  succeeded(harness.sidecar.collection.effectNotes.recordKeptUsage(usage));
  assert.equal(numberOf((await panel('POST', '/v1/notes/usage/forget', {})).body, 'removed'), 1);
}

async function writeThreeNotes(harness: HttpHarness): Promise<string[]> {
  const ids: string[] = [];
  for (const text of ['One.', 'Two.', 'Three.']) {
    const current = await harness.tool('ae_read_effect_notes', { matchName: GLOW });
    const replacement = ids.length === 2 ? { replaces: present(ids[0]), reason: 'Cleaner.' } : {};
    const written = await harness.tool('ae_write_effect_note', { matchName: GLOW, controlPath: AMOUNT, text, expectedNoteIds: textsOf(current.body, 'data.noteIds'), ...replacement });
    ids.push(textOf(written.body, 'data.written.id'));
  }
  return ids;
}

async function exerciseHistory(harness: HttpHarness, ids: readonly string[]): Promise<void> {
  const { panel } = harness, [first, second, third] = [present(ids[0]), present(ids[1]), present(ids[2])];
  const history = await panel('GET', `/v1/notes/history?matchName=${encodeURIComponent(GLOW)}`);
  assert.equal(history.status, 200); assert.equal(listOf(history.body, 'notes').length, 1); assert.equal(textOf(history.body, 'notes.0.id'), first);
  assert.deepEqual(new Set(textsOf(history.body, 'current.noteIds')), new Set([second, third]));
  assert.equal(textOf(history.body, 'current.effect.pluginKey'), 'Synthetic'); assert.equal(textOf(history.body, 'current.effect.matchName'), GLOW);
  const expectedNoteIds = textsOf(history.body, 'current.noteIds');
  const capped = await panel('POST', '/v1/notes/restore', { noteId: first, expectedNoteIds });
  assert.equal(capped.status, 409); assert.equal(fieldOf(capped.body, 'error.code'), 'EFFECT_NOTES_CAP_REACHED'); assert.equal(listOf(capped.body, 'current.notes').length, 2);
  const restored = await panel('POST', '/v1/notes/restore', { noteId: first, expectedNoteIds, replaces: second, reason: 'Back to the first.' });
  assert.equal(restored.status, 200); assert.equal(textOf(restored.body, 'restored.id'), first);
}

async function exerciseForgets(harness: HttpHarness, second: string): Promise<void> {
  const { panel } = harness;
  assert.equal(numberOf((await panel('POST', '/v1/notes/forget', { scope: 'note', noteId: second })).body, 'removed'), 1);
  assert.equal(numberOf((await panel('POST', '/v1/notes/forget', { scope: 'effect', matchName: GLOW })).body, 'removed'), 2);
  await harness.tool('ae_write_effect_note', { matchName: 'ADBE Blur', text: 'Blur note.', expectedNoteIds: [] });
  assert.equal(numberOf((await panel('POST', '/v1/notes/forget', { scope: 'plugin', pluginKey: 'Synthetic' })).body, 'removed'), 1);
  assert.equal((await panel('POST', '/v1/notes/forget', { scope: 'everything' })).status, 422);
}

test('panel settings, opt-in, learn toggle, history, restore and the three forgets work over HTTP', async t => {
  const harness = await sidecarHarness(t);
  await exerciseSettings(harness);
  const ids = await writeThreeNotes(harness);
  await exerciseHistory(harness, ids);
  await exerciseForgets(harness, present(ids[1]));
});

test('notes settings survive a sidecar restart', async t => {
  const harness = await sidecarHarness(t);
  await harness.panel('POST', '/v1/notes/learn-from-work', { enabled: false });
  await harness.panel('POST', '/v1/notes/plugins', { pluginKey: 'Synthetic', enabled: true });
  await harness.sidecar.stop();
  const second = new ReadOnlySidecar({ port: 0, token: TOKEN, stateDirectory: harness.directory, quietAgentLog: true });
  t.after(() => second.collection.close());
  const view = succeeded(second.collection.effectNotes.settingsView());
  assert.equal(view.learnFromWork, false); assert.equal(present(view.optedIn[0]).pluginKey, 'Synthetic');
});
