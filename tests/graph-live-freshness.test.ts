/** Tests live graph freshness: rows age out unless the host reports the same revision again. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';
import { pruneUnsavedGraphs } from '../apps/sidecar/dist/src/graph-prune.js';
import { observedDemandResult } from '../apps/sidecar/dist/src/collection-demand-result.js';
import type { DemandResult } from '../apps/sidecar/dist/src/collection-demand-result.js';
import { CollectionService } from '../apps/sidecar/dist/src/collection-service.js';
import type { JsonObject } from '../packages/decode/dist/src/index.js';
import { fieldOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { identity, indexTarget as target, item } from './graph-test-support.ts';

const page = (revision = 4): JsonObject => ({ ...identity, stamp: { epoch: 1, revision }, rows: [item(7)] });
function store(t: TestContext): GraphStore {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-live-')), graph = new GraphStore(join(directory, 'g.extynt'));
  t.after(() => { graph.close(); rmSync(directory, { recursive: true, force: true }); });
  return graph;
}
const freshness = (graph: GraphStore, now: number): string => textOf(graph.query({ target }, now), 'rows.0.freshness');

class RecordingGraph extends GraphStore {
  readonly calls: number[][] = [];
  override confirmLive(epoch: number, revision: number, at: number): boolean { this.calls.push([epoch, revision, at]); return true; }
}

function observedResult(): DemandResult {
  const stamp = { epoch: 1, revision: 5, raw: { epoch: 1, revision: 5 }, key: '1:5' };
  const page = { raw: {}, sessionId: 's', rows: [], nextCursor: null, stamp, kind: undefined, totalItems: undefined, metadata: undefined, localCreation: undefined, localEffect: undefined };
  const fields: JsonObject = { state: 'observed', evidence: 'native-revision-bound-page', observedAt: 0 };
  return { fields, observedAt: 0, invalidated: false, page };
}

test('rows age out after 15 s unless AE reports the same revision again', (t: TestContext) => {
  const graph = store(t);
  graph.observe(target, page(), 'panel', 1000);
  assert.equal(freshness(graph, 15999), 'observed');
  assert.equal(freshness(graph, 16000), 'stale');
  assert.equal(graph.confirmLive(1, 4, 60000), true);
  assert.equal(freshness(graph, 65000), 'observed');
  assert.equal(freshness(graph, 70000), 'stale', 'a live confirmation lasts 10 s');
});

test('a different revision or epoch confirms nothing', (t: TestContext) => {
  const graph = store(t);
  graph.observe(target, page(), 'panel', 1000);
  assert.equal(graph.confirmLive(1, 5, 60000), false);
  assert.equal(graph.confirmLive(2, 4, 60000), false);
  assert.equal(freshness(graph, 61000), 'stale');
});

test('invalidation and a new observation discard the live confirmation', (t: TestContext) => {
  const graph = store(t);
  graph.observe(target, page(), 'panel', 1000);
  graph.confirmLive(1, 4, 60000);
  graph.invalidate();
  assert.equal(graph.confirmLive(1, 4, 60000), false, 'no active context after invalidation');
  graph.observe(target, page(4), 'panel', 1000);
  graph.observe(target, page(5), 'panel', 2000);
  assert.equal(graph.confirmLive(1, 4, 60000), false);
});

test('live-confirmed layer rows do not report selection, which revision does not track', (t: TestContext) => {
  const graph = store(t), layers = { kind: 'layers', compositionId: '7', itemIndex: 7 };
  graph.observe(layers, { ...page(), rows: [{ id: '1', name: 'Layer', index: 1, locked: false, selected: true }] }, 'panel', 1000);
  assert.equal(fieldOf(graph.query({ target: layers }, 2000), 'rows.0.row.selected'), true);
  graph.confirmLive(1, 4, 60000);
  const confirmed = graph.query({ target: layers }, 61000);
  assert.equal(fieldOf(confirmed, 'rows.0.freshness'), 'observed');
  assert.equal(fieldOf(confirmed, 'rows.0.row.selected'), null);
});

test('demand results stay observed only while the live stamp matches', () => {
  const result = observedResult();
  assert.equal(fieldOf(observedDemandResult(result, 0, () => 20000, undefined), 'freshness'), 'stale');
  assert.equal(fieldOf(observedDemandResult(result, 0, () => 20000, 15000), 'freshness'), 'observed');
  assert.equal(fieldOf(observedDemandResult({ ...result, invalidated: true }, 0, () => 20000, 15000), 'freshness'), 'stale');
});

test('unsaved project graphs older than 14 days or beyond the cap are pruned', (t: TestContext) => {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-prune-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const now = Date.now(), day = 86400000, name = (n: number): string => `unsaved-${String(n).padStart(64, '0')}.extynt`;
  const touch = (file: string, age: number): void => { writeFileSync(join(directory, file), ''); utimesSync(join(directory, file), (now - age) / 1000, (now - age) / 1000); };
  touch(name(1), 15 * day); touch(name(1) + '-wal', 15 * day);
  for (let n = 2; n <= 30; n++) touch(name(n), n * 3600000);
  touch(`saved-${'a'.repeat(64)}.extynt`, 40 * day); touch('host-catalogue.extynt', 40 * day);
  touch(name(99), 60000);
  const removed = pruneUnsavedGraphs(directory, now, join(directory, name(30)));
  assert.ok(!existsSync(join(directory, name(1))) && !existsSync(join(directory, name(1) + '-wal')));
  assert.ok(existsSync(join(directory, `saved-${'a'.repeat(64)}.extynt`)) && existsSync(join(directory, 'host-catalogue.extynt')));
  assert.ok(existsSync(join(directory, name(99))), 'recent files are kept');
  assert.ok(existsSync(join(directory, name(30))), 'the active file is kept');
  assert.equal(removed.length, 1 + (28 - 24));
});

test('collection service accepts only a recent, well-formed live stamp', () => {
  const graph = new RecordingGraph('/synthetic/recording.extynt');
  const service = new CollectionService(() => 100000, graph);
  assert.equal(service.observeLiveStamp(1, 4, 20000), false);
  assert.equal(service.observeLiveStamp(1, 4, -1), false);
  assert.equal(service.observeLiveStamp(1.5, 4, 10), false);
  assert.equal(service.observeLiveStamp(1, 4, 2500), true);
  assert.deepEqual(graph.calls, [[1, 4, 97500]]);
});
