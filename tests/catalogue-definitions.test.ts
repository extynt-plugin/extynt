/** Tests how probed effect controls become typed definition facts bound to the host key and the run. */
import { jsonFieldsOf, jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { collectorHarness, census, censusWith, hostPage, effectResult, prop, group, HOST_KEY, requirePage } from './catalogue-support.ts';
import type { CollectorHarness, GroupRow, PropertyOverrides, PropertyRow } from './catalogue-support.ts';
import type { EffectProbeRow } from '../packages/capability-catalogue/dist/src/catalogue-model.js';
import type { CatalogueCollectorOptions } from '../apps/sidecar/dist/src/catalogue-collector-types.js';
import type { ProjectGraphStore } from '../apps/sidecar/dist/src/project-graph-store.js';
import type { HostCensus } from '../apps/sidecar/dist/src/server-types.js';
import { decodeOrThrow, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import { fieldOf, numberOf, parseJson, recordOf, recordsOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';

const controls = [
  prop('FX-0001', { name: 'Amount', defaultValue: 25, hasMin: true, min: 0, hasMax: true, max: 100, canVary: true }),
  prop('FX-0002', { name: 'Quality', defaultValue: 2, isDropdown: true, items: ['Low', 'High'], canVary: false, index: 2 }),
  group('FX Group', [
    prop('FX-0003', { name: 'Origin', valueType: 'TwoD_SPATIAL', defaultValue: [32, 32], index: 1 }),
    prop('FX-0003', { name: 'Origin again', valueType: 'ThreeD', defaultValue: [1, 2, 3], index: 2, hidden: true }),
    prop('FX-0004', { name: 'Tint', valueType: 'COLOR', defaultValue: [1, 0, 0, 1], index: 3 }),
    prop('FX-0005', { name: 'Odd', valueType: 'COLOR', defaultValue: [1, 0, 0], index: 4 }),
    prop('FX-0006', { name: 'Backwards', hasMin: true, min: 9, hasMax: true, max: 1, index: 5 }),
    prop('a/b#c%d', { name: 'Escaped', valueType: 'MYSTERY', defaultValue: null, index: 6 }),
    group('Deep', [prop('FX-0007', { name: 'Deep leaf', valueType: 'LAYER_INDEX', defaultValue: 0 })], { index: 7 }),
  ], { index: 3 }),
];

const PARAMETER_FACT_SQL = `SELECT p.path,p.match_name,p.parent_parameter_id,p.ordinal,f.value_type,f.minimum,f.maximum,f.default_state,f.default_shape,
  f.can_vary,f.can_expression,f.documentation,f.meaning,f.units
  FROM parameter_definitions p JOIN parameter_definition_facts f ON f.parameter_definition_id=p.id ORDER BY p.path`;

function probed(t: TestContext): CollectorHarness {
  const h = collectorHarness(t);
  h.land(['FX', 'FX Empty']);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX', controls), effectResult('FX Empty', [])] })));
  return h;
}

function assertProbeSource(h: CollectorHarness, source: JsonObject): void {
  assert.equal(fieldOf(source, 'kind'), 'native-observation');
  assert.equal(fieldOf(source, 'observation_context'), 'factory-default');
  assert.equal(fieldOf(source, 'host_key'), HOST_KEY);
  assert.equal(fieldOf(source, 'observed_at'), h.clock.now);
  assert.equal(fieldOf(source, 'source_url'), null);
  assert.match(textOf(source, 'title'), /AE build 2; effect version v1/);
  assert.match(textOf(source, 'instance_binding'), /^catalogue-probe:id1:FX( Empty)?$/);
}

test('probed controls land as native-observation / factory-default facts bound to the host key and this run', t => {
  const h = probed(t), db = h.database();
  const sources = db.prepare("SELECT * FROM definition_sources WHERE instance_binding LIKE 'catalogue-probe:%' ORDER BY instance_binding").all();
  assert.equal(sources.length, 2);
  for (const source of sources) assertProbeSource(h, jsonFieldsOf(source));
  assert.deepEqual(sources.map(source => fieldOf(source, 'instance_binding')), ['catalogue-probe:id1:FX', 'catalogue-probe:id1:FX Empty']);
  const documentary = db.prepare("SELECT count(*) AS n FROM definition_sources WHERE kind<>'native-observation'").get();
  assert.equal(numberOf(documentary, 'n'), 0, 'nothing documentary is ever written');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const inventory = db.prepare("SELECT s.observation_context FROM effect_definitions e JOIN definition_sources s ON s.id=e.provenance_id WHERE e.match_name='FX'").get();
  assert.equal(fieldOf(inventory, 'observation_context'), 'effect-inventory', 'the census\'s own provenance on the effect row is not overwritten');
});

function assertScalarFacts(cell: (path: string, column: string) => JsonValue): void {
  assert.deepEqual(['FX-0001', 'FX Group', 'FX Group/FX-0003', 'FX Group/FX-0003#2'].map(path => cell(path, 'value_type')), ['OneD', 'NO_VALUE', 'TwoD_SPATIAL', 'ThreeD']);
  assert.deepEqual(['minimum', 'maximum', 'default_state', 'default_shape'].map(column => cell('FX-0001', column)), [0, 100, 'known', 'scalar']);
  assert.equal(cell('FX Group', 'default_state'), 'unknown');
  assert.equal(cell('FX Group/FX-0003#2', 'match_name'), 'FX-0003');
  assert.equal(cell('FX Group/FX-0004', 'default_shape'), 'vector');
  assert.equal(cell('FX Group/FX-0005', 'default_state'), 'unknown', 'a 3-channel colour is not a believable default');
  assert.deepEqual([cell('FX Group/FX-0006', 'minimum'), cell('FX Group/FX-0006', 'maximum')], [null, null], 'a contradictory range is dropped');
}

function assertSpecialFacts(cell: (path: string, column: string) => JsonValue): void {
  const escaped = 'FX Group/a%2Fb%23c%25d';
  assert.equal(cell(escaped, 'value_type'), 'unknown');
  assert.equal(cell(escaped, 'match_name'), 'a/b#c%d');
  assert.equal(cell('FX Group/Deep/FX-0007', 'value_type'), 'LAYER_INDEX');
  assert.equal(cell('FX-0002', 'can_vary'), 0);
  assert.equal(cell('FX-0001', 'can_vary'), 1);
}

function assertParameterFacts(db: DatabaseSync): void {
  const rows = db.prepare(PARAMETER_FACT_SQL).all();
  const byPath = new Map(rows.map(row => [textOf(row, 'path'), row]));
  const cell = (path: string, column: string): JsonValue => decodeOrThrow(jsonValue, fieldOf(byPath.get(path), column));
  assert.deepEqual([...byPath.keys()].sort(), [
    'FX Group', 'FX Group/Deep', 'FX Group/Deep/FX-0007', 'FX Group/FX-0003', 'FX Group/FX-0003#2', 'FX Group/FX-0004', 'FX Group/FX-0005',
    'FX Group/FX-0006', 'FX Group/a%2Fb%23c%25d', 'FX-0001', 'FX-0002',
  ]);
  assertScalarFacts(cell);
  assertSpecialFacts(cell);
  for (const row of rows) assert.deepEqual([row.documentation, row.meaning, row.units], [null, null, null]);
}

function assertParameterTree(db: DatabaseSync): void {
  const parents = db.prepare(
    'SELECT p.path AS child, q.path AS parent FROM parameter_definitions p JOIN parameter_definitions q ON q.id=p.parent_parameter_id ORDER BY p.path',
  ).all();
  assert.deepEqual(parents.map(row => [textOf(row, 'child'), textOf(row, 'parent')]), [
    ['FX Group/Deep', 'FX Group'], ['FX Group/Deep/FX-0007', 'FX Group/Deep'], ['FX Group/FX-0003', 'FX Group'], ['FX Group/FX-0003#2', 'FX Group'],
    ['FX Group/FX-0004', 'FX Group'], ['FX Group/FX-0005', 'FX Group'], ['FX Group/FX-0006', 'FX Group'], ['FX Group/a%2Fb%23c%25d', 'FX Group'],
  ]);
}

function assertDefaultComponents(db: DatabaseSync): void {
  const components = db.prepare(`SELECT p.path,c.component,c.value FROM parameter_default_components c
    JOIN parameter_definitions p ON p.id=c.parameter_definition_id WHERE p.path IN ('FX Group/FX-0003#2','FX Group/FX-0004') ORDER BY p.path,c.component`).all();
  assert.deepEqual(components.map(row => [textOf(row, 'path'), numberOf(row, 'component'), numberOf(row, 'value')]), [
    ['FX Group/FX-0003#2', 0, 1], ['FX Group/FX-0003#2', 1, 2], ['FX Group/FX-0003#2', 2, 3],
    ['FX Group/FX-0004', 0, 1], ['FX Group/FX-0004', 1, 0], ['FX Group/FX-0004', 2, 0], ['FX Group/FX-0004', 3, 1],
  ]);
  assert.deepEqual(db.prepare('SELECT label FROM parameter_definition_menu_items ORDER BY ordinal').all().map(row => textOf(row, 'label')), ['Low', 'High']);
  assert.equal(numberOf(db.prepare('SELECT count(*) AS n FROM parameter_definition_observed_ui WHERE hidden=1').get(), 'n'), 1);
}

test('parameters keep the group tree, escaped native paths and sibling suffixes; facts map to the strict enum', t => {
  const db = probed(t).database();
  assertParameterFacts(db);
  assertParameterTree(db);
  assertDefaultComponents(db);
});

test('read back as host-profile evidence, the tree keeps its shape, menus and flags; effects without controls still count as probed', t => {
  const h = probed(t);
  const evidence = h.graph.catalogueEvidence(HOST_KEY);
  assert.deepEqual(Object.keys(evidence.effects).sort(), ['FX', 'FX Empty']);
  assert.deepEqual(evidence.effects['FX Empty']?.controls, []);
  const rows = evidence.effects.FX?.controls ?? [];
  assert.deepEqual(rows[0], { m: 'FX-0001', n: 'Amount', t: 'OneD', v: 25, min: 0, max: 100 });
  assert.deepEqual(rows[1], { m: 'FX-0002', n: 'Quality', t: 'OneD', v: 2, dd: true, items: ['Low', 'High'], static: true });
  assert.deepEqual(rows[2], { m: 'FX Group', n: 'FX Group', g: 7 });
  assert.deepEqual(rows.find(row => row.n === 'Origin again'), { m: 'FX-0003', n: 'Origin again', t: 'ThreeD', v: [1, 2, 3], hid: true });
  assert.deepEqual(h.graph.catalogueEvidence('After Effects:other:macOS').effects, {}, 'another host key sees none of it');
  assert.deepEqual(Object.keys(h.graph.catalogueEvidence(HOST_KEY, ['FX Empty']).effects), ['FX Empty']);
});

type StoreMode = 'invalid' | 'storage';
type CatalogueStore = CatalogueCollectorOptions['store'];

function troubledStore(mode: { current: StoreMode }, graphOf: () => ProjectGraphStore): CatalogueStore {
  return {
    probedKeys: key => graphOf().catalogueProbedKeys(key),
    writeProbe: inputs => {
      if (mode.current === 'storage') {
        return { written: [], failed: inputs.map(input => ({ matchName: input.effect.matchName, code: 'GRAPH_STORAGE_UNAVAILABLE' })) };
      }
      const stored = graphOf().writeCatalogueProbe(inputs.filter(input => input.effect.matchName !== 'A'));
      return { written: stored.written, failed: [{ matchName: 'A', code: 'GRAPH_DEFINITION_INVALID' }] };
    },
  };
}

function attemptsInJournal(h: CollectorHarness): string[] {
  const journal = parseJson(readFileSync(join(h.directory, 'catalogue-probe-journal.json'), 'utf8'));
  return Object.keys(recordOf(recordOf(recordOf(journal, 'hosts')[HOST_KEY], ''), 'attempts'));
}

function completeFivePages(h: CollectorHarness): void {
  for (let page = 0; page < 5; page++) {
    const next = h.collector.nextItem(true, 'p');
    assert.ok(next, `page ${page}`);
    const pageItem = requirePage(next);
    h.collector.complete(pageItem.ticket, jsonOf(hostPage(pageItem)));
    assert.deepEqual(attemptsInJournal(h), [], 'a completed page is never charged to its effects');
  }
}

test('one effect the definition store refuses is recorded failed alone; storage trouble leaves effects pending and pauses after repeated failures', t => {
  const mode: { current: StoreMode } = { current: 'invalid' };
  let harness: CollectorHarness | undefined;
  const graphOf = (): ProjectGraphStore => {
    if (!harness) throw new Error('the harness is not built yet');
    return harness.graph;
  };
  const h = collectorHarness(t, { collector: { store: troubledStore(mode, graphOf) } });
  harness = h;
  h.land(['A', 'B']);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  h.collector.complete(item.ticket, jsonOf(hostPage(item)));
  assert.deepEqual([h.collector.progress().collected, h.collector.progress().failed], [1, 1]);
  mode.current = 'storage';
  h.land(['A', 'B', 'C', 'D', 'E', 'F']);
  h.graph.observeCensus(census(['A', 'B', 'C', 'D', 'E', 'F']), 1);
  completeFivePages(h);
  assert.equal(h.collector.progress().state, 'paused');
  assert.equal(h.collector.progress().pauseReason, 'graph-write-failed');
  assert.equal(h.collector.nextItem(true, 'p'), undefined);
});

const inventoryDefinitions = (h: CollectorHarness, value: HostCensus, at: number): JsonValue => decodeOrThrow(jsonValue, fieldOf(h.graph.observeCensus(value, at), 'censusDefinitions'));
const inventorySources = (h: CollectorHarness) => h.database().prepare("SELECT id,observed_at FROM definition_sources WHERE observation_context='effect-inventory' ORDER BY id").all();

function assertFingerprintSkips(h: CollectorHarness): void {
  const first = census(['A', 'B', 'C']);
  assert.equal(inventoryDefinitions(h, first, 100), 'written');
  const source = inventorySources(h);
  const again = h.graph.observeCensus(census(['C', 'B', 'A'], { requestId: 'other-order' }), 200);
  assert.equal(fieldOf(again, 'censusDefinitions'), 'unchanged');
  assert.equal(fieldOf(again, 'censusFingerprint'), fieldOf(h.graph.observeCensus(first, 300), 'censusFingerprint'), 'the fingerprint ignores order');
  assert.deepEqual(inventorySources(h), source, 'no definition row was rewritten');
  const seen = h.database().prepare("SELECT observed_at FROM installed_effects WHERE match_name='A'").get();
  assert.equal(fieldOf(seen, 'observed_at'), 300, 'the installed list still records when it was last seen');
  const stored = h.database().prepare('SELECT fingerprint FROM catalogue_fingerprints WHERE host_key=?').get(HOST_KEY);
  assert.equal(fieldOf(stored, 'fingerprint'), fieldOf(again, 'censusFingerprint'));
}

function assertFingerprintRewrites(h: CollectorHarness): void {
  const four = ['A', 'B', 'C', 'D'];
  assert.equal(inventoryDefinitions(h, census(four), 400), 'written', 'a new effect');
  assert.equal(inventoryDefinitions(h, census(four, { effectVersion: 'v2' }), 500), 'written', 'a new effect version');
  assert.equal(inventoryDefinitions(h, census(four, { effectVersion: 'v2', build: '9' }), 600), 'written', 'a new AE build');
  assert.equal(inventoryDefinitions(h, census(four, { effectVersion: 'v2', build: '9' }), 700), 'unchanged');
  h.database().exec('DELETE FROM parameter_definitions; DELETE FROM effect_definitions;');
  const rebuilt = inventoryDefinitions(h, census(four, { effectVersion: 'v2', build: '9' }), 800);
  assert.equal(rebuilt, 'written', 'definitions the file no longer holds are rebuilt even if the fingerprint matches');
  assert.equal(numberOf(h.database().prepare('SELECT count(*) AS n FROM effect_definitions').get(), 'n'), 4);
}

test('an unchanged inventory fingerprint skips rewriting definitions; a changed one rewrites; a rebuilt file is never mistaken for current', t => {
  const h = collectorHarness(t);
  assertFingerprintSkips(h);
  assertFingerprintRewrites(h);
});

test('a failed census stores no fingerprint-backed skip', t => {
  const h = collectorHarness(t), failed = censusWith(census(['A']), { completeness: 'failed' });
  assert.equal(inventoryDefinitions(h, failed, 1), 'written');
  assert.equal(inventoryDefinitions(h, failed, 2), 'written');
});

test('a definition chain followed while a project is open reads the catalogue, not the project file', t => {
  const h = probed(t);
  const page = {
    project: { name: 'Saved.aep', filePath: '/synthetic/Saved.aep' }, runtime: { appVersion: '26.2', platform: 'macOS' }, stamp: { epoch: 1, revision: 4 },
    rows: [{ id: '7', name: 'Comp 7', itemIndex: 7, type: 'composition', parentFolderId: '0', layers: 1 }],
  };
  h.graph.observe({ kind: 'index' }, page, 'panel', h.clock.now);
  assert.equal(fieldOf(h.graph.status(), 'projectKind'), 'saved');
  const effects = h.graph.queryRelational({ kind: 'effect-definitions', hostKey: HOST_KEY, matchName: 'FX' }, h.clock.now);
  assert.equal(recordsOf(effects, 'rows').length, 1);
  const parameters = h.graph.queryRelational(jsonOf({ kind: 'parameter-definitions', effectDefinitionId: fieldOf(effects, 'rows.0.id') }), h.clock.now);
  assert.ok(recordsOf(parameters, 'rows').length > 0, 'parameters of a catalogue effect come from the catalogue');
  const facts = h.graph.queryRelational(jsonOf({ kind: 'parameter-facts', parameterDefinitionId: fieldOf(parameters, 'rows.0.parameter.id') }), h.clock.now);
  assert.ok(recordsOf(facts, 'rows').length > 0);
});

interface UnitProperty extends PropertyRow {
  unitsText: string | number | null;
}

interface UnitGroup extends GroupRow {
  unitsText: string;
}

function unitProp(matchName: string, unitsText: string | number | null, extra: PropertyOverrides): UnitProperty {
  return { ...prop(matchName, extra), unitsText };
}

function unitControls(): Array<UnitProperty | UnitGroup> {
  const inner = unitProp('FXU-0005', '%', { name: 'Inner', defaultValue: 0, index: 1 });
  return [
    unitProp('FXU-0001', 'pixels', { name: 'Size', defaultValue: 25, hasMin: true, min: 0, hasMax: true, max: 200, index: 1 }),
    unitProp('FXU-0002', null, { name: 'Plain', defaultValue: 1, hasMin: true, min: 0, hasMax: true, max: 1, index: 2 }),
    unitProp('FXU-0003', 7, { name: 'Odd', defaultValue: 1, index: 3 }),
    unitProp('FXU-0004', 'x'.repeat(81), { name: 'Tall', defaultValue: 1, index: 4 }),
    { ...group('FXU Group', [inner], { index: 5 }), unitsText: 'ignored on a group' },
  ];
}

function rowAt(rows: readonly EffectProbeRow[], index: number): EffectProbeRow {
  const row = rows[index];
  if (!row) throw new Error(`no evidence row at ${index}`);
  return row;
}

function assertUnitFacts(db: DatabaseSync): void {
  const facts = db.prepare('SELECT p.path,f.units FROM parameter_definition_facts f JOIN parameter_definitions p ON p.id=f.parameter_definition_id').all();
  const units = Object.fromEntries(facts.map(row => [textOf(row, 'path'), row.units]));
  assert.deepEqual(units, { 'FXU-0001': 'pixels', 'FXU-0002': null, 'FXU-0003': null, 'FXU-0004': null, 'FXU Group': null, 'FXU Group/FXU-0005': '%' });
  const described = db.prepare('SELECT count(*) AS n FROM parameter_definition_facts WHERE documentation IS NOT NULL OR meaning IS NOT NULL').get();
  assert.equal(numberOf(described, 'n'), 0, 'native facts stay free of description and meaning');
}

test('the unit label AE reports lands on the native fact and the probe evidence row; no label means null and no row key, never a guess', t => {
  const h = collectorHarness(t);
  h.land(['FXU']);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FXU', unitControls())] })));
  assertUnitFacts(h.database());
  const rows = h.graph.catalogueEvidence(HOST_KEY).effects.FXU?.controls ?? [];
  assert.deepEqual(rows[0], { m: 'FXU-0001', n: 'Size', t: 'OneD', v: 25, min: 0, max: 200, u: 'pixels' });
  assert.equal('u' in rowAt(rows, 1), false);
  assert.equal('u' in rowAt(rows, 2), false);
  assert.equal('u' in rowAt(rows, 3), false);
  assert.equal(rows.find(row => row.m === 'FXU-0005')?.u, '%');
});
