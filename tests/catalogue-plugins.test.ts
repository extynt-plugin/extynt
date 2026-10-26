/**
 * Tests catalogue page order and crash isolation: built-in effects first, then each plugin, retiring a repeat
 * crasher.
 */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectorHarness, hostPage, requirePage, HOST_KEY } from './catalogue-support.ts';
import type { CollectorHarness, PageItem } from './catalogue-support.ts';
import { CRASH_IDENTIFIED, CRASH_FAILURE } from '../apps/sidecar/dist/src/catalogue-collector.js';
import { parseJson, recordOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';

const installed = [
  'Example Vendor Gamma Particles',
  'ADBE Gaussian Blur 2',
  'Example Vendor Beta Mirror',
  'ADBE Glo2',
  'Example Vendor Alpha Glow',
];
const BETA = 'Example Vendor Beta Mirror';
const GAMMA = 'Example Vendor Gamma Particles';
const ALPHA = 'Example Vendor Alpha Glow';
const crumbPath = (h: CollectorHarness): string => join(h.directory, 'catalogue-probe-current.json');
const journalPath = (h: CollectorHarness): string => join(h.directory, 'catalogue-probe-journal.json');
const crumb = (h: CollectorHarness, ticket: string, phase: string, matchName: string): void =>
  writeFileSync(crumbPath(h), JSON.stringify({ ticket, phase, matchName }));
const nextPage = (h: CollectorHarness, panel = 'p', engine = false): PageItem => requirePage(h.collector.nextItem(true, panel, engine));

function failed(h: CollectorHarness): string[][] {
  const hosts = recordOf(parseJson(readFileSync(journalPath(h), 'utf8')), 'hosts');
  const entry = hosts[HOST_KEY];
  const rows = entry === undefined ? {} : recordOf(entry, 'failed');
  return Object.entries(rows).map(([key, row]) => [key.split('\0')[0] ?? key, textOf(row, 'code')]);
}

function withGammaAttempted(h: CollectorHarness): void {
  const journal = recordOf(parseJson(readFileSync(journalPath(h), 'utf8')), '');
  const hosts = recordOf(journal, 'hosts');
  const entry = recordOf(hosts[HOST_KEY], '');
  const attempts = { ...recordOf(entry, 'attempts'), [GAMMA]: 1 };
  const patched = { ...journal, hosts: { ...hosts, [HOST_KEY]: { ...entry, attempts } } };
  writeFileSync(journalPath(h), JSON.stringify(patched));
}

function drainSingles(h: CollectorHarness): string[] {
  const retries: string[] = [];
  for (let next = h.collector.nextItem(true, 'p2'); next?.hostFunction === 'aeCatalogueProbePage'; next = h.collector.nextItem(true, 'p2')) {
    const [only, ...rest] = next.hostRequest.matchNames;
    if (only === undefined || rest.length > 0) break;
    retries.push(only);
    h.collector.complete(next.ticket, jsonOf(hostPage(next)));
  }
  return retries;
}

test('Adobe effects go first in pages; plugins then follow in pages of their own, sorted', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  const first = nextPage(h);
  assert.deepEqual(first.hostRequest.matchNames, ['ADBE Gaussian Blur 2', 'ADBE Glo2']);
  h.collector.complete(first.ticket, jsonOf(hostPage(first)));
  const plugins = nextPage(h);
  assert.deepEqual(plugins.hostRequest.matchNames, [ALPHA, BETA, GAMMA]);
  h.collector.complete(plugins.ticket, jsonOf(hostPage(plugins)));
  assert.equal(nextPage(h).hostRequest.cleanup, true);
});

test('a crash inside a plugin is pinned on that plugin by the breadcrumb: it is retried alone first in a fresh engine, the rest of its page carries on', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  const adobe = nextPage(h); h.collector.complete(adobe.ticket, jsonOf(hostPage(adobe)));
  const page = nextPage(h);
  assert.deepEqual(page.hostRequest.matchNames, [ALPHA, BETA, GAMMA]);
  crumb(h, page.ticket, 'apply', BETA);
  h.restart(); h.land(installed);
  const retry = nextPage(h, 'engine:2', true);
  assert.deepEqual(retry.hostRequest.matchNames, [BETA], 'the effect named by the breadcrumb is the fresh engine\'s first page, alone');
  assert.deepEqual(failed(h), [], 'one crash late in a long run is not proof: it is not retired yet');
  assert.ok(h.events.some(event => event.event === 'catalogue.crash-retry' && event.matchName === BETA && event.phase === 'apply'));
  assert.equal(existsSync(crumbPath(h)), false, 'the breadcrumb is consumed');
  h.collector.complete(retry.ticket, jsonOf(hostPage(retry)));
  const next = nextPage(h, 'engine:2', true);
  assert.deepEqual(next.hostRequest.matchNames, [ALPHA, GAMMA], 'the innocent plugins are paged again together, not one by one');
  h.collector.complete(next.ticket, jsonOf(hostPage(next)));
  const progress = h.collector.progress();
  assert.equal(progress.failed, 0); assert.equal(progress.pending, 0); assert.equal(progress.collected, installed.length, 'the effect that crashed once is learned');
});

