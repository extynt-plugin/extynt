/** The engine supervisor with two After Effects versions installed: each is learned in its own engine and stored under its own version. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { census, collectorHarness } from './catalogue-support.ts';
import type { CollectorHarness } from './catalogue-support.ts';
import { cleanupPage, engineAt, engineFor, fakeClient, firstHost, hasEvent, launcherOf, okCall, probePage } from './catalogue-engine-support.ts';
import type { EngineConnect, EngineEndpoint, EngineFakes, FakeEngine, HostCallArgs, Outcome } from './catalogue-engine-support.ts';
import type { EngineHost } from '../apps/sidecar/dist/src/catalogue-engine-process.js';
import type { HostEntry } from '../packages/host-native/dist/src/index.js';
import { fieldOf, textOf, textsOf } from '../apps/sidecar/dist/tests/http-json.js';

interface EngineVersion {
  readonly version: string;
  readonly effects: readonly string[];
}

type Year = '2026' | '2025';
type VersionTable = Readonly<Record<Year, EngineVersion>>;

interface UserCensusDuring {
  readonly during: Year;
  readonly opens: Year;
}

interface VersionRun {
  readonly h: CollectorHarness;
  readonly versions: VersionTable;
  readonly pages: Map<string, number>;
  readonly userCensusDuring: UserCensusDuring | undefined;
}

const TWO_VERSIONS: VersionTable = {
  2026: { version: '26.2', effects: ['ADBE Gaussian Blur 2', 'Example Vendor Only In 26'] },
  2025: { version: '25.6', effects: ['ADBE Gaussian Blur 2', 'Example Vendor Only In 25'] },
};
const bothHosts = (): EngineHost[] => [{ year: '2026', appPath: '/fake/26' }, { year: '2025', appPath: '/fake/25' }];
const hostKeyOf = (version: string): string => `After Effects:${version}:macOS`;
const sortedEffects = (year: Year): string[] => [...TWO_VERSIONS[year].effects].sort();
const yearsAndStates = (hosts: ReadonlyArray<{ year: string; state: string }>): string[][] => hosts.map(({ year, state }) => [year, state]);

function versionOf(versions: VersionTable, year: string): EngineVersion {
  const found = year === '2026' || year === '2025' ? versions[year] : undefined;
  if (!found) throw new Error(`no fake version for ${year}`);
  return found;
}

function learnedNames(h: CollectorHarness, version: string): string[] {
  const every = TWO_VERSIONS['2026'].effects.concat(TWO_VERSIONS['2025'].effects);
  const keys = [...(h.graph.catalogueProbedKeys(hostKeyOf(version)) ?? [])];
  return keys.map(key => every.find(name => key.includes(name)) ?? '').sort();
}

function userOpens(run: VersionRun, year: string, pageNumber: number): void {
  const { userCensusDuring: plan } = run;
  if (!plan || year !== plan.during || pageNumber !== 1) return;
  const opened = versionOf(run.versions, plan.opens);
  run.h.land(opened.effects, { version: opened.version });
}

async function answerPage(run: VersionRun, engine: FakeEngine, entry: HostEntry, args: HostCallArgs): Promise<Outcome> {
  const own = versionOf(run.versions, engine.year);
  if (entry === 'aeHostCensus') return okCall(entry, census(own.effects, { version: own.version }));
  const requestId = textOf(args, 'requestId');
  if (fieldOf(args, 'cleanup')) return okCall(entry, cleanupPage(requestId, own.version));
  const pageNumber = (run.pages.get(engine.year) ?? 0) + 1;
  run.pages.set(engine.year, pageNumber);
  userOpens(run, engine.year, pageNumber);
  return okCall(entry, probePage(requestId, own.version, textsOf(args, 'matchNames')));
}

function endpointOfVersions(launched: readonly FakeEngine[], versions: VersionTable): EngineEndpoint {
  return (_path, pid) => ({
    path: 'x', port: 1, token: 't', pid: pid ?? null, pluginVersion: '0.1.0',
    aeVersion: versionOf(versions, engineAt(launched, pid ?? null).year).version,
  });
}

function twoVersionEngines(h: CollectorHarness, versions: VersionTable, userCensusDuring?: UserCensusDuring): EngineFakes {
  const launched: FakeEngine[] = [];
  const run: VersionRun = { h, versions, pages: new Map(), userCensusDuring };
  const connect: EngineConnect = async ({ endpoint: found }) => {
    const engine = engineAt(launched, found.pid);
    return fakeClient(found, (entry, args) => answerPage(run, engine, entry, args), () => undefined);
  };
  return { launched, launch: launcherOf(launched, 2000), endpoint: endpointOfVersions(launched, versions), connect };
}

test('with 2025 and 2026 installed, each version is learned in its own engine and stored under its own version, never mixed', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = twoVersionEngines(h, TWO_VERSIONS);
  const status = await engineFor(h, fakes, { hosts: bothHosts }).collect();
  assert.equal(status.state, 'done');
  assert.deepEqual(yearsAndStates(status.hosts), [['2026', 'done'], ['2025', 'done']]);
  assert.deepEqual(fakes.launched.map(engine => engine.year), ['2026', '2025'], 'one engine per version, each the right After Effects');
  assert.deepEqual(learnedNames(h, '26.2'), sortedEffects('2026'));
  assert.deepEqual(learnedNames(h, '25.6'), sortedEffects('2025'));
});

test('a census from the user\'s other version mid-run never stores one version\'s effects under the other; the engine recovers and finishes', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = twoVersionEngines(h, TWO_VERSIONS, { during: '2025', opens: '2026' });
  const status = await engineFor(h, fakes, { hosts: bothHosts }).collect();
  assert.deepEqual(learnedNames(h, '26.2'), sortedEffects('2026'), '2026 holds only its own effects');
  assert.ok(hasEvent(h, 'catalogue.paused', { reason: 'host-changed' }), 'the user census landed while the 2025 engine ran, and its page was refused');
  assert.deepEqual(learnedNames(h, '25.6'), sortedEffects('2025'), '2025 is still learned completely');
  assert.deepEqual(yearsAndStates(status.hosts), [['2026', 'done'], ['2025', 'done']]);
});

test('when an engine run ends, the collector is back on the user\'s own After Effects, not the version the engine learned', async t => {
  const h = collectorHarness(t, { plugins: true }), fakes = twoVersionEngines(h, TWO_VERSIONS);
  const user = census(TWO_VERSIONS['2026'].effects, { version: '26.2' });
  h.land(TWO_VERSIONS['2026'].effects, { version: '26.2' });
  let finished = 0;
  const engine = engineFor(h, fakes, { hosts: () => [{ year: '2025', appPath: '/fake/25' }], finished: () => { finished += 1; h.collector.onCensus(user); } });
  const status = await engine.collect(['2025']);
  assert.equal(firstHost(status).state, 'done');
  assert.equal(finished, 1);
  assert.equal(h.collector.progress().hostKey, hostKeyOf('26.2'), 'the panel in After Effects 2026 sees its own catalogue progress');
  assert.deepEqual(learnedNames(h, '25.6'), sortedEffects('2025'));
});
