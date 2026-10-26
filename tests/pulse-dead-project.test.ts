/** Tests that the host pulse recovers when its cached project closes or goes invalid. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostText, hostTextFunction, loadHostFiles } from '../apps/panel/dist/tests/host-sources.js';
import { jsonObject } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, parseJson, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';

const hostSource = hostText('collection.jsx');
class CompItem {}
class FolderItem {}

interface ProjectFile {
  fsName: string;
  name: string;
}

interface ProjectTarget {
  numItems: number;
  revision: number;
  file: ProjectFile | null;
  activeItem: null;
  item: () => { id: number; name: string; parentFolder: null };
}

interface ProjectOptions {
  readonly items?: number;
  readonly revision?: number;
}

interface MadeProject {
  readonly project: ProjectTarget;
  readonly state: { closed: boolean };
  readonly target: ProjectTarget;
}

interface SessionHandle {
  readonly stale?: boolean;
}

interface HostGlobals {
  app: { project: ProjectTarget; version: string };
  CompItem: typeof CompItem;
  FolderItem: typeof FolderItem;
  JSON: typeof JSON;
  $: { os: string };
  aeCollectionSession?: SessionHandle | null;
  aeCollectionDetailSession?: SessionHandle | null;
  aeCollectionValueSession?: SessionHandle | null;
}

interface FakeHost {
  readonly globals: HostGlobals;
  readonly indexPage: (request: JsonObject) => JsonObject;
  readonly pulse: () => JsonObject;
}

const objectOf = (text: string): JsonObject => decodeOrThrow(jsonObject, parseJson(text));
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const isTargetKey = (target: ProjectTarget, key: string | symbol): key is keyof ProjectTarget => key in target;

function makeProject(fsName: string | null, { items = 3, revision = 4 }: ProjectOptions = {}): MadeProject {
  const state = { closed: false };
  const target: ProjectTarget = { numItems: items, revision, file: fsName ? { fsName, name: baseName(fsName) } : null, activeItem: null, item() { return { id: 1, name: 'x', parentFolder: null }; } };
  const project = new Proxy(target, {
    get(t, key): ProjectTarget[keyof ProjectTarget] | undefined {
      if (state.closed) throw Object.assign(new ReferenceError('Object is invalid'), { line: 58 });
      return isTargetKey(t, key) ? t[key] : undefined;
    },
  });
  return { project, state, target };
}

function fakeHost(first: MadeProject): FakeHost {
  const globals: HostGlobals = { app: { project: first.project, version: '26.2.1' }, CompItem, FolderItem, JSON, $: { os: 'Macintosh' } };
  const context = vm.createContext(globals);
  loadHostFiles(context, 'collection.jsx');
  const pulse = hostTextFunction(context, 'aeCollectionPulse'), indexPage = hostTextFunction(context, 'aeCollectIndexPage');
  return { globals, indexPage: request => objectOf(indexPage(JSON.stringify(request))), pulse: () => objectOf(pulse('')) };
}

test('the pulse recovers when the cached project closes and another opens', () => {
  const untitled = makeProject(null), opened = makeProject('/Users/a/promo.aep');
  const host = fakeHost(untitled);
  const first = host.pulse();
  assert.equal(fieldOf(first, 'ok'), true); assert.equal(fieldOf(first, 'projectName'), 'Untitled'); assert.equal(fieldOf(first, 'project'), 1);
  assert.equal(fieldOf(host.pulse(), 'project'), 1, 'the same project keeps its epoch');
  untitled.state.closed = true; host.globals.app.project = opened.project;
  const after = host.pulse();
  assert.equal(fieldOf(after, 'ok'), true, 'a dead cached project must not kill the pulse'); assert.equal(fieldOf(after, 'project'), 2, 'the epoch moved on');
  assert.equal(fieldOf(after, 'projectName'), 'promo.aep'); assert.equal(fieldOf(after, 'projectPath'), '/Users/a/promo.aep');
  assert.equal(fieldOf(host.pulse(), 'project'), 2); assert.equal(fieldOf(host.pulse(), 'ok'), true, 'and it stays alive');
});

test('a cached project that goes invalid while still being app.project is replaced, not fatal', () => {
  const only = makeProject('/Users/a/one.aep');
  const host = fakeHost(only);
  assert.equal(fieldOf(host.pulse(), 'project'), 1);
  only.state.closed = true;
  const fresh = makeProject('/Users/a/one.aep'); host.globals.app.project = fresh.project;
  const after = host.pulse();
  assert.equal(fieldOf(after, 'ok'), true); assert.equal(fieldOf(after, 'project'), 2);
});

test('opening another file bumps the epoch even when the project object is the same one', () => {
  const same = makeProject(null);
  const host = fakeHost(same);
  assert.equal(fieldOf(host.pulse(), 'project'), 1);
  same.target.file = { fsName: '/Users/a/saved.aep', name: 'saved.aep' };
  assert.equal(fieldOf(host.pulse(), 'project'), 2, 'a project that gains or changes its path is another project to the read sets');
  same.target.file = { fsName: '/Users/a/other.aep', name: 'other.aep' };
  assert.equal(fieldOf(host.pulse(), 'project'), 3);
  same.target.revision = 5;
  assert.equal(fieldOf(host.pulse(), 'project'), 3, 'an edit alone does not');
});

test('a project change clears every host-side session, and a dead session project is a change, not a throw', () => {
  const a = makeProject('/Users/a/a.aep'), b = makeProject('/Users/a/b.aep');
  const host = fakeHost(a);
  const begin = host.indexPage({ schemaVersion: '0.1', requestId: 'r1', begin: true, pageSize: 1 });
  assert.equal(fieldOf(begin, 'ok'), true); assert.notEqual(host.globals.aeCollectionSession, null);
  host.globals.aeCollectionDetailSession = { stale: true }; host.globals.aeCollectionValueSession = { stale: true };
  a.state.closed = true; host.globals.app.project = b.project;
  const continued = host.indexPage({ schemaVersion: '0.1', requestId: 'r2', sessionId: textOf(begin, 'sessionId'), cursor: 2 });
  assert.equal(fieldOf(continued, 'ok'), false); assert.equal(fieldOf(continued, 'error.code'), 'PROJECT_CHANGED');
  assert.equal(host.globals.aeCollectionSession, null);
  assert.equal(host.globals.aeCollectionDetailSession, null);
  assert.equal(host.globals.aeCollectionValueSession, null);
});

test('a pulse that cannot read still names the code, and now says why', () => {
  const broken = makeProject('/Users/a/a.aep');
  const host = fakeHost(broken);
  broken.state.closed = true;
  const failed = host.pulse();
  assert.equal(fieldOf(failed, 'ok'), false); assert.equal(fieldOf(failed, 'error.code'), 'REVISION_READ_FAILED');
  assert.match(textOf(failed, 'error.detail'), /ReferenceError: Object is invalid \(line 58\)/);
  assert.ok(textOf(failed, 'error.detail').length <= 300);
  const long = makeProject('/Users/a/long.aep'); Object.defineProperty(long.target, 'revision', { get() { throw new Error('x'.repeat(900)); } });
  assert.equal(textOf(fakeHost(long).pulse(), 'error.detail').length, 300, 'the detail is bounded');
});

test('collection.jsx documents who loads it', () => {
  const firstLine = hostSource.split('\n')[0] ?? '';
  assert.match(firstLine, /probe\.jsx/); assert.doesNotMatch(firstLine, /Not loaded/);
});
