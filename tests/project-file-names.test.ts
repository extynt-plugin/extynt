/** Tests project file naming: one stem for graph and chat log, and rejection of unsafe links. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { projectFileLink, normalizeProjectFileLink } from '../apps/sidecar/dist/src/project-file-names.js';
import type { ProjectFileLink } from '../apps/sidecar/dist/src/project-file-names.js';
import { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import type { JsonObject, JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { indexTarget as target, objectOf } from './graph-test-support.ts';

interface LinkMaker { make(kind: string, projectId: string): ProjectFileLink }

const id = 'a'.repeat(64), linkMaker: LinkMaker = { make: projectFileLink };
const row: JsonObject = { id: '7', name: 'Comp', itemIndex: 1, type: 'composition', parentFolderId: '0', layers: 0 };
const page = (path: string, revision: number | null = 4): JsonObject => ({
  project: { name: 'Main.aep', filePath: path }, runtime: { appVersion: '26.2', platform: 'macOS' }, stamp: { epoch: 1, revision }, rows: [row],
});
const linkOf = (store: ProjectGraphStore): JsonObject => objectOf(store.status().projectLink);
const linkState = (store: ProjectGraphStore): JsonValue | undefined => store.status().projectLink;
function fixture(t: TestContext): { directory: string; store: ProjectGraphStore } {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-project-names-')), store = new ProjectGraphStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store };
}

test('one stable project stem names its graph and aggregate chat log exactly alike', () => {
  for (const kind of ['saved', 'unsaved'] as const) {
    const link = projectFileLink(kind, id);
    assert.deepEqual(link, { schemaVersion: 'extynt.project-link/1', projectId: id, kind, stem: `${kind}-${id}`, databaseFile: `${kind}-${id}.extynt`, chatLogFile: `${kind}-${id}.jsonl` });
    assert.equal(basename(link.databaseFile, '.extynt'), basename(link.chatLogFile, '.jsonl'));
    assert.deepEqual(normalizeProjectFileLink(jsonOf(link)), link);
  }
});

test('explicit link validation rejects traversal, mismatched identities and arbitrary extensions', () => {
  const link = projectFileLink('saved', id);
  for (const invalid of [null, [], 'saved', {}, { ...link, schemaVersion: 'future' }, { ...link, kind: 'catalogue' }, { ...link, projectId: id.toUpperCase() }, { ...link, stem: `unsaved-${id}` }, { ...link, databaseFile: `../${link.databaseFile}` }, { ...link, chatLogFile: `projects/${link.chatLogFile}` }, { ...link, chatLogFile: `${link.stem}.txt` }, { ...link, projectId: 'b'.repeat(64) }]) assert.equal(normalizeProjectFileLink(invalid), null);
  assert.throws(() => projectFileLink('saved', 'short'), /INVALID_PROJECT_LINK/);
  assert.throws(() => linkMaker.make('other', id), /INVALID_PROJECT_LINK/);
  const normalized = normalizeProjectFileLink({ ...link, token: 'excluded', path: '/excluded' });
  assert.deepEqual(normalized, link); assert.notEqual(normalized, link);
});

test('a native project link is explicit, detached and hidden by invalidation', (t: TestContext) => {
  const { store } = fixture(t);
  assert.equal(linkState(store), null);
  store.observe(target, page('/projects/A/Main.aep'), 'panel-private-id', 10);
  const first = linkOf(store);
  assert.equal(first.databaseFile, basename(textOf(store.status(), 'path')));
  assert.doesNotMatch(JSON.stringify(first), /panel-private-id|\/projects\//);
  const captured = { ...first }; Reflect.set(first, 'chatLogFile', 'modified.jsonl');
  assert.deepEqual(linkState(store), captured);
  store.observe(target, page('/projects/B/Main.aep'), 'panel-private-id', 11);
  assert.notEqual(linkOf(store).projectId, captured.projectId);
  assert.equal(captured.chatLogFile, `${captured.stem}.jsonl`);
  store.invalidate(); assert.equal(linkState(store), null);
  assert.equal(fieldOf(store.query({ target }, 12), 'state'), 'unknown');
});

test('null revisions can link identity while retaining unknown evidence and no write authority', (t: TestContext) => {
  const { store } = fixture(t);
  store.observe(target, page('/projects/A.aep', null), 'panel', 10);
  assert.equal(linkOf(store).kind, 'saved');
  const result = store.query({ target }, 11);
  assert.equal(fieldOf(result, 'rows.0.freshness'), 'unknown'); assert.equal(fieldOf(result, 'writeAuthorizing'), false);
  assert.equal(store.reconcile(page('/projects/A.aep', null)), false);
  assert.equal(linkState(store), null);
});

test('failed native identity reconciliation hides the old link until a bounded observation', (t: TestContext) => {
  const { store } = fixture(t), first = page('/projects/A.aep');
  store.observe(target, first, 'panel', 10);
  const captured = linkOf(store);
  assert.equal(store.reconcile(first), true); assert.deepEqual(linkState(store), captured);
  assert.equal(store.reconcile(page('/projects/B.aep')), false);
  assert.equal(linkState(store), null);
  assert.equal(store.reconcile(first), true); assert.equal(linkState(store), null);
  store.observe(target, page('/projects/B.aep'), 'panel', 11);
  assert.notEqual(linkOf(store).projectId, captured.projectId);
});

test('unavailable cache storage does not erase an accepted native project identity', (t: TestContext) => {
  const { store } = fixture(t);
  store.observe(target, page('/projects/A.aep'), 'panel', 10);
  const original = textOf(store.status(), 'path'); store.close();
  writeFileSync(original, 'preserve the unavailable cache', { mode: 0o600 });
  store.observe(target, page('/projects/A.aep'), 'panel', 11);
  assert.equal(fieldOf(store.status(), 'state'), 'unavailable');
  assert.equal(linkOf(store).databaseFile, basename(original));
  assert.equal(fieldOf(store.query({ target }, 12), 'state'), 'unknown');
});
