/**
 * Tests the catalogue collector's paging: when a page is handed out, what it asks the host, and how attempts are
 * journaled.
 */
import { jsonOf } from '../packages/mcp-server/dist/src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectorHarness, hostPage, effectResult, requirePage, HOST_KEY } from './catalogue-support.ts';
import type { CollectorHarness, HostFailure, HostPage, PageItem } from './catalogue-support.ts';
import type { CatalogueProgress } from '../apps/sidecar/dist/src/catalogue-collector.js';
import type { JsonObject } from '../apps/sidecar/dist/tests/http-json.js';
import { decodeOrThrow, jsonValue } from '../packages/decode/dist/src/index.js';
import type { JsonValue } from '../packages/decode/dist/src/index.js';
import { fieldOf, maybeRecordOf, parseJson, recordOf, textOf } from '../apps/sidecar/dist/tests/http-json.js';

interface CleanedPage extends HostPage {
  cleanedUp: true;
}

interface DetailedFailure {
  readonly matchName: string;
  readonly code: string;
  readonly detail?: JsonValue;
}

const names = (count: number): string[] => Array.from({ length: count }, (_, i) => `FX ${String(i).padStart(2, '0')}`);
const journalPath = (h: CollectorHarness): string => join(h.directory, 'catalogue-probe-journal.json');
const journal = (h: CollectorHarness): JsonValue => decodeOrThrow(jsonValue, parseJson(readFileSync(journalPath(h), 'utf8')));
const nextPage = (h: CollectorHarness, panel = 'p'): PageItem => requirePage(h.collector.nextItem(true, panel));
const cleanedPage = (item: PageItem): CleanedPage => ({ ...hostPage(item, { elapsedMs: 0 }), cleanedUp: true });
const hostFailures = (h: CollectorHarness): JsonObject => {
  const entry = recordOf(journal(h), 'hosts')[HOST_KEY];
  return { ...maybeRecordOf(entry, 'failed') };
};

function attempts(h: CollectorHarness): JsonObject {
  const entry = recordOf(journal(h), 'hosts')[HOST_KEY];
  return { ...maybeRecordOf(entry, 'attempts') };
}

function failed(h: CollectorHarness): string[] {
  return Object.values(hostFailures(h)).map(entry => textOf(entry, 'code'));
}

function entryAt<T>(list: readonly T[] | undefined, index: number): T {
  const found = list?.[index];
  if (found === undefined) throw new Error(`expected an entry at ${index}`);
  return found;
}

function listed<T>(list: T[] | undefined): T[] {
  if (!list) throw new Error('expected the list to be present');
  return list;
}

function started(h: CollectorHarness): CatalogueProgress {
  const progress = h.collector.start();
  if (!('state' in progress)) throw new Error('expected a started collection');
  return progress;
}

test('nothing is handed out before a census, when disabled, or while the panel is busy; one page is outstanding at a time', t => {
  const h = collectorHarness(t);
  assert.equal(h.collector.nextItem(true, 'panel-1'), undefined);
  assert.equal(h.collector.progress().state, 'idle');
  h.land(names(3));
  assert.equal(h.collector.nextItem(false, 'panel-1'), undefined, 'busy panel or running agent turn');
  const item = h.collector.nextItem(true, 'panel-1');
  assert.ok(item);
  assert.equal(h.collector.nextItem(true, 'panel-1'), undefined, 'a second page waits for the first');
  assert.equal(h.collector.progress().outstanding, true);
  const off = collectorHarness(t, { enabled: false });
  off.land(names(3));
  assert.equal(off.collector.nextItem(true, 'panel-1'), undefined);
  assert.equal(off.collector.progress().state, 'disabled');
});

