/** Tests that linked chats share one project archive that is idempotent and append-only. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import { normalizeProjectFileLink, projectFileLink } from '../apps/sidecar/dist/src/project-file-names.js';
import type { ProjectFileLink } from '../apps/sidecar/dist/src/project-file-names.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf, parseJson, readJson, recordOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject as ResponseObject } from '../apps/sidecar/dist/tests/http-json.js';

type LinkField = ReadonlyArray<ProjectFileLink> | JsonValue | undefined;
type LinkMaker = (target: string, path: string) => void;
interface MessageData { kind: string; text: string; requestId: string; projectLinks?: LinkField }
interface SessionData { name: string; projectLinks: ReadonlyArray<ProjectFileLink> }
interface ChatEvent { type: string; eventId: string; revision: number; data: MessageData | SessionData }
interface ChatBatch { schemaVersion: string; sessionId: string; name: string; events: ChatEvent[] }
interface Reply { status: number; body: ResponseObject }
interface ChatFixture {
  directory: string;
  call(path: string, body: ChatBatch | { destination: string }, authorization?: string): Promise<Reply>;
  append(body: ChatBatch): Promise<Reply>;
  archive(link: ProjectFileLink): string;
  legacy(sessionId: string): string;
  observe(filePath: string): ProjectFileLink;
}

const TOKEN = 'synthetic-chat-token';
const linkA = projectFileLink('saved', 'a'.repeat(64));
const linkB = projectFileLink('unsaved', 'b'.repeat(64));
const symlinkAndHardlink: LinkMaker[] = [symlinkSync, linkSync];
function message(id: string, projectLinks?: LinkField, revision = 1): ChatEvent {
  const data: MessageData = { kind: 'assistant', text: `Text for ${id}`, requestId: `request-${id}`, ...(projectLinks === undefined ? {} : { projectLinks }) };
  return { type: 'message', eventId: id, revision, data };
}
const batch = (sessionId: string, events: ChatEvent[]): ChatBatch => ({ schemaVersion: 'extynt.chat-log/0.1', sessionId, name: `Chat ${sessionId}`, events });
const lines = (path: string): ResponseObject[] => readFileSync(path, 'utf8').trim().split('\n').map(line => recordOf(parseJson(line), ''));
const parsedOrNone = (line: string): ResponseObject[] => { try { return [recordOf(parseJson(line), '')]; } catch { return []; } };
const eventIds = (path: string): string[] => lines(path).map(row => textOf(row, 'eventId'));

async function fixture(t: TestContext): Promise<ChatFixture> {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-project-chat-'));
  const sidecar = new ReadOnlySidecar({ port: 0, token: TOKEN, stateDirectory: directory });
  t.after(async () => { await sidecar.stop(); rmSync(directory, { recursive: true, force: true }); });
  const address = await sidecar.start(), endpoint = `http://${address.host}:${address.port}`;
  const call: ChatFixture['call'] = async (path, body, authorization = `Bearer ${TOKEN}`) => {
    const response = await fetch(endpoint + path, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: recordOf(await readJson(response), '') };
  };
  const observe: ChatFixture['observe'] = filePath => {
    sidecar.collection.pair('synthetic-panel');
    const dispatch = sidecar.collection.demand({ begin: true, target: { kind: 'index' } }, false);
    sidecar.collection.authorizeDispatch(jsonOf({ ticket: dispatch.ticket }));
    sidecar.collection.complete(jsonOf({ ticket: dispatch.ticket, page: { ok: true, requestId: dispatch.ticket, sessionId: 'native-index',
      stamp: { epoch: filePath === '/synthetic/B.aep' ? 2 : 1, revision: 4 }, project: { name: 'Saved.aep', filePath },
      runtime: { appVersion: '26.2', platform: 'macOS' }, rows: [{ id: '7', name: 'Composition' }], nextCursor: null, deepComplete: false } }));
    const link = normalizeProjectFileLink(sidecar.collection.storageStatus().projectLink);
    if (link === null) throw new Error('no project link after observation');
    return link;
  };
  return { directory, call, append: body => call('/v1/chat-logs', body), observe,
    archive: link => join(directory, 'chat-logs', 'projects', link.chatLogFile), legacy: sessionId => join(directory, 'chat-logs', `${sessionId}.jsonl`) };
}

test('two chats share one explicitly linked project archive without message-ID collisions', async (t: TestContext) => {
  const f = await fixture(t);
  for (const sessionId of ['chat-a', 'chat-b']) {
    const events = [{ type: 'session', eventId: 'session', revision: 1, data: { name: sessionId, projectLinks: [linkA] } }, message('message-1', [linkA])];
    const response = await f.append(batch(sessionId, events));
    assert.equal(response.status, 200); assert.equal(fieldOf(response.body, 'accepted'), 2);
    assert.equal(lines(f.legacy(sessionId)).length, 2);
  }
  const rows = lines(f.archive(linkA));
  assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => fieldOf(row, 'sessionId')), ['chat-a', 'chat-b']);
  assert.ok(rows.every(row => fieldOf(row, 'type') === 'message' && fieldOf(row, 'data.requestId') === 'request-message-1'));
  assert.deepEqual(fieldOf(rows[0], 'projectLink'), linkA); assert.equal(statSync(f.archive(linkA)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(f.directory, 'chat-logs', 'projects')), [linkA.chatLogFile]);
});

test('duplicate replay is idempotent and later message revisions remain append-only', async (t: TestContext) => {
  const f = await fixture(t), original = batch('chat-a', [message('message-1', [linkA, linkA])]);
  assert.equal((await f.append(original)).status, 200);
  assert.equal(fieldOf((await f.append(original)).body, 'accepted'), 0);
  assert.equal(lines(f.archive(linkA)).length, 1); assert.equal(lines(f.legacy('chat-a')).length, 1);
  assert.equal((await f.append(batch('chat-a', [message('message-1', [linkA], 2)]))).status, 200);
  assert.deepEqual(lines(f.archive(linkA)).map(row => fieldOf(row, 'revision')), [1, 2]);
  const colliding = [batch('a:b', [message('c', [linkA])]), batch('a', [message('b:c', [linkA])])];
  for (const entry of colliding) assert.equal((await f.append(entry)).status, 200);
  assert.equal(lines(f.archive(linkA)).length, 4, 'Distinct session/event tuples must not collide at colon delimiters');
});

test('project switching keeps explicit historical links and allows a message linked to two projects', async (t: TestContext) => {
  const f = await fixture(t), first = f.observe('/synthetic/A.aep');
  assert.equal((await f.append(batch('chat-a', [message('message-1', [first])]))).status, 200);
  const second = f.observe('/synthetic/B.aep'); assert.notEqual(first.projectId, second.projectId);
  const later = [message('message-2', [second]), message('message-3', [first, second]), message('message-4', [first])];
  assert.equal((await f.append(batch('chat-a', later))).status, 200);
  assert.deepEqual(eventIds(f.archive(first)), ['message-1', 'message-3', 'message-4']);
  assert.deepEqual(eventIds(f.archive(second)), ['message-2', 'message-3']);
  assert.ok(lines(f.archive(first)).every(row => fieldOf(row, 'projectLink.projectId') === first.projectId));
  assert.equal(lines(f.legacy('chat-a')).length, 4);
});

test('unlinked historical logs are never attached to the current observed project', async (t: TestContext) => {
  const f = await fixture(t), historical = batch('chat-a', [message('message-1')]);
  assert.equal((await f.append(historical)).status, 200);
  const current = f.observe('/synthetic/A.aep');
  assert.equal(fieldOf((await f.append(historical)).body, 'accepted'), 0); assert.equal(existsSync(f.archive(current)), false);
  assert.equal((await f.append(batch('chat-a', [message('message-2', [current])]))).status, 200);
  assert.deepEqual(eventIds(f.archive(current)), ['message-2']);
  assert.equal(lines(f.legacy('chat-a')).length, 2);
});

test('forged filenames, traversal links, malformed arrays and unauthenticated writes are rejected before any append', async (t: TestContext) => {
  const f = await fixture(t);
  const bad = [{ ...linkA, chatLogFile: '../../escape.jsonl' }, { ...linkA, databaseFile: linkB.databaseFile },
    { ...linkA, stem: 'forged' }, { ...linkA, schemaVersion: 'other' }, { ...linkA, projectId: '../escape' },
    { ...linkA, kind: 'other' }, null];
  for (const link of bad) {
    const response = await f.append(batch('bad-session', [message('valid', [linkA]), message('bad', [link])]));
    assert.equal(response.status, 422); assert.equal(fieldOf(response.body, 'error.code'), 'INVALID_CHAT_LOG');
  }
  const malformed = [null, {}, Array.from({ length: 17 }, () => linkA)];
  for (const links of malformed) assert.equal((await f.append(batch('bad-session', [message('bad', links)]))).status, 422);
  assert.equal((await f.call('/v1/chat-logs', batch('bad-session', [message('valid', [linkA])]), '')).status, 401);
  assert.equal(existsSync(f.legacy('bad-session')), false); assert.equal(existsSync(f.archive(linkA)), false);
  assert.equal(existsSync(join(f.directory, 'escape.jsonl')), false);
});

test('legacy full export counts chat sessions once and never duplicates project aggregate rows', async (t: TestContext) => {
  const f = await fixture(t);
  for (const sessionId of ['chat-a', 'chat-b']) {
    assert.equal((await f.append(batch(sessionId, [message('linked', [linkA]), message('unlinked')]))).status, 200);
  }
  const destination = join(f.directory, 'export.jsonl');
  const response = await f.call('/v1/chat-logs/export', { destination });
  assert.equal(response.status, 200); assert.equal(fieldOf(response.body, 'sessions'), 2);
  const rows = lines(destination); assert.equal(fieldOf(rows[0], 'sessions'), 2); assert.equal(rows.length, 5);
  assert.equal(rows.filter(row => fieldOf(row, 'eventId') === 'linked').length, 2);
  assert.ok(rows.slice(1).every(row => fieldOf(row, 'projectLink') === undefined));
  assert.equal(lines(f.archive(linkA)).length, 2);
  assert.equal((await f.call('/v1/chat-logs/export', { destination: f.archive(linkA) })).status, 422);
});

test('aggregate symlink and hardlink collisions preserve their targets and recover on replay after safe removal', async (t: TestContext) => {
  for (const makeLink of symlinkAndHardlink) {
    const f = await fixture(t), target = join(f.directory, 'untouched.jsonl'), input = batch('chat-a', [message('message-1', [linkA])]);
    writeFileSync(target, 'preserve adjacent artifact\n', { mode: 0o600 });
    mkdirSync(join(f.directory, 'chat-logs', 'projects'), { recursive: true }); makeLink(target, f.archive(linkA));
    const failed = await f.append(input); assert.equal(failed.status, 500); assert.equal(fieldOf(failed.body, 'error.code'), 'CHAT_LOG_FAILED');
    assert.equal(readFileSync(target, 'utf8'), 'preserve adjacent artifact\n'); assert.equal(lines(f.legacy('chat-a')).length, 1);
    rmSync(f.archive(linkA));
    const retry = await f.append(input); assert.equal(retry.status, 200);
    assert.equal(fieldOf(retry.body, 'accepted'), 0); assert.equal(fieldOf(retry.body, 'projectAccepted'), 1);
    assert.equal(lines(f.archive(linkA)).length, 1); assert.equal(lines(f.legacy('chat-a')).length, 1);
    assert.equal(readFileSync(target, 'utf8'), 'preserve adjacent artifact\n');
  }
});

test('aggregate directory symlink cannot append outside the state directory', async (t: TestContext) => {
  const f = await fixture(t), adjacent = join(f.directory, 'adjacent');
  mkdirSync(adjacent); mkdirSync(join(f.directory, 'chat-logs')); symlinkSync(adjacent, join(f.directory, 'chat-logs', 'projects'));
  assert.equal((await f.append(batch('chat-a', [message('message-1', [linkA])]))).status, 500);
  assert.deepEqual(readdirSync(adjacent), []); assert.equal(lines(f.legacy('chat-a')).length, 1);
});

test('export aliases cannot overwrite a project archive through outside symlinks or hardlinks', async (t: TestContext) => {
  const f = await fixture(t); await f.append(batch('chat-a', [message('message-1', [linkA])]));
  const archive = f.archive(linkA), original = readFileSync(archive), makers: Array<[string, LinkMaker]> = [['symlink', symlinkSync], ['hardlink', linkSync]];
  for (const [name, makeLink] of makers) {
    const destination = join(f.directory, `${name}-export.jsonl`); makeLink(archive, destination);
    assert.equal((await f.call('/v1/chat-logs/export', { destination })).status, 422);
    assert.deepEqual(readFileSync(archive), original); rmSync(destination);
  }
  const alias = join(f.directory, 'alias'); symlinkSync(join(f.directory, 'chat-logs', 'projects'), alias);
  assert.equal((await f.call('/v1/chat-logs/export', { destination: join(alias, 'new-export.jsonl') })).status, 422);
  assert.equal(existsSync(join(f.directory, 'chat-logs', 'projects', 'new-export.jsonl')), false);
});

test('aggregate retry preserves a truncated final row and delimits the recovered JSON record', async (t: TestContext) => {
  const f = await fixture(t); await f.append(batch('chat-a', [message('message-1', [linkA])]));
  const archive = f.archive(linkA), fragment = '{"type":"message","sessionId":"chat-a","eventId":"message-2","revision":1,"data":';
  const damaged = readFileSync(archive, 'utf8') + fragment; writeFileSync(archive, damaged);
  const input = batch('chat-a', [message('message-2', [linkA])]), response = await f.append(input);
  assert.equal(response.status, 200); assert.equal(fieldOf(response.body, 'projectAccepted'), 1);
  const contents = readFileSync(archive, 'utf8'); assert.ok(contents.startsWith(damaged + '\n'));
  const recovered = contents.trim().split('\n').flatMap(parsedOrNone);
  assert.deepEqual(recovered.map(row => fieldOf(row, 'eventId')), ['message-1', 'message-2']);
  assert.equal(fieldOf(recovered[1], 'data.requestId'), 'request-message-2');
  assert.equal(fieldOf((await f.append(input)).body, 'projectAccepted'), 0); assert.equal(readFileSync(archive, 'utf8'), contents);
});

test('legacy archive ancestor symlink is refused before any linked or unlinked message can escape', async (t: TestContext) => {
  for (const links of [[linkA], undefined]) {
    const f = await fixture(t), adjacent = join(f.directory, 'adjacent');
    mkdirSync(adjacent); symlinkSync(adjacent, join(f.directory, 'chat-logs'));
    const response = await f.append(batch('chat-a', [message('message-1', links)]));
    assert.equal(response.status, 500); assert.equal(fieldOf(response.body, 'error.code'), 'CHAT_LOG_FAILED');
    assert.deepEqual(readdirSync(adjacent), [], 'No legacy append may occur before the ancestor guard');
  }
});

test('legacy session symlink and hardlink targets remain unchanged before project aggregate append', async (t: TestContext) => {
  for (const makeLink of symlinkAndHardlink) {
    const f = await fixture(t), target = join(f.directory, 'untouched.jsonl'), input = batch('chat-a', [message('message-1', [linkA])]);
    writeFileSync(target, 'preserve adjacent artifact\n', { mode: 0o600 });
    mkdirSync(join(f.directory, 'chat-logs')); makeLink(target, f.legacy('chat-a'));
    assert.equal((await f.append(input)).status, 500); assert.equal(readFileSync(target, 'utf8'), 'preserve adjacent artifact\n');
    assert.equal(existsSync(f.archive(linkA)), false);
    rmSync(f.legacy('chat-a'));
    const retry = await f.append(input); assert.equal(retry.status, 200);
    assert.equal(fieldOf(retry.body, 'accepted'), 1); assert.equal(fieldOf(retry.body, 'projectAccepted'), 1);
    assert.equal(readFileSync(target, 'utf8'), 'preserve adjacent artifact\n'); assert.equal(lines(f.legacy('chat-a')).length, 1);
  }
});

test('legacy partial tail is preserved and safely delimited on the next append', async (t: TestContext) => {
  const f = await fixture(t); await f.append(batch('chat-a', [message('message-1')]));
  const file = f.legacy('chat-a'), damaged = readFileSync(file, 'utf8') + '{"eventId":"message-2","revision":'; writeFileSync(file, damaged);
  const input = batch('chat-a', [message('message-2')]), response = await f.append(input);
  assert.equal(response.status, 200); assert.equal(fieldOf(response.body, 'accepted'), 1);
  const contents = readFileSync(file, 'utf8'); assert.ok(contents.startsWith(damaged + '\n'));
  const last = recordOf(parseJson(contents.trim().split('\n').at(-1) ?? ''), ''); assert.equal(last.eventId, 'message-2');
  assert.equal(fieldOf((await f.append(input)).body, 'accepted'), 0); assert.equal(readFileSync(file, 'utf8'), contents);
});
