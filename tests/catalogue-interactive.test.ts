/** Tests how effects that wait on a plugin window are deferred, remembered and offered again on request. */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectorHarness, hostPage, effectResult, requirePage, HOST_KEY } from './catalogue-support.ts';
import type { CensusOptions, CollectorHarness, EffectResult, HostFailure, LoggedEvent, PageItem } from './catalogue-support.ts';
import { INTERACTIVE_APPLY_MS } from '../apps/sidecar/dist/src/catalogue-collector.js';
import { maybeRecordOf, parseJson, recordOf } from '../apps/sidecar/dist/tests/http-json.js';

interface TimedEffect extends EffectResult {
  applyMs: number;
  createdItems: number;
}

interface TimedFailure extends HostFailure {
  readonly applyMs: number;
  readonly createdItems: number;
}

interface NotScratchAnswer {
  readonly schemaVersion: '0.1';
  readonly ok: false;
  readonly requestId: string;
  readonly error: { readonly code: string; readonly reason: string };
}

const names = (count: number): string[] => Array.from({ length: count }, (_, i) => `FX ${String(i).padStart(2, '0')}`);
const journalPath = (h: CollectorHarness): string => join(h.directory, 'catalogue-probe-journal.json');
const timed = (name: string, applyMs: number, createdItems = 0): TimedEffect => ({ ...effectResult(name), applyMs, createdItems });
const build3 = { host: { version: '26.2', build: '3' } };
const build3Census: CensusOptions = { build: '3' };
const notScratch = (ticket: string): NotScratchAnswer => ({
  schemaVersion: '0.1',
  ok: false,
  requestId: ticket,
  error: { code: 'NOT_SCRATCH_PROJECT', reason: 'foreign-items' },
});

function interactive(h: CollectorHarness): string[] {
  const hosts = recordOf(parseJson(readFileSync(journalPath(h), 'utf8')), 'hosts');
  return Object.keys(maybeRecordOf(hosts[HOST_KEY], 'interactive') ?? {});
}

function pageEvent(h: CollectorHarness): LoggedEvent {
  const found = h.events.find(event => event.event === 'catalogue.page');
  if (!found) throw new Error('expected a catalogue.page event');
  return found;
}

function nextPage(h: CollectorHarness): PageItem {
  return requirePage(h.collector.nextItem(true, 'p'));
}

test('an effect whose add waited on a plugin window is kept, remembered, and left out of later automatic runs', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  const item = nextPage(h);
  const results = [timed('FX 00', 20), timed('FX 01', INTERACTIVE_APPLY_MS + 4000, 2), timed('FX 02', 15)];
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results })));
  assert.equal(h.collector.progress().collected, 3, 'the answer after the window closed is still a real schema');
  assert.deepEqual(interactive(h), ['FX 01']);
  const page = pageEvent(h);
  assert.equal(page.interactive, 1);
  assert.equal(page.createdItems, 2);

  h.land(names(3), build3Census);
  const again = nextPage(h);
  assert.deepEqual(again.hostRequest.matchNames, ['FX 00', 'FX 02']);
  h.collector.complete(again.ticket, jsonOf(hostPage(again, build3)));
  const progress = h.collector.progress();
  assert.equal(progress.deferred, 1);
  assert.equal(progress.pending, 0);
  assert.equal(nextPage(h).hostRequest.cleanup, true, 'nothing automatic is left but the cleanup page');
});

test('the user pressing Collect includes deferred effects, and a quick add forgets the mark', t => {
  const h = collectorHarness(t);
  h.land(names(1));
  const item = nextPage(h);
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [timed('FX 00', INTERACTIVE_APPLY_MS)] })));
  h.land(names(1), build3Census);
  assert.equal(h.collector.progress().deferred, 1);
  h.collector.start();
  assert.equal(h.collector.progress().deferred, 0);
  const manual = nextPage(h);
  assert.deepEqual(manual.hostRequest.matchNames, ['FX 00']);
  h.collector.complete(manual.ticket, jsonOf(hostPage(manual, { ...build3, results: [timed('FX 00', 30)] })));
  assert.deepEqual(interactive(h), [], 'licensed or reconfigured: it no longer opens a window');
  h.land(names(1), build3Census);
  assert.equal(h.collector.progress().collected, 1);
});

test('a host failure that held AE on a window is remembered too', t => {
  const h = collectorHarness(t);
  h.land(names(2));
  const item = nextPage(h);
  const held: TimedFailure = { matchName: 'FX 00', code: 'ADD_FAILED', applyMs: 9000, createdItems: 1 };
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [timed('FX 01', 10)], failures: [held] })));
  assert.deepEqual(interactive(h), ['FX 00']);
  assert.equal(pageEvent(h).createdItems, 1);
});

function resumedByProject(h: CollectorHarness): boolean {
  return h.events.some(event => event.event === 'catalogue.resumed' && event.reason === 'project-changed');
}

test('a not-scratch pause resumes when a different project opens, at most every 30 s, and never for the same project', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  h.collector.observeProjectEpoch(4);
  const item = nextPage(h);
  h.collector.complete(item.ticket, jsonOf(notScratch(item.ticket)));
  assert.equal(h.collector.progress().state, 'paused');
  h.collector.observeProjectEpoch(4);
  assert.equal(h.collector.progress().state, 'paused', 'edits in the same project do not resume it');
  h.collector.observeProjectEpoch(5);
  assert.equal(h.collector.progress().state, 'collecting');
  assert.ok(resumedByProject(h));

  const next = nextPage(h);
  h.collector.complete(next.ticket, jsonOf(notScratch(next.ticket)));
  h.clock.now += 10_000;
  h.collector.observeProjectEpoch(6);
  assert.equal(h.collector.progress().state, 'paused', 'throttled');
  h.clock.now += 25_000;
  h.collector.observeProjectEpoch(6);
  assert.equal(h.collector.progress().state, 'collecting', 'the switch seen during the throttle is not lost');
});

test('other pauses are not resumed by a project switch', t => {
  const h = collectorHarness(t);
  h.land(names(1));
  h.collector.observeProjectEpoch(1);
  const item = nextPage(h);
  h.collector.complete(item.ticket, { schemaVersion: '0.1', ok: false, requestId: item.ticket, error: { code: 'SETUP_FAILED' } });
  h.collector.observeProjectEpoch(2);
  assert.equal(h.collector.progress().pauseReason, 'setup-failed');
});

test('a journal without an interactive map loads with an empty interactive map', t => {
  const h = collectorHarness(t);
  const journal = { schemaVersion: 1, cleanup: false, hosts: { [HOST_KEY]: { attempts: { 'FX 00': 1 }, failed: {} } } };
  writeFileSync(journalPath(h), JSON.stringify(journal));
  h.restart();
  h.land(names(1));
  assert.equal(nextPage(h).hostRequest.matchNames.length, 1);
  assert.deepEqual(interactive(h), []);
});

test('an effect known to open a dialog is never probed, not even on the user Collect press', t => {
  const h = collectorHarness(t);
  h.land(['ADBE Apply Color LUT2', 'FX 00']);
  const item = nextPage(h);
  assert.deepEqual(item.hostRequest.matchNames, ['FX 00']);
  h.collector.complete(item.ticket, jsonOf(hostPage(item)));
  assert.equal(h.collector.progress().deferred, 1);
  h.collector.start();
  const manual = h.collector.nextItem(true, 'p');
  assert.ok(manual === undefined || !requirePage(manual).hostRequest.matchNames.includes('ADBE Apply Color LUT2'));
});