test('an effect that crashes again on its own retry is retired; Collect does not forgive a proven crasher', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  const adobe = nextPage(h); h.collector.complete(adobe.ticket, jsonOf(hostPage(adobe)));
  const page = nextPage(h);
  crumb(h, page.ticket, 'apply', BETA);
  h.restart(); h.land(installed);
  const retry = nextPage(h, 'engine:2', true);
  crumb(h, retry.ticket, 'apply', BETA);
  h.restart(); h.land(installed);
  const next = nextPage(h, 'engine:3', true);
  assert.deepEqual(failed(h), [[BETA, CRASH_IDENTIFIED]]);
  assert.ok(h.events.some(event => event.event === 'catalogue.crash-identified' && event.matchName === BETA));
  assert.deepEqual(next.hostRequest.matchNames, [ALPHA, GAMMA]);
  h.collector.start();
  assert.deepEqual(failed(h), [[BETA, CRASH_IDENTIFIED]]);
});

test('without a breadcrumb, effects on a page that never answered are retried one at a time, plugins included', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  const page = nextPage(h);
  h.collector.abandon(page.ticket, 'panel-replaced');
  withGammaAttempted(h);
  h.restart(); h.land(installed);
  const retries = drainSingles(h);
  assert.deepEqual(retries, ['ADBE Gaussian Blur 2', 'ADBE Glo2', GAMMA]);
  assert.equal(h.collector.progress().deferred, 0);
});

test('the engine and the user\'s After Effects wait for each other\'s page instead of abandoning it', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  const enginePage = nextPage(h, 'engine:1', true);
  assert.equal(h.collector.nextInstanceRead(true, 'panel'), undefined, 'the user lane does not abandon the engine page');
  assert.equal(h.collector.nextItem(true, 'panel'), undefined, 'nor does a non-engine page request');
  h.collector.complete(enginePage.ticket, jsonOf(hostPage(enginePage)));
  assert.ok(!h.events.some(event => event.event === 'catalogue.page-abandoned'));
});

test('the user\'s After Effects is only ever offered instance reads, never a probe page', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  assert.equal(h.collector.nextInstanceRead(true, 'panel'), undefined);
  assert.ok(nextPage(h, 'engine:1', true), 'the same pending effects are a page for the engine');
});

test('a page that only timed out (AE waiting on a plugin window) marks the effect as hanging once its retry hangs too, which Collect forgives', t => {
  const h = collectorHarness(t, { plugins: true }); h.land([BETA]);
  const page = nextPage(h);
  crumb(h, page.ticket, 'apply', BETA);
  h.clock.now += 91_000; h.collector.progress();
  assert.deepEqual(failed(h), [], 'the first hang earns a retry on its own');
  h.clock.now += 60_000;
  const retry = nextPage(h);
  assert.deepEqual(retry.hostRequest.matchNames, [BETA]);
  crumb(h, retry.ticket, 'apply', BETA);
  h.clock.now += 91_000; h.collector.progress();
  assert.deepEqual(failed(h), [[BETA, CRASH_FAILURE]]);
  h.collector.start();
  assert.deepEqual(failed(h), []);
});

test('a finished page\'s breadcrumb, or one naming an effect that was not lost, blames nothing', t => {
  const h = collectorHarness(t, { plugins: true }); h.land(installed);
  const page = nextPage(h);
  crumb(h, page.ticket, 'done', '');
  h.collector.abandon(page.ticket, 'panel-replaced');
  h.collector.start(); nextPage(h);
  assert.deepEqual(failed(h), []);
  const other = collectorHarness(t, { plugins: true }); other.land(installed);
  const lost = nextPage(other);
  crumb(other, lost.ticket, 'apply', 'some other effect');
  other.collector.abandon(lost.ticket, 'panel-replaced'); nextPage(other);
  assert.deepEqual(failed(other), []);
});
