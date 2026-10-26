/**
 * Tests the shared policy for stored rows that do not decode: list reads skip them and report a degraded store,
 * definition tables keep a typed failure, and writes forget what the catalogue derived.
 */
import { jsonFieldsOf, jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SQLOutputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EffectRef } from '../apps/sidecar/dist/src/effect-notes-types.js';
import { collectorHarness, effectResult, hostPage, prop, requirePage, HOST_KEY } from './catalogue-support.ts';
import type { CollectorHarness } from './catalogue-support.ts';
import { textOf } from '../apps/sidecar/dist/tests/http-json.js';
import { wireJson } from '../packages/decode/dist/src/index.js';
import { present, probeResult } from './effect-notes-support.ts';
import { evidenceCacheOf } from '../apps/sidecar/dist/src/catalogue-evidence-cache.js';
import { readCatalogueEvidence, writeCatalogueEffect } from '../apps/sidecar/dist/src/catalogue-definitions.js';
import { observedControls } from '../apps/sidecar/dist/src/effect-notes-observed.js';
import { GraphStore } from '../apps/sidecar/dist/src/graph-store.js';
import { queryParameterDefinitionFacts, queryParameterDefinitions } from '../apps/sidecar/dist/src/effect-definition-store.js';

type Harness = CollectorHarness;
type Test = Parameters<typeof collectorHarness>[0];

async function probed(t: Test): Promise<Harness> {
  const h = collectorHarness(t); h.land(['FX', 'FY']);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  const results = [effectResult('FX', [prop('FX-1', { defaultValue: 5 })]), effectResult('FY', [prop('FY-1', { defaultValue: 7 })])];
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results })));
  return h;
}

function idOf(row: Record<string, SQLOutputValue> | undefined): string { return textOf(jsonFieldsOf(row), 'id'); }

const fx: EffectRef = { hostKey: HOST_KEY, matchName: 'FX', displayName: 'Display FX', category: '', version: 'v1', pluginKey: '' };

test('a catalogue effect whose stored tree does not decode is skipped and the store reports it, the rest still reads', async t => {
  const h = await probed(t), db = h.database();
  db.exec('PRAGMA ignore_check_constraints=ON');
  db.prepare("UPDATE parameter_definition_observed_ui SET is_group=5 WHERE parameter_definition_id IN (SELECT id FROM parameter_definitions WHERE match_name='FY-1')").run();
  assert.deepEqual(Object.keys(h.graph.catalogueEvidence(HOST_KEY).effects), ['FX']);
  const status = h.graph.status();
  assert.equal(textOf(status, 'catalogue.state'), 'degraded'); assert.equal(textOf(status, 'catalogue.code'), 'GRAPH_ROW_INVALID');
});

test('a malformed definition keeps its typed failure but never makes the catalogue unavailable', async t => {
  const h = await probed(t), db = h.database();
  db.exec('PRAGMA ignore_check_constraints=ON');
  db.prepare("UPDATE parameter_definition_facts SET value_type='bogus' WHERE parameter_definition_id IN (SELECT id FROM parameter_definitions WHERE match_name='FY-1')").run();
  const id = idOf(db.prepare("SELECT id FROM effect_definitions WHERE match_name='FY'").get());
  assert.throws(() => queryParameterDefinitions(db, { effectDefinitionId: id, limit: 25 }), /GRAPH_DEFINITION_ROW_INVALID/);
  assert.deepEqual(Object.keys(h.graph.catalogueEvidence(HOST_KEY).effects).sort(), ['FX', 'FY']);
  assert.notEqual(textOf(h.graph.status(), 'catalogue.state'), 'unavailable');
});

test('a notes observation on a cold cache reads one effect and never builds the host-wide source table', async t => {
  const h = await probed(t), db = h.database();
  const observed = observedControls(db, fx, null);
  assert.equal(observed.probed, true); assert.equal(observed.controls.length, 1);
  const cache = evidenceCacheOf(db);
  assert.equal(cache.probeSources.size, 0); assert.equal(cache.instanceSources.size, 0);
  assert.equal(observedControls(db, { ...fx, matchName: 'Missing' }, null).probed, false);
});

test('every write to the definition tables forgets what the catalogue derived from them', async t => {
  const h = await probed(t), db = h.database();
  readCatalogueEvidence(db, HOST_KEY);
  const cache = evidenceCacheOf(db);
  assert.ok(cache.trees.size > 0 && cache.probeSources.size > 0);
  writeCatalogueEffect(db, { hostKey: HOST_KEY, runId: 'r2', observedAt: h.clock.now + 1, hostBuild: '2', version: 'v1', effect: probeResult('FX', [prop('FX-1', { defaultValue: 9 })]) });
  assert.equal(evidenceCacheOf(db).trees.size, 0); assert.equal(evidenceCacheOf(db).probeSources.size, 0);
  assert.equal(present(present(readCatalogueEvidence(db, HOST_KEY, ['FX']).effects.FX).controls?.[0]).v, 9);
});

test('a stored default component that is not finite is a typed definition failure, not a value', async t => {
  const h = await probed(t), db = h.database();
  const parameter = idOf(db.prepare("SELECT id FROM parameter_definitions WHERE match_name='FY-1'").get());
  assert.deepEqual(present(queryParameterDefinitionFacts(db, { parameterDefinitionId: parameter, limit: 8 }).rows[0]).facts.defaultValue, { state: 'known', value: 7 });
  db.prepare('UPDATE parameter_default_components SET value=1e999 WHERE parameter_definition_id=?').run(parameter);
  assert.throws(() => queryParameterDefinitionFacts(db, { parameterDefinitionId: parameter, limit: 8 }), /GRAPH_DEFINITION_ROW_INVALID/);
});

function replaceRun(run: typeof wireJson.run): void {
  Object.defineProperty(wireJson, 'run', { value: run, writable: true, configurable: true, enumerable: true });
}

test('one observation decodes its page once', t => {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-once-')), store = new GraphStore(join(directory, 'project-graph.extynt'));
  const original = wireJson.run, pageReads = { count: 0 };
  const page = {
    project: { name: 'Saved.aep', filePath: '/synthetic/Saved.aep' }, runtime: { appVersion: '26.2', platform: 'macOS' }, stamp: { epoch: 1, revision: 4 },
    rows: [{ id: '7', name: 'Comp', itemIndex: 7, type: 'composition', parentFolderId: '0', layers: 1 }],
  };
  t.after(() => { replaceRun(original); store.close(); rmSync(directory, { recursive: true, force: true }); });
  replaceRun(input => { if (input === page) pageReads.count += 1; return original(input); });
  assert.equal(textOf(store.observe({ kind: 'index' }, page, 'panel', 10), 'state'), 'ready');
  assert.equal(pageReads.count, 1);
});