test('a page is the mailbox item the panel runs: one whitelisted host function, a bounded request, sorted effects', t => {
  const h = collectorHarness(t);
  h.land(names(20).reverse());
  const item = nextPage(h, 'panel-1');
  assert.equal(item.kind, 'catalogue_page');
  assert.equal(item.hostFunction, 'aeCatalogueProbePage');
  assert.match(item.ticket, /^cat-[A-Za-z0-9_-]+$/);
  assert.deepEqual(Object.keys(item).sort(), ['hostFunction', 'hostRequest', 'kind', 'ticket']);
  const breadcrumb = join(h.directory, 'catalogue-probe-current.json');
  assert.deepEqual(item.hostRequest, { schemaVersion: '0.1', requestId: item.ticket, matchNames: names(16), budgetMs: 200, breadcrumb });
});

test('attempts are journaled (0600, atomically) BEFORE the page leaves and cleared only when it completes', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  const item = nextPage(h, 'panel-1');
  assert.deepEqual(attempts(h), { 'FX 00': 1, 'FX 01': 1, 'FX 02': 1 });
  assert.equal(statSync(journalPath(h)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(h.directory).filter(name => name.includes('.tmp')), [], 'no torn temporary file is left behind');
  const completion = h.collector.complete(item.ticket, jsonOf(hostPage(item)));
  assert.equal(completion.written, 3);
  assert.deepEqual(attempts(h), {});
});

function walkFirstHalf(h: CollectorHarness): void {
  const first = nextPage(h);
  const asked = first.hostRequest.matchNames;
  const half = hostPage(first, { results: asked.slice(0, 6).map(name => effectResult(name)), remaining: asked.slice(6) });
  h.collector.complete(first.ticket, jsonOf(half));
  assert.deepEqual(attempts(h), {}, 'effects the host did not reach are not charged an attempt');
  const expected = { installed: 20, collected: 6, pending: 14, failed: 0, lastPageMs: 40, totalProbeMs: 40, state: 'collecting' };
  assert.deepEqual(h.collector.progress(), { ...h.collector.progress(), ...expected });
  const counted = 'only the effects the host answered count toward the measured per-effect time';
  assert.equal(h.collector.progress().probedThisRun, 6, counted);
}

test('pages walk the whole inventory, remaining effects return to the queue, and one cleanup page follows the last', t => {
  const h = collectorHarness(t);
  h.land(names(20));
  walkFirstHalf(h);
  const second = nextPage(h);
  assert.deepEqual(second.hostRequest.matchNames, names(20).slice(6, 20));
  h.collector.complete(second.ticket, jsonOf(hostPage(second)));
  assert.equal(h.collector.progress().probedThisRun, 20);
  assert.equal(h.collector.progress().totalProbeMs, 80);
  const cleanup = nextPage(h);
  assert.deepEqual(cleanup.hostRequest, { schemaVersion: '0.1', requestId: cleanup.ticket, matchNames: [], budgetMs: 200, cleanup: true });
  h.collector.complete(cleanup.ticket, jsonOf(cleanedPage(cleanup)));
  assert.equal(h.collector.nextItem(true, 'p'), undefined);
  assert.equal(h.collector.progress().state, 'complete');
  assert.equal(h.collector.progress().pending, 0);
  assert.ok(h.events.some(event => event.event === 'catalogue.complete'));
  const timed = h.events.filter(event => event.event === 'catalogue.page');
  assert.equal(timed.every(event => typeof event.hostMs === 'number' && typeof event.roundTripMs === 'number'), true, 'per-page timings are logged');
});

test('the measured per-effect time restarts with each census, so an estimate never mixes two sessions', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  const page = nextPage(h);
  h.collector.complete(page.ticket, jsonOf(hostPage(page)));
  assert.equal(h.collector.progress().probedThisRun, 3);
  assert.ok(h.collector.progress().totalProbeMs > 0);
  h.land(names(4));
  assert.deepEqual([h.collector.progress().probedThisRun, h.collector.progress().totalProbeMs], [0, 0]);
});

