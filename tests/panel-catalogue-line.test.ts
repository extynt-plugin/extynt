/** Tests the panel's catalogue progress line in plain words. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeOrThrow } from '../packages/decode/dist/src/index.js';
import { CATALOGUE_PAGE_EFFECTS, catalogueAnnouncement, catalogueProgressDecoder, deriveCatalogueLine as deriveFrom, learnEstimate } from '../apps/panel/dist/runtime/panel-catalogue-line.js';
import type { CatalogueLine, CatalogueProgress } from '../apps/panel/dist/runtime/panel-catalogue-line.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';

type WireInput = JsonValue | undefined;

type ProgressWire = {
  state: string;
  hostKey: string;
  installed: number;
  collected: number;
  pending: number;
  failed: number;
  deferred: number;
  lastPageMs: number;
  totalProbeMs: number;
  probedThisRun: number;
  pauseReason: string | null;
  outstanding: boolean;
  engineHosts?: number;
};

type ProgressOverride = Partial<ProgressWire>;

const deriveCatalogueLine = (reported: WireInput): CatalogueLine | null => deriveFrom(decodeOrThrow(catalogueProgressDecoder, reported));

const wire = (over: ProgressOverride): ProgressWire => ({ state: 'collecting', hostKey: 'AE:26', installed: 584, collected: 212, pending: 372, failed: 0, deferred: 0, lastPageMs: 80, totalProbeMs: 0, probedThisRun: 0, pauseReason: null, outstanding: false, ...over });
const progress = (over: ProgressOverride = {}): CatalogueProgress | null => decodeOrThrow(catalogueProgressDecoder, wire(over));
const line = (over: ProgressOverride = {}): CatalogueLine | null => deriveCatalogueLine(wire(over));

function lineOf(over: ProgressOverride = {}): CatalogueLine {
  const found = line(over);
  if (found === null) throw new Error('expected a catalogue line');
  return found;
}

const HELD: ProgressOverride = { state: 'paused', pauseReason: 'not-scratch-project' };
const CODE = /[A-Z]{2,}_[A-Z_]+|not-scratch|\b(sidecar|journal|census|catalogue|collector)\b/i;

test('learning shows installed minus pending over installed, in plain words', () => {
  assert.deepEqual(line(), { kind: 'learning', text: 'Learning your effects… 212 / 584' });
  assert.equal(lineOf({ pending: 0, state: 'collecting' }).text, 'Learning your effects… 584 / 584', 'the cleanup page after the last effect is still learning');
  assert.equal(lineOf({ installed: 5, collected: 0, pending: 5 }).text, 'Learning your effects… 0 / 5');
});

test('the hint shows once the host has refused the project', () => {
  assert.equal(lineOf({ ...HELD, collected: 581, pending: 3 }).kind, 'pending');
  assert.equal(line({ ...HELD, pending: 0 }), null, 'nothing pending: nothing to ask for');
});

test('a stop the user can clear says where it stopped and how to retry; stops they cannot clear say nothing', () => {
  const stopped = line({ state: 'paused', pauseReason: 'repeated-page-failures' });
  assert.deepEqual(stopped, { kind: 'stopped', text: 'Learning your effects stopped at 212 / 584. extynt tries again by itself.' });
  assert.equal(line({ state: 'paused', pauseReason: 'host-changed', pending: 0 }), null);
  assert.equal(line({ state: 'unavailable', pauseReason: 'graph-storage-unavailable' }), null);
});

test('with no After Effects to learn in, the line says so; it never counts forever with nothing running', () => {
  for (const state of ['collecting', 'paused']) {
    const none = lineOf({ state, engineHosts: 0 });
    assert.equal(none.kind, 'unavailable', state);
    assert.match(none.text, /no After Effects 2025 or later/);
    assert.equal(CODE.test(none.text), false);
  }
  assert.equal(lineOf({ state: 'collecting', engineHosts: 1 }).kind, 'learning', 'an engine host is there: learning is true');
  assert.equal(lineOf({ state: 'collecting' }).kind, 'learning', 'an older sidecar does not say; the count stands');
  assert.equal(line({ state: 'complete', pending: 0, engineHosts: 0 }), null, 'nothing pending: nothing to explain');
  assert.equal(catalogueAnnouncement(null, lineOf({ engineHosts: 0 }), progress({ engineHosts: 0 })), "Your effects can't be learned yet: extynt found no After Effects 2025 or later here to learn them in.", 'spoken once, not as "learning"');
});

test('done, not started and unknown shapes produce no line', () => {
  const quiet: readonly ProgressOverride[] = [{ state: 'complete', pending: 0 }, { state: 'complete', pending: 0, deferred: 3 }, { state: 'disabled' }, { state: 'idle' }];
  for (const over of quiet) assert.equal(line(over), null, JSON.stringify(over));
  const unknownShapes: readonly WireInput[] = [null, undefined, 'x', 5, [], {}, { state: 5 }];
  for (const bad of unknownShapes) assert.equal(deriveCatalogueLine(bad), null, JSON.stringify(bad));
  assert.equal(deriveCatalogueLine({ state: 'collecting', installed: 'many', pending: NaN }), null, 'no installed effects reported: no "0 / 0"');
});

test('no line ever carries an internal word or code', () => {
  const cases = [line(), line({ ...HELD, collected: 581, pending: 3 }), line({ state: 'paused', pauseReason: 'not-scratch-project' }), line({ state: 'paused', pauseReason: 'journal-unwritable' })];
  for (const entry of cases) assert.ok(entry && !CODE.test(entry.text), entry?.text);
});

test('the time to learn is measured when there is a sample, rounded up, and absent when there is nothing to stand on', () => {
  assert.equal(learnEstimate(0, 100, 5000), null);
  assert.equal(learnEstimate(3, 0, 0), 'a few seconds');
  assert.equal(learnEstimate(8, 0, 0), 'a few seconds');
  assert.equal(learnEstimate(9, 0, 0), null);
  assert.equal(learnEstimate(3, 7, 7000), 'a few seconds', 'fewer than eight answered effects is not a measurement');
  assert.equal(learnEstimate(3, 32, 3200), '~5 s');
  assert.equal(learnEstimate(20, 32, 3200), '~5 s');
  assert.equal(learnEstimate(100, 40, 10000), '~35 s');
  assert.equal(learnEstimate(584, 40, 10000), '~4 min');
});

test('a measured estimate reaches the hint', () => {
  assert.equal(lineOf({ ...HELD, collected: 534, pending: 50, probedThisRun: 40, totalProbeMs: 10000 }).text, '50 new effects not learned yet — open a new empty project to learn them (~20 s)');
});

test('the page size the estimate assumes is the one the sidecar uses', () => {
  const source = readFileSync('apps/sidecar/src/catalogue-page.ts', 'utf8');
  assert.equal(Number(/CATALOGUE_MAX_EFFECTS = (\d+)/.exec(source)?.[1]), CATALOGUE_PAGE_EFFECTS);
});

test('announcements: start, finish and a needed action are spoken; counting is not', () => {
  const learning = (n: number): CatalogueLine => ({ kind: 'learning', text: `Learning your effects… ${n} / 584` });
  const done = progress({ state: 'complete', pending: 0 });
  assert.equal(catalogueAnnouncement(null, learning(0), progress()), 'Learning your effects. This runs in the background.');
  assert.equal(catalogueAnnouncement(learning(0), learning(300), progress()), null);
  assert.equal(catalogueAnnouncement(learning(300), null, done), 'Finished learning your effects.');
  assert.equal(catalogueAnnouncement(null, null, done), null, 'a panel that opens with everything learned says nothing');
  assert.equal(catalogueAnnouncement(learning(300), null, progress({ state: 'idle' })), null, 'a line that vanishes without completion is not "finished"');
  const hint = lineOf({ ...HELD, collected: 581, pending: 3 });
  assert.equal(catalogueAnnouncement(learning(300), hint, progress()), '3 new effects not learned yet — open a new empty project to learn them (a few seconds).');
  assert.equal(catalogueAnnouncement(hint, hint, progress()), null);
  const stopped = lineOf({ state: 'paused', pauseReason: 'host-changed' });
  assert.equal(catalogueAnnouncement(null, stopped, progress()), stopped.text, 'no doubled full stop');
});
