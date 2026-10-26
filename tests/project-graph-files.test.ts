/** Tests project graph files: one per saved project, no cross-project queries. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLOutputValue } from 'node:sqlite';
import { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { indexTarget as target, sampleCensus, samplePresets } from './graph-test-support.ts';

interface GraphFiles { directory: string; open(): ProjectGraphStore; files(): string[] }

const item = (id: number, name: string): JsonObject => ({ id: String(id), name, itemIndex: id, type: 'composition', parentFolderId: '0', layers: 0 });
function page(path: string | null, rows: JsonObject[], epoch = 1, revision = 4): JsonObject {
  return { project: { filePath: path, name: path ? basename(path) : 'Untitled' }, runtime: { platform: 'macOS', appVersion: '26.2' }, stamp: { epoch, revision }, rows };
}
function fixture(t: TestContext): GraphFiles {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-project-files-')), stores: ProjectGraphStore[] = [];
  const open = (): ProjectGraphStore => { const store = new ProjectGraphStore(directory); stores.push(store); return store; };
  t.after(() => { for (const store of stores) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, open, files: () => readdirSync(join(directory, 'graphs')).filter(file => file.endsWith('.extynt')).sort() };
}
function inspect(path: string, sql: string): Array<Record<string, SQLOutputValue>> {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare(sql).all().map(row => ({ ...row })); } finally { db.close(); }
}
const rowNames = (store: ProjectGraphStore, now: number): string[] => recordsOf(store.query({ target }, now), 'rows').map(row => textOf(row, 'row.name'));
const pathOf = (store: ProjectGraphStore): string => textOf(store.status(), 'path');

test('startup creates no graph file and preserves the old prototype database', (t: TestContext) => {
  const f = fixture(t), old = join(f.directory, 'project-graph.extynt');
  writeFileSync(old, 'preserve the former database', { mode: 0o600 });
  const store = f.open();
  assert.equal(fieldOf(store.status(), 'state'), 'not-opened');
  assert.equal(fieldOf(store.query({ target }, 10), 'state'), 'unknown');
  store.observe({ kind: 'invalid' }, page('/projects/A.aep', [item(7, 'A')]), 'panel', 10);
  store.observe(target, { rows: [item(7, 'A')] }, 'panel', 10);
  assert.equal(existsSync(join(f.directory, 'graphs')), false);
  assert.equal(readFileSync(old, 'utf8'), 'preserve the former database');
});

test('same-basename saved projects use independent files and current queries cannot cross projects', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  store.observe(target, page('/project-a/Main.aep', [item(7, 'A composition')]), 'panel', 10);
  const first = pathOf(store);
  store.observe(target, page('/project-b/Main.aep', [item(7, 'B composition')]), 'panel', 11);
  const second = pathOf(store);
  assert.notEqual(first, second); assert.equal(f.files().length, 2);
  assert.match(basename(first), /^saved-[a-f0-9]{64}\.extynt$/);
  assert.deepEqual(rowNames(store, 12), ['B composition']);
  assert.deepEqual(inspect(first, 'SELECT name FROM nodes'), [{ name: 'A composition' }]);
  assert.deepEqual(inspect(second, 'SELECT name FROM nodes'), [{ name: 'B composition' }]);
});

test('switching back selects only retained historical data until each row is observed again', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  store.observe(target, page('/projects/A.aep', [item(7, 'A old')]), 'panel', 10);
  const path = pathOf(store);
  store.observe(target, page('/projects/B.aep', [item(7, 'B')]), 'panel', 11);
  store.observe(target, page('/projects/A.aep', [], 2, 4), 'panel', 12);
  assert.equal(pathOf(store), path);
  const retained = store.query({ target }, 13);
  assert.equal(fieldOf(retained, 'rows.0.row.name'), 'A old'); assert.equal(fieldOf(retained, 'rows.0.freshness'), 'stale');
  assert.equal(fieldOf(retained, 'rows.0.writeAuthorizing'), false);
  store.observe(target, page('/projects/A.aep', [item(7, 'A new')], 2, 4), 'panel', 14);
  const current = store.query({ target }, 15);
  assert.equal(fieldOf(current, 'rows.0.row.name'), 'A new'); assert.equal(fieldOf(current, 'rows.0.freshness'), 'observed');
  store.invalidate(); assert.equal(fieldOf(store.query({ target }, 15), 'state'), 'unknown');
});

test('restart keeps the saved file stable and every unobserved scope stale', (t: TestContext) => {
  const f = fixture(t), first = f.open(), properties = { kind: 'properties', compositionId: '7', layerId: '8' };
  first.observe(target, page('/projects/A.aep', [item(7, 'A')]), 'old-panel', 10);
  first.observe(properties, page('/projects/A.aep', [{ id: 'Effects/Amount', name: 'Amount', path: 'Effects/Amount', matchName: 'Vendor Amount', propertyIndices: [1], children: 0, valueType: 'OneD', propertyType: 'PROPERTY' }]), 'old-panel', 10);
  const path = pathOf(first); first.close();
  const restored = f.open();
  assert.equal(fieldOf(restored.query({ target }, 11), 'state'), 'unknown');
  assert.equal(fieldOf(restored.status(), 'path'), null);
  restored.observe(target, page('/projects/A.aep', [item(7, 'A')]), 'new-panel', 12);
  assert.equal(pathOf(restored), path); assert.equal(f.files().length, 1);
  assert.equal(fieldOf(restored.query({ target }, 13), 'rows.0.freshness'), 'observed');
  assert.equal(fieldOf(restored.query({ target: properties }, 13), 'rows.0.freshness'), 'stale');
});

test('host version namespaces share a saved file without mixing incompatible observations', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  store.observe(target, page('/projects/A.aep', [item(7, 'Old host')]), 'panel', 10);
  const path = pathOf(store);
  store.observe(target, { ...page('/projects/A.aep', [item(8, 'New host')]), runtime: { platform: 'macOS', appVersion: '27.0' } }, 'panel', 11);
  assert.equal(pathOf(store), path); assert.equal(f.files().length, 1);
  assert.deepEqual(rowNames(store, 12), ['New host']);
  assert.equal(inspect(path, 'SELECT id FROM projects').length, 2);
});

test('Untitled projects get different files for epochs, panels and sidecar sessions', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  store.observe(target, page(null, [item(7, 'First unsaved')]), 'panel-a', 10);
  const first = pathOf(store);
  store.observe(target, page(null, [item(8, 'Second unsaved')], 2), 'panel-a', 11);
  const second = pathOf(store);
  store.observe(target, page(null, [item(9, 'New panel')], 2), 'panel-b', 12);
  const third = pathOf(store);
  assert.equal(new Set([first, second, third]).size, 3);
  assert.match(basename(first), /^unsaved-[a-f0-9]{64}\.extynt$/);
  assert.deepEqual(rowNames(store, 13), ['New panel']);
  store.close();
  const next = f.open(); next.observe(target, page(null, [item(10, 'Restarted')], 2), 'panel-b', 14);
  assert.equal(new Set([first, second, third, pathOf(next)]).size, 4);
  assert.equal(f.files().length, 4);
  assert.deepEqual(rowNames(next, 15), ['Restarted']);
});

test('a still-open unsaved session can revisit its file with stale historical observations', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  store.observe(target, page(null, [item(7, 'Unsaved')]), 'panel', 10);
  const path = pathOf(store);
  store.observe(target, page('/projects/Saved.aep', [item(8, 'Saved')], 2), 'panel', 11);
  store.observe(target, page(null, [], 1), 'panel', 12);
  assert.equal(pathOf(store), path);
  const retained = store.query({ target }, 13);
  assert.equal(fieldOf(retained, 'rows.0.row.name'), 'Unsaved'); assert.equal(fieldOf(retained, 'rows.0.freshness'), 'stale');
  assert.equal(f.files().length, 2);
});

test('explicit host census has a shared catalogue separate from every project', (t: TestContext) => {
  const f = fixture(t), store = f.open();
  const catalogue = store.observeCensus(sampleCensus(), 10, samplePresets());
  assert.equal(catalogue.scope, 'host-catalogue'); assert.equal(fieldOf(store.status(), 'path'), null);
  assert.deepEqual(f.files(), ['host-catalogue.extynt']);
  store.observe(target, page('/projects/A.aep', [item(7, 'A')]), 'panel', 11);
  store.observe(target, page('/projects/B.aep', [item(8, 'B')]), 'panel', 12);
  assert.equal(f.files().length, 3);
  assert.deepEqual(inspect(textOf(catalogue, 'path'), 'SELECT display_name FROM installed_effects'), [{ display_name: 'Effect' }]);
  assert.deepEqual(inspect(textOf(catalogue, 'path'), 'SELECT name FROM presets'), [{ name: 'Preset' }]);
  assert.deepEqual(inspect(textOf(catalogue, 'path'), 'SELECT name FROM nodes'), []);
  assert.deepEqual(inspect(pathOf(store), 'SELECT display_name FROM installed_effects'), []);
});