test('an effect already probed on this host is not asked again after a new census or a restart', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  const item = nextPage(h);
  h.collector.complete(item.ticket, jsonOf(hostPage(item)));
  const cleanup = nextPage(h);
  h.collector.complete(cleanup.ticket, jsonOf(cleanedPage(cleanup)));
  h.restart();
  h.land(names(3));
  assert.equal(h.collector.nextItem(true, 'p'), undefined);
  assert.equal(h.collector.progress().collected, 3);
  h.land([...names(3), 'FX NEW']);
  const next = nextPage(h);
  assert.deepEqual(next.hostRequest.matchNames, ['FX NEW']);
  h.collector.complete(next.ticket, jsonOf(hostPage(next)));
  h.land(names(3), { build: '3' });
  assert.equal(nextPage(h).hostRequest.matchNames.length, 3, 'a new build means the observations no longer cover this host');
});

function restartLand(h: CollectorHarness, count: number): void {
  h.restart();
  h.land(names(count));
}

test('a page that never completes is retried one effect at a time; an effect whose single retry also never completes fails forever', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  assert.equal(nextPage(h).hostRequest.matchNames.length, 3);
  restartLand(h, 3);
  const single1 = nextPage(h);
  assert.deepEqual(single1.hostRequest.matchNames, ['FX 00']);
  assert.equal(attempts(h)['FX 00'], 2);
  restartLand(h, 3);
  const single2 = nextPage(h);
  assert.deepEqual(failed(h), ['crashes-or-hangs-on-apply']);
  assert.deepEqual(single2.hostRequest.matchNames, ['FX 01'], 'the crasher is skipped and the next effect is tried alone');
  h.collector.complete(single2.ticket, jsonOf(hostPage(single2)));
  const single3 = nextPage(h);
  assert.deepEqual(single3.hostRequest.matchNames, ['FX 02']);
  h.collector.complete(single3.ticket, jsonOf(hostPage(single3)));
  assert.equal(h.collector.progress().failed, 1);
  assert.equal(h.collector.progress().collected, 2);
  restartLand(h, 3);
  const cleanup = nextPage(h);
  assert.equal(cleanup.hostRequest.cleanup, true, 'FX 00 is never applied again on this host key');
  h.collector.abandon(cleanup.ticket, 'test');
  h.land(names(3), { version: '26.3' });
  assert.equal(nextPage(h).hostRequest.matchNames.length, 3, 'another AE version gets its own chance');
});

test('in-process loss (timeout, panel replaced, idle poll) leaves attempts in place just like a crash', t => {
  const h = collectorHarness(t, { collector: { pageTimeoutMs: 1000 } });
  h.land(names(2));
  h.collector.nextItem(true, 'panel-a');
  h.clock.now += 1001;
  const afterTimeout = nextPage(h, 'panel-a');
  assert.deepEqual(afterTimeout.hostRequest.matchNames, ['FX 00'], 'timed out: retried alone');
  const replaced = nextPage(h, 'panel-b');
  const retired = 'panel replaced: the old page is abandoned and FX 00 (two attempts) is retired';
  assert.deepEqual(replaced.hostRequest.matchNames, ['FX 01'], retired);
  assert.deepEqual(failed(h), ['crashes-or-hangs-on-apply']);
  h.collector.abandon(replaced.ticket, 'panel-idle-without-completion');
  assert.equal(h.collector.progress().outstanding, false);
  assert.ok(h.events.filter(event => event.event === 'catalogue.page-abandoned').length >= 2);
});

