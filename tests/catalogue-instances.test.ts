/** Tests reading effects that already sit in the open project as read-only catalogue instances. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { collectorHarness, hostPage, effectResult, group, prop, HOST_KEY, requirePage } from './catalogue-support.ts';
import type { CollectorHarness, ControlRow, HarnessOptions } from './catalogue-support.ts';
import type { CatalogueInstanceItem, CatalogueMailboxItem } from '../apps/sidecar/dist/src/catalogue-collector-types.js';
import { representativeSnapshot } from '../packages/project-graph/dist/src/index.js';
import type { CompositionSnapshot, LayerSnapshot, ProjectSnapshot, PropertySnapshot } from '../packages/project-graph/dist/src/index.js';
import { fieldOf, numberOf, parseJson, recordOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';

const names = ['FX 00', 'FX 01', 'FX 02', 'FX 03'];
const INSTANCE_FUNCTION = 'aeCatalogueReadInstance';
let serial = 0;

interface LayerSpec {
  readonly id: string;
  readonly effects: readonly string[];
}

interface CompositionSpec {
  readonly id: string;
  readonly layers: readonly LayerSpec[];
}

interface InstanceBody {
  matchName: string;
  displayName: string;
  controls: ControlRow[];
  truncated: boolean;
}

interface InstancePage {
  schemaVersion: '0.1';
  ok: true;
  requestId: string;
  host: { version: string; build: string };
  instance: InstanceBody;
}

function requireInstance(item: CatalogueMailboxItem | undefined): CatalogueInstanceItem {
  if (item?.hostFunction !== INSTANCE_FUNCTION) throw new Error('expected a catalogue instance read');
  return item;
}

function journalHost(h: CollectorHarness): JsonObject {
  const journal = parseJson(readFileSync(join(h.directory, 'catalogue-probe-journal.json'), 'utf8'));
  return recordOf(recordOf(journal, 'hosts')[HOST_KEY], '');
}

function propertyNode(matchName: string, displayName: string, kind: PropertySnapshot['kind'], path: string): PropertySnapshot {
  return { path, matchName, displayName, kind, valueType: 'unknown', value: null, canSetValue: false };
}

function layerSnapshot(layer: LayerSpec): LayerSnapshot {
  const effectNodes = layer.effects.map(matchName => propertyNode(matchName, matchName, 'effect', `ADBE Effect Parade/${matchName}`));
  return {
    id: layer.id, index: 1, name: layer.id, type: 'av', enabled: true, shy: false, solo: false, locked: false,
    startTime: 0, inPoint: 0, outPoint: 10, stretch: 100, parentId: null, matteLayerId: null, matteType: 'none', isSelected: false, sourceId: null,
    properties: [
      propertyNode('ADBE Transform Group', 'Transform', 'group', 'ADBE Transform Group'),
      { ...propertyNode('ADBE Effect Parade', 'Effects', 'group', 'ADBE Effect Parade'), children: effectNodes },
    ],
  };
}

function compositionSnapshot(comp: CompositionSpec): CompositionSnapshot {
  return {
    id: comp.id, name: `Comp ${comp.id}`, width: 1920, height: 1080, pixelAspect: 1, duration: 10, frameRate: 30, workAreaStart: 0, workAreaDuration: 10,
    layers: comp.layers.map(layerSnapshot),
  };
}

function snapshot(compositions: readonly CompositionSpec[]): ProjectSnapshot {
  serial += 1;
  return { ...representativeSnapshot, fingerprint: `fp-${serial}`, compositions: compositions.map(compositionSnapshot) };
}

const inProject = (effectNames: readonly string[]): ProjectSnapshot => snapshot([{ id: '10', layers: [{ id: '501', effects: ['ADBE Other', ...effectNames] }] }]);

function instancePage(item: CatalogueInstanceItem, overrides: Partial<InstancePage> = {}): InstancePage {
  const matchName = item.hostRequest.matchName;
  const positionControls = [prop('FX 00-Pos', { valueType: 'TwoD', defaultValue: [3, 4] })];
  const controls = [
    prop('FX 00-0001', { name: 'Opacity', index: 1, defaultValue: 80, hasMin: true, min: 0, hasMax: true, max: 100 }),
    group('FX 00-Group', positionControls, { index: 2 }),
  ];
  return {
    schemaVersion: '0.1', ok: true, requestId: item.ticket, host: { version: '26.2', build: '2' },
    instance: { matchName, displayName: `Display ${matchName}`, controls, truncated: false }, ...overrides,
  };
}

function needingSource(t: TestContext, options: HarnessOptions = {}): CollectorHarness {
  const h = collectorHarness(t, options);
  h.land(names);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  const failures = [{ matchName: 'FX 00', code: 'ADD_FAILED', detail: 'needs a C4D file' }, { matchName: 'FX 01', code: 'READ_FAILED' }];
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX 02'), effectResult('FX 03')], failures })));
  return h;
}

function cleanup(h: CollectorHarness): void {
  const page = requirePage(h.collector.nextItem(true, 'p'));
  assert.equal(page.hostRequest.cleanup, true);
  h.collector.complete(page.ticket, {
    schemaVersion: '0.1', ok: true, requestId: page.ticket, host: { version: '26.2', build: '2' },
    results: [], failures: [], remaining: [], elapsedMs: 1, cleanedUp: true,
  });
}

function withProjectRead(t: TestContext): { h: CollectorHarness; item: CatalogueInstanceItem } {
  const h = needingSource(t);
  h.collector.observeSnapshot(inProject(['FX 00']));
  return { h, item: requireInstance(h.collector.nextItem(true, 'p')) };
}

function isInstanceRead(h: CollectorHarness): boolean {
  return h.collector.nextItem(true, 'p')?.hostFunction === INSTANCE_FUNCTION;
}

test('an effect the test layer could not take, seen in the project the panel read, is offered as one read-only look at that exact instance', t => {
  const h = needingSource(t);
  assert.equal(requirePage(h.collector.nextItem(true, 'p')).hostRequest.cleanup, true, 'without a project read the scratch cleanup page is all there is');
  h.collector.abandon(h.collector.outstandingTicket() ?? '', 'test');
  h.collector.observeSnapshot(inProject(['FX 02', 'FX 00']));
  const item = requireInstance(h.collector.nextItem(true, 'p'));
  assert.equal(item.kind, 'catalogue_page');
  assert.match(item.ticket, /^cat-[A-Za-z0-9_-]+$/);
  const placed = { schemaVersion: '0.1', requestId: item.ticket, matchName: 'FX 00', compId: '10', layerId: '501', effectIndex: 3 };
  assert.deepEqual(item.hostRequest, placed, 'the position is the effect\'s place in the layer\'s parade (FX 02 is collected and not asked for)');
  assert.deepEqual(Object.keys(item).sort(), ['hostFunction', 'hostRequest', 'kind', 'ticket']);
  assert.ok(numberOf(recordOf(journalHost(h), 'instanceReads'), 'FX 00\0v1') > 0, 'the one allowed read is journaled before the request leaves');
});

test('the read runs only for an idle panel, one at a time, and never ahead of nothing: no snapshot, no job', t => {
  const h = needingSource(t);
  h.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(h.collector.nextItem(false, 'p'), undefined, 'a busy panel or a running agent turn');
  requireInstance(h.collector.nextItem(true, 'p'));
  assert.equal(h.collector.nextItem(true, 'p'), undefined, 'one outstanding at a time');
  assert.equal(h.collector.progress().outstanding, true);
  const disabled = collectorHarness(t, { enabled: false });
  disabled.land(names);
  disabled.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(disabled.collector.nextItem(true, 'p'), undefined);
});

function assertInstanceProgress(h: CollectorHarness, item: CatalogueInstanceItem): void {
  const before = h.collector.progress();
  assert.deepEqual([before.collected, before.needsSource, before.failed], [2, 1, 1]);
  const completion = h.collector.complete(item.ticket, jsonOf(instancePage(item)));
  assert.deepEqual([completion.accepted, completion.written], [true, 1]);
  const after = h.collector.progress();
  assert.deepEqual([after.collected, after.needsSource, after.failed, after.pending], [3, 0, 1, 0]);
  assert.equal('needsSourceEffects' in after, false);
  assert.deepEqual((after.failedEffects ?? []).map(entry => entry.matchName), ['FX 01'], 'only the effect that failed another way is still listed');
}

function assertInstanceSource(db: DatabaseSync): void {
  const sources = db.prepare("SELECT kind,observation_context,instance_binding,title FROM definition_sources WHERE instance_binding LIKE 'catalogue-instance:%'").all();
  assert.equal(sources.length, 1);
  assert.equal(fieldOf(sources[0], 'kind'), 'native-observation');
  assert.equal(fieldOf(sources[0], 'observation_context'), 'property-metadata');
  assert.match(textOf(sources[0], 'instance_binding'), /^catalogue-instance:id\d+:FX 00$/);
  assert.match(textOf(sources[0], 'title'), /read from a project instance.*defaults unknown/);
  const probes = db.prepare("SELECT count(*) AS n FROM definition_sources WHERE observation_context='factory-default' AND instance_binding LIKE '%:FX 00'").get();
  assert.equal(numberOf(probes, 'n'), 0, 'never recorded as a factory-default probe');
}

function assertInstanceFacts(db: DatabaseSync): void {
  const facts = db.prepare(`SELECT p.match_name,f.default_state,f.minimum,f.maximum FROM parameter_definition_facts f
    JOIN parameter_definitions p ON p.id=f.parameter_definition_id JOIN definition_sources s ON s.id=f.provenance_id
    WHERE s.instance_binding LIKE 'catalogue-instance:%' ORDER BY p.ordinal,p.id`).all();
  assert.deepEqual(facts.map(row => textOf(row, 'match_name')).sort(), ['FX 00-0001', 'FX 00-Group', 'FX 00-Pos']);
  assert.ok(facts.every(row => fieldOf(row, 'default_state') === 'unknown'), 'a project instance cannot tell the factory default');
  const opacity = facts.find(row => fieldOf(row, 'match_name') === 'FX 00-0001');
  assert.deepEqual([fieldOf(opacity, 'minimum'), fieldOf(opacity, 'maximum')], [0, 100]);
  const components = db.prepare(`SELECT count(*) AS n FROM parameter_default_components
    WHERE provenance_id IN (SELECT id FROM definition_sources WHERE instance_binding LIKE 'catalogue-instance:%')`).get();
  assert.equal(numberOf(components, 'n'), 0);
}

test('what the read returns counts as collected: structure kept, defaults unknown, provenance names the project instance', t => {
  const { h, item } = withProjectRead(t);
  assertInstanceProgress(h, item);
  assertInstanceSource(h.database());
  assertInstanceFacts(h.database());
  assert.equal(h.events.filter(event => event.event === 'catalogue.instance-learned').length, 1);
});

test('the host profile\'s control evidence includes the instance-read structure, with no default values, and a factory probe would win', t => {
  const { h, item } = withProjectRead(t);
  h.collector.complete(item.ticket, jsonOf(instancePage(item)));
  const evidence = h.graph.catalogueEvidence(HOST_KEY, ['FX 00', 'FX 02']);
  const controls = evidence.effects['FX 00']?.controls ?? [];
  assert.deepEqual(controls.map(row => row.m), ['FX 00-0001', 'FX 00-Group', 'FX 00-Pos']);
  assert.ok(controls.every(row => row.v === undefined), 'no factory default is claimed');
  assert.deepEqual([controls[0]?.min, controls[0]?.max], [0, 100]);
  assert.ok(evidence.effects['FX 02'], 'a factory-probed effect is unchanged');
});

function assertNoRereadAfterSuccess(t: TestContext): void {
  const { h, item } = withProjectRead(t);
  h.collector.complete(item.ticket, jsonOf(instancePage(item)));
  h.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(requirePage(h.collector.nextItem(true, 'p')).hostRequest.cleanup, true, 'collected; only the scratch cleanup remains');
  h.collector.abandon(h.collector.outstandingTicket() ?? '', 'test');
  h.restart();
  h.land(names);
  h.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(isInstanceRead(h), false, 'a restart does not read it again');
}

function assertRefusedReadIsSpent(t: TestContext): void {
  const { h: refused, item: first } = withProjectRead(t);
  refused.collector.complete(first.ticket, { schemaVersion: '0.1', ok: false, requestId: first.ticket, error: { code: 'READ_FAILED', message: 'x' } });
  refused.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(isInstanceRead(refused), false, 'a read After Effects answered but could not do is the one allowed read');
  assert.equal(refused.collector.progress().needsSource, 1, 'and the effect is still waiting for a layer source');
}

function assertMovedProjectRetriesThrice(t: TestContext): void {
  const moved = needingSource(t);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    moved.collector.observeSnapshot(inProject(['FX 00']));
    const issued = moved.collector.nextItem(true, 'p');
    assert.equal(issued?.hostFunction, INSTANCE_FUNCTION, `attempt ${attempt}`);
    const instance = requireInstance(issued);
    moved.collector.complete(instance.ticket, { schemaVersion: '0.1', ok: false, requestId: instance.ticket, error: { code: 'EFFECT_MISMATCH', message: 'moved' } });
  }
  moved.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(isInstanceRead(moved), false, 'the project keeps moving; this effect is given up on');
}

test('at most one read per effect per host and version: not again after success, restart, or a refused read; a read that found the project moved may retry up to three times', t => {
  assertNoRereadAfterSuccess(t);
  assertRefusedReadIsSpent(t);
  assertMovedProjectRetriesThrice(t);
});

test('only effects that failed without misbehaving are looked up: a crasher, an unremovable or invalid effect, and a collected one never are', t => {
  const h = collectorHarness(t);
  h.land(names);
  const item = requirePage(h.collector.nextItem(true, 'p'));
  const failures = [{ matchName: 'FX 00', code: 'REMOVE_FAILED' }, { matchName: 'FX 01', code: 'CANNOT_ADD' }, { matchName: 'FX 02', code: 'ADD_FAILED' }];
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX 03')], failures })));
  h.collector.observeSnapshot(inProject(['FX 00', 'FX 01', 'FX 02', 'FX 03']));
  const issued: string[] = [];
  for (let n = 0; n < 4; n += 1) {
    const next = h.collector.nextItem(true, 'p');
    if (next?.hostFunction !== INSTANCE_FUNCTION) break;
    issued.push(next.hostRequest.matchName);
    h.collector.complete(next.ticket, { ok: false, requestId: next.ticket, error: { code: 'READ_FAILED' } });
  }
  assert.deepEqual(issued.sort(), ['FX 01', 'FX 02'], 'cannot-add and needs-source are looked up; remove-failed and collected are not');
});

test('the answer is accepted only for the ticket and effect asked about', t => {
  const { h, item } = withProjectRead(t);
  const wrong = h.collector.complete(item.ticket, jsonOf(instancePage(item, { instance: { ...instancePage(item).instance, matchName: 'FX 01' } })));
  assert.equal(wrong.accepted, false);
  assert.equal(h.collector.progress().needsSource, 1, 'nothing was recorded');
  assert.throws(() => h.collector.complete(item.ticket, jsonOf(instancePage(item))), /STALE_CATALOGUE_TICKET/);
  const { h: second, item: other } = withProjectRead(t);
  assert.equal(second.collector.complete(other.ticket, jsonOf(instancePage(other, { requestId: 'cat-forged' }))).accepted, false);
  assert.equal(second.collector.progress().needsSource, 1);
});

test('a store that cannot record instances turns project learning off; a changed host is not trusted', t => {
  const off = needingSource(t, { withoutInstances: true });
  off.collector.observeSnapshot(inProject(['FX 00']));
  assert.equal(isInstanceRead(off), false);
  const { h: other, item } = withProjectRead(t);
  assert.equal(other.collector.complete(item.ticket, jsonOf(instancePage(item, { host: { version: '99.0', build: '9' } }))).accepted, false);
  assert.equal(other.collector.progress().needsSource, 1);
});

test('a read that never ran in After Effects (an older catalogue.jsx still loaded, a busy lane) does not use up the effect\'s one read', t => {
  const { h, item: first } = withProjectRead(t);
  h.collector.complete(first.ticket, { ok: false, requestId: first.ticket, error: { code: 'INVALID_PAGE', reason: 'EvalScript error.' } });
  h.collector.observeSnapshot(inProject(['FX 00']));
  const again = h.collector.nextItem(true, 'p');
  assert.equal(again?.hostFunction, INSTANCE_FUNCTION, 'looked for again after the script is reloaded');
  const retry = requireInstance(again);
  h.collector.complete(retry.ticket, jsonOf(instancePage(retry)));
  assert.equal(h.collector.progress().needsSource, 0, 'and learned once it ran');
});

test('reading a project works while scratch collection is paused for a real project, and a timeout is not blamed on the effect', t => {
  cleanup(needingSource(t));
  const more = collectorHarness(t);
  more.land(['FX 05', ...names]);
  const page = requirePage(more.collector.nextItem(true, 'p'));
  more.collector.complete(page.ticket, { ok: false, requestId: page.ticket, error: { code: 'NOT_SCRATCH_PROJECT', reason: 'project-saved' } });
  assert.equal(more.collector.progress().state, 'paused');
  const mixed = needingSource(t);
  cleanup(mixed);
  mixed.collector.observeSnapshot(inProject(['FX 00']));
  const item = requireInstance(mixed.collector.nextItem(true, 'p'));
  mixed.collector.complete(item.ticket, { ok: false, requestId: item.ticket, error: { code: 'HOST_TIMEOUT' } });
  assert.deepEqual([mixed.collector.progress().failed, mixed.collector.progress().needsSource], [1, 1], 'no crash is recorded for a read');
});
