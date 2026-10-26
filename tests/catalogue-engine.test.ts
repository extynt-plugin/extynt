/**
 * The headless render engine supervisor over a real collector and catalogue store: only the engine process and the plugin client are fakes.
 * A crash costs an engine, never the run; the user's After Effects is never asked to probe.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectorHarness } from './catalogue-support.ts';
import { engineFor, fakeEngines, firstHost, hasEvent, installed } from './catalogue-engine-support.ts';
import type { EngineRunStatus } from './catalogue-engine-support.ts';
import { catalogueProgressWithEngine } from '../apps/sidecar/dist/src/catalogue-engine.js';
import { CRASH_IDENTIFIED } from '../apps/sidecar/dist/src/catalogue-collector.js';

const BETA_MIRROR = 'Example Vendor Beta Mirror';

function enginesAndCrashes(status: EngineRunStatus): { engines: number; crashes: number } {
  const { engines, crashes } = firstHost(status);
  return { engines, crashes };
}

test('one engine collects every effect, Adobe first then plugins, and is stopped when the catalogue is complete', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h);
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'done');
  assert.deepEqual(status.hosts.map(({ year, state, engines, crashes }) => ({ year, state, engines, crashes })), [{ year: '2026', state: 'done', engines: 1, crashes: 0 }]);
  assert.equal(status.catalogue.collected, installed.length);
  const host = firstHost(status);
  assert.equal(host.phase, 'finished');
  const outcome = { installed: installed.length, collected: installed.length, failed: 0, needsSource: 0, deferred: 0, crashed: [] };
  assert.deepEqual(host.result, outcome, 'the version keeps its own outcome');
  assert.ok(host.finishedAt !== null && host.startedAt !== null && host.finishedAt >= host.startedAt);
  assert.equal(fakes.launched.length, 1);
  assert.equal(fakes.launched[0]?.stopped, true);
});

test('an engine that crashes inside a plugin is replaced; the plugin is retried alone first in the fresh engine and learned', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { crashOn: BETA_MIRROR });
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'done');
  assert.deepEqual(enginesAndCrashes(status), { engines: 2, crashes: 1 });
  assert.equal(status.catalogue.collected, installed.length, 'a crash once, late in a run, does not cost the effect');
  assert.equal(status.catalogue.failed, 0);
  assert.ok(hasEvent(h, 'catalogue.crash-retry', { matchName: BETA_MIRROR }));
  assert.ok(fakes.launched.every(engine => engine.stopped), 'no engine outlives the run');
});

test('a plugin that crashes the fresh engine again on its own is retired, named for the user, and the rest is collected', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { crashOn: BETA_MIRROR, crashTimes: 2 });
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'done');
  assert.deepEqual(enginesAndCrashes(status), { engines: 3, crashes: 2 });
  assert.equal(status.catalogue.collected, installed.length - 1);
  assert.equal(status.catalogue.failed, 1);
  assert.equal(firstHost(status).result?.crashed.length, 1, 'the effect that took the engine down is named for the user');
  assert.ok(hasEvent(h, 'catalogue.effect-failed', { matchName: BETA_MIRROR, code: CRASH_IDENTIFIED }));
});

test('an engine that never publishes its endpoint is given up on after two tries; the run reports failure', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { neverStarts: true });
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'failed');
  assert.equal(firstHost(status).reason, 'start-failed');
  assert.equal(fakes.launched.length, 2);
  assert.equal(firstHost(status).result, null, 'a version whose engine never answered has no outcome to show');
});

test('an engine that answers with an empty, failed census (already quitting) is a failed start, never a complete catalogue', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { emptyCensus: true });
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'failed');
  assert.equal(firstHost(status).reason, 'census-failed');
  assert.equal(firstHost(status).result, null);
});

test('an engine whose census meets a dialog (the GPU report) ends as modal-blocked, not as a plain failed start', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { modalCensus: true });
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'failed');
  assert.equal(firstHost(status).reason, 'modal-blocked');
});

test('a census with effects the catalogue lacks starts the engine once for that version, never for an unknown one', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h);
  h.land(installed);
  const engine = engineFor(h, fakes);
  engine.onCensus('25.6');
  assert.equal(fakes.launched.length, 0, 'no engine is installed for After Effects 2025 here');
  engine.onCensus('26.2x2');
  assert.ok(['starting', 'reading-effects', 'learning'].includes(firstHost(engine.status()).phase), 'the phase says what the engine is doing');
  for (let i = 0; i < 200 && engine.status().state === 'running'; i += 1) await new Promise<void>(resolve => { setTimeout(resolve, 10); });
  assert.equal(engine.status().state, 'done');
  engine.onCensus('26.2x2');
  assert.equal(fakes.launched.length, 1, 'a version is collected at most once per run of the sidecar');
});

test('a page that stops answering (a dialog the guard could not cancel, a frozen crash) stops that instance; the effect is retried alone and learned', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { hangOn: BETA_MIRROR });
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'done');
  assert.deepEqual(enginesAndCrashes(status), { engines: 2, crashes: 1 });
  assert.equal(fakes.launched[0]?.stopped, true, 'the hung instance is stopped');
  assert.ok(hasEvent(h, 'catalogue.crash-retry', { matchName: BETA_MIRROR }));
  assert.equal(status.catalogue.collected, installed.length);
});

test('an engine that dies while its children hold its socket open is replaced at once, not after the page times out', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h, { silentCrashOn: BETA_MIRROR });
  const started = Date.now();
  const status = await engineFor(h, fakes).collect();
  assert.equal(status.state, 'done');
  assert.deepEqual(enginesAndCrashes(status), { engines: 2, crashes: 1 });
  assert.equal(status.catalogue.collected, installed.length);
  assert.ok(Date.now() - started < 5000, 'the dead engine is noticed by its process, not by the page timeout');
});

test('an After Effects the user has open is not started a second time; that version is collected another time', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h);
  const status = await engineFor(h, fakes, { userOpen: () => true }).collect();
  assert.equal(firstHost(status).reason, 'after-effects-open');
  assert.equal(fakes.launched.length, 0);
});

test('an engine run with no After Effects installed fails; it is never "done" while effects are pending', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = fakeEngines(h);
  h.land(installed);
  const engine = engineFor(h, fakes, { hosts: () => [] });
  const status = await engine.collect();
  assert.equal(status.state, 'failed');
  assert.deepEqual(status.hosts, []);
  assert.ok(status.catalogue.pending > 0);
  assert.equal(fakes.launched.length, 0);
  assert.equal(catalogueProgressWithEngine(status.catalogue, engine).engineHosts, 0);
  assert.equal(catalogueProgressWithEngine(status.catalogue, undefined).engineHosts, undefined);
});