test('NOT_SCRATCH_PROJECT pauses until the next census or an explicit start; nothing is charged to the effects', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  const item = nextPage(h);
  const refusal = { code: 'NOT_SCRATCH_PROJECT', message: 'no', reason: 'project-saved' };
  h.collector.complete(item.ticket, { schemaVersion: '0.1', ok: false, requestId: item.ticket, error: refusal });
  assert.deepEqual(attempts(h), {});
  assert.equal(h.collector.progress().state, 'paused');
  assert.equal(h.collector.progress().pauseReason, 'not-scratch-project');
  assert.equal(h.collector.nextItem(true, 'p'), undefined);
  assert.equal(started(h).state, 'collecting');
  assert.ok(h.collector.nextItem(true, 'p'));
  assert.equal(h.collector.progress().outstanding, true);
  h.collector.abandon(h.collector.outstandingTicket() ?? '', 'test');
  h.land(names(3));
  assert.equal(h.collector.progress().state, 'collecting', 'a new census resumes');
});

test('manual start needs a census first', t => {
  const h = collectorHarness(t);
  assert.deepEqual(h.collector.start(), { ok: false, code: 'NO_CENSUS' });
});

test('progress names the failed effects and why, bounded to ten, and says nothing when none failed', t => {
  const h = collectorHarness(t);
  h.land(names(13));
  assert.equal('failedEffects' in h.collector.progress(), false, 'nothing failed, nothing listed');
  const item = nextPage(h);
  const bad = names(13).slice(0, 12).reverse().map((matchName, i) => ({ matchName, code: i % 2 ? 'READ_FAILED' : 'CANNOT_ADD' }));
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX 12')], failures: bad })));
  const progress = h.collector.progress();
  const effects = listed(progress.failedEffects);
  assert.equal(progress.failed, 12);
  assert.equal(effects.length, 10, 'the list is bounded, the count is not');
  assert.deepEqual(effects.map(entry => entry.matchName), names(10), 'by match name, so the list is stable');
  const first = entryAt(effects, 0);
  assert.deepEqual(first, { matchName: 'FX 00', name: 'Display FX 00', reason: first.reason, detail: null, at: new Date(h.clock.now).toISOString() });
  assert.ok(['read-failed', 'cannot-add'].includes(first.reason));
});

function hostBusyThenTimeout(t: TestContext): void {
  const busy = collectorHarness(t);
  busy.land(names(2));
  const one = nextPage(busy);
  busy.collector.complete(one.ticket, { ok: false, mayHaveMutated: false, mutationState: 'not-applied', error: { code: 'HOST_BUSY' } });
  assert.deepEqual(attempts(busy), {}, 'the host never started: no attempt is charged');
  assert.equal(busy.collector.progress().state, 'collecting');
  const two = nextPage(busy);
  busy.collector.complete(two.ticket, { ok: false, mayHaveMutated: true, mutationState: 'unknown', error: { code: 'HOST_TIMEOUT' } });
  assert.deepEqual(attempts(busy), { 'FX 00': 1, 'FX 01': 1 }, 'a timeout may mean the effect hung AE: the attempt stays');
}

test('host-reported per-effect failures are recorded forever; scheduler refusals and timeouts are not the effect\'s fault', t => {
  const h = collectorHarness(t);
  h.land(names(4));
  const item = nextPage(h);
  const failures: HostFailure[] = [{ matchName: 'FX 00', code: 'CANNOT_ADD' }, { matchName: 'FX 01', code: 'READ_FAILED' }];
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX 02'), effectResult('FX 03')], failures })));
  assert.deepEqual(failed(h).sort(), ['cannot-add', 'read-failed']);
  assert.equal(h.collector.progress().failed, 2);
  h.land(names(4));
  assert.equal(nextPage(h).hostRequest.cleanup, true);
  hostBusyThenTimeout(t);
});

test('a page that names effects it was not asked about, or answers another ticket, is rejected and nothing is stored', t => {
  const h = collectorHarness(t);
  h.land(names(2));
  const item = nextPage(h);
  assert.throws(() => h.collector.complete('cat-other', jsonOf(hostPage(item))), /STALE_CATALOGUE_TICKET/);
  const completion = h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX 00'), effectResult('FX SNEAKY')] })));
  assert.equal(completion.accepted, false);
  assert.equal(h.collector.progress().collected, 0);
  assert.deepEqual(attempts(h), {}, 'rejected, but AE answered: no crash is charged');
  assert.throws(() => h.collector.complete(item.ticket, jsonOf(hostPage(item))), /STALE_CATALOGUE_TICKET/, 'a ticket completes once');
});

test('a refused cleanup page never loops; an unreadable journal is set aside, not trusted', t => {
  const h = collectorHarness(t);
  h.land(names(1));
  const item = nextPage(h);
  h.collector.complete(item.ticket, jsonOf(hostPage(item)));
  const cleanup = nextPage(h);
  h.collector.complete(cleanup.ticket, { ok: false, mayHaveMutated: false, requestId: cleanup.ticket, error: { code: 'NOT_SCRATCH_PROJECT' } });
  assert.equal(h.collector.nextItem(true, 'p'), undefined);
  assert.equal(fieldOf(journal(h), 'cleanup'), false);
  writeFileSync(journalPath(h), '{ torn');
  restartLand(h, 1);
  assert.ok(existsSync(`${journalPath(h)}.unreadable`));
  assert.equal(h.collector.progress().state, 'complete', 'the graph, not the journal, remembers what was probed');
});

test('an answered but unreadable page never marks its effects as crashing; repeated ones pause collection', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  for (let round = 0; round < 6 && h.collector.progress().state !== 'paused'; round += 1) {
    const item = h.collector.nextItem(true, 'p');
    if (!item) break;
    h.collector.complete(item.ticket, { ok: false, error: { code: 'INVALID_PAGE', reason: 'EvalScript error.' } });
    assert.deepEqual(attempts(h), {}, 'AE answered, so it survived the page');
  }
  assert.deepEqual(failed(h), [], 'no effect is blamed for an unreadable answer');
  assert.equal(h.collector.progress().pauseReason, 'repeated-page-failures');
  assert.ok(h.events.some(event => event.event === 'catalogue.page-refused' && event.reason === 'EvalScript error.'));
});

test('an explicit start gives effects marked as crashing one more single-effect attempt', t => {
  const h = collectorHarness(t);
  h.land(names(2));
  h.collector.nextItem(true, 'p');
  restartLand(h, 2);
  h.collector.nextItem(true, 'p');
  restartLand(h, 2);
  h.collector.nextItem(true, 'p');
  assert.deepEqual(failed(h), ['crashes-or-hangs-on-apply']);
  h.collector.abandon(h.collector.outstandingTicket() ?? '', 'test');
  h.collector.start();
  assert.deepEqual(failed(h), [], 'the user asked again');
  assert.equal(h.collector.progress().failed, 0);
});

const NEEDS_SOURCE_NOTE = 'needs a layer of its own kind (e.g. a C4D file layer); learned when it appears in one of your projects';

test('an add the host could attempt but that gave nothing back needs a layer source: counted apart from failures, with After Effects\' words kept', t => {
  const h = collectorHarness(t);
  h.land(names(4));
  const item = nextPage(h);
  const detail = 'Error: This effect requires a C4D file layer.';
  const failures: HostFailure[] = [
    { matchName: 'FX 00', code: 'ADD_FAILED', detail },
    { matchName: 'FX 01', code: 'CANNOT_ADD' },
    { matchName: 'FX 02', code: 'READ_FAILED' },
  ];
  h.collector.complete(item.ticket, jsonOf(hostPage(item, { results: [effectResult('FX 03')], failures })));
  const progress = h.collector.progress();
  assert.deepEqual([progress.installed, progress.collected, progress.pending, progress.failed, progress.needsSource], [4, 1, 0, 2, 1], 'cannot-add and read-failed stay failures');
  const at = new Date(h.clock.now).toISOString();
  assert.deepEqual(progress.needsSourceEffects, [{ matchName: 'FX 00', name: 'Display FX 00', reason: 'needs-layer-source', detail, at }]);
  assert.equal(progress.needsSourceNote, NEEDS_SOURCE_NOTE);
  const rows = listed(progress.failedEffects).map(entry => [entry.matchName, entry.reason, entry.detail]);
  assert.deepEqual(rows, [['FX 01', 'cannot-add', null], ['FX 02', 'read-failed', null]], 'the failed list no longer holds the needs-source effect');
  assert.deepEqual(hostFailures(h)['FX 00\0v1'], { code: 'needs-layer-source', at: h.clock.now, detail }, 'the words survive in the journal');
  restartLand(h, 4);
  assert.equal(h.collector.progress().needsSource, 1, 'and across a sidecar restart');
  assert.equal(entryAt(h.collector.progress().needsSourceEffects, 0).detail, detail);
});

test('the Cinema 4D effect is never added to the test layer: it needs its own footage, and adding it raises a Windows Firewall prompt naming After Effects', t => {
  const h = collectorHarness(t);
  h.land([...names(2), 'CINEMA 4D Effect']);
  const item = nextPage(h);
  assert.deepEqual(item.hostRequest.matchNames, ['FX 00', 'FX 01']);
  const progress = h.collector.progress();
  assert.deepEqual([progress.installed, progress.pending, progress.failed, progress.needsSource], [3, 2, 0, 1]);
  const cinema = entryAt(progress.needsSourceEffects, 0);
  assert.equal(cinema.matchName, 'CINEMA 4D Effect');
  assert.match(cinema.detail ?? '', /\.c4d footage/);
  h.restart();
  h.land([...names(2), 'CINEMA 4D Effect']);
  assert.equal(h.collector.progress().needsSource, 1, 'settled once, not re-recorded');
});

test('with nothing failing, progress carries no needs-source list or note; the count is zero', t => {
  const h = collectorHarness(t);
  h.land(names(2));
  const item = nextPage(h);
  h.collector.complete(item.ticket, jsonOf(hostPage(item)));
  const progress = h.collector.progress();
  assert.equal(progress.needsSource, 0);
  assert.equal('needsSourceEffects' in progress, false);
  assert.equal('needsSourceNote' in progress, false);
});

test('a bounded detail: longer or non-text words from the host are cut or dropped, never stored whole', t => {
  const h = collectorHarness(t);
  h.land(names(3));
  const item = nextPage(h);
  const failures: DetailedFailure[] = [
    { matchName: 'FX 00', code: 'ADD_FAILED', detail: `a\n\n  b ${'y'.repeat(900)}` },
    { matchName: 'FX 01', code: 'ADD_FAILED', detail: { not: 'text' } },
    { matchName: 'FX 02', code: 'ADD_FAILED', detail: '   ' },
  ];
  h.collector.complete(item.ticket, jsonOf({ ...hostPage(item, { results: [] }), failures }));
  const detailOf = (name: string): string | null | undefined =>
    h.collector.progress().needsSourceEffects?.find(entry => entry.matchName === name)?.detail;
  const long = detailOf('FX 00');
  assert.equal(long?.length, 300);
  assert.match(long ?? '', /^a b y+$/);
  assert.deepEqual([detailOf('FX 01'), detailOf('FX 02')], [null, null]);
});

test('crashes and hangs stay failures, never needs-source', t => {
  const h = collectorHarness(t);
  h.land(names(1));
  h.collector.nextItem(true, 'p');
  restartLand(h, 1);
  h.collector.nextItem(true, 'p');
  restartLand(h, 1);
  h.collector.nextItem(true, 'p');
  assert.deepEqual(failed(h), ['crashes-or-hangs-on-apply']);
  const progress = h.collector.progress();
  assert.deepEqual([progress.failed, progress.needsSource], [1, 0]);
  assert.equal(entryAt(progress.failedEffects, 0).reason, 'crashes-or-hangs-on-apply');
});
