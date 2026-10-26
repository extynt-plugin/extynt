/** Fakes for the headless render engine tests: an engine process and plugin client that answer like After Effects, over a real collector. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { census, effectResult } from './catalogue-support.ts';
import type { CollectorHarness, HostPage } from './catalogue-support.ts';
import { CatalogueEngine } from '../apps/sidecar/dist/src/catalogue-engine.js';
import type { CatalogueEngineDeps } from '../apps/sidecar/dist/src/catalogue-engine.js';
import type { EngineHost, EngineProcess } from '../apps/sidecar/dist/src/catalogue-engine-process.js';
import { decode } from '../packages/decode/dist/src/index.js';
import { hostCensus } from '../apps/sidecar/dist/src/server-census-wire.js';
import type { HostCensus } from '../apps/sidecar/dist/src/server-types.js';
import type { CallOutcome, HostCallResult, HostEntry, JsonPluginClient, PluginEndpoint, WireTiming } from '../packages/host-native/dist/src/index.js';
import { fieldOf, textOf, textsOf } from '../apps/sidecar/dist/tests/http-json.js';

export const installed = ['ADBE Gaussian Blur 2', 'ADBE Glo2', 'Example Vendor Alpha Glow', 'Example Vendor Beta Mirror', 'Example Vendor Gamma Particles'];
export const PAGE_HOST_VERSION = '26.2';

export type Outcome = CallOutcome<HostCallResult>;
export type HostCallArgs = Parameters<JsonPluginClient['hostCall']>[1];
export type EngineLaunch = NonNullable<CatalogueEngineDeps['launch']>;
export type EngineConnect = NonNullable<CatalogueEngineDeps['connect']>;
export type EngineEndpoint = NonNullable<CatalogueEngineDeps['endpoint']>;
export type EngineRunStatus = ReturnType<CatalogueEngine['status']>;
export type EngineHostReport = EngineRunStatus['hosts'][number];

export interface CleanupPage extends HostPage {
  cleanedUp: true;
}

export type EngineReply = HostCensus | HostPage | CleanupPage;

export interface FakeEngine {
  readonly pid: number;
  readonly year: string;
  readonly running: EngineProcess;
  up: boolean;
  stopped: boolean;
}

export interface EngineFakes {
  readonly launched: FakeEngine[];
  readonly launch: EngineLaunch;
  readonly endpoint: EngineEndpoint;
  readonly connect: EngineConnect;
}

export interface FakeEngineOptions {
  readonly crashOn?: string;
  readonly neverStarts?: boolean;
  readonly emptyCensus?: boolean;
  readonly modalCensus?: boolean;
  readonly hangOn?: string;
  readonly crashTimes?: number;
  readonly silentCrashOn?: string;
}

export type LostOutcome = Extract<Outcome, { kind: 'lost' }>;

export const lost: LostOutcome = { kind: 'lost', reason: 'closed', sent: false, waitedMs: 0 };

const TIMING: WireTiming = { queuedMs: 0, walkMs: 0, hashMs: 0, serializeMs: 0, totalMainThreadMs: 0, bytes: 0, getterCalls: 0, dispatchedBy: 'socket' };

export function okCall(entry: HostEntry, reply: EngineReply): Outcome {
  const hostResult: HostCallResult = {
    result: JSON.stringify(reply), source: 'native', entry, scriptUs: 1000, libraryLoaded: true, libraryLoadUs: 0, libraryVersion: '0.1.0', projectEpoch: 0,
  };
  return { kind: 'ok', result: hostResult, timing: TIMING, rttMs: 1 };
}

export function probePage(requestId: string, version: string, matchNames: readonly string[]): HostPage {
  return {
    schemaVersion: '0.1', ok: true, requestId, host: { version, build: '2' },
    results: matchNames.map(name => effectResult(name)), failures: [], remaining: [], elapsedMs: 5,
  };
}

export function cleanupPage(requestId: string, version: string): CleanupPage {
  return { ...probePage(requestId, version, []), elapsedMs: 0, cleanedUp: true };
}

export function firstHost(status: EngineRunStatus): EngineHostReport {
  const host = status.hosts[0];
  if (!host) throw new Error('the engine run reported no host');
  return host;
}

export function fakeEngine(pid: number, year: string): FakeEngine {
  const engine: FakeEngine = {
    pid, year, up: true, stopped: false,
    running: { pid, alive: () => engine.up, stop: () => { engine.stopped = true; engine.up = false; } },
  };
  return engine;
}

export function engineAt(launched: readonly FakeEngine[], pid: number | null): FakeEngine {
  const engine = launched.find(candidate => candidate.pid === pid);
  if (!engine) throw new Error(`no engine was launched with pid ${pid}`);
  return engine;
}

export function fakeClient(endpoint: PluginEndpoint, hostCall: JsonPluginClient['hostCall'], close: () => void): JsonPluginClient {
  return {
    endpoint, close, hostCall,
    request: async () => lost,
    batch: async () => lost,
    pingDirect: async () => lost,
    requestJson: async () => lost,
    hostCallJson: async () => lost,
  };
}

export function launcherOf(launched: FakeEngine[], firstPid: number): EngineLaunch {
  return (host: EngineHost) => {
    const engine = fakeEngine(firstPid + launched.length, host.year);
    launched.push(engine);
    return engine.running;
  };
}

export function hasEvent(h: CollectorHarness, event: string, fields: Readonly<Record<string, string>> = {}): boolean {
  return h.events.some(logged => logged.event === event && Object.entries(fields).every(([name, expected]) => logged[name] === expected));
}

interface ProbeCall {
  readonly requestId: string;
  readonly matchNames: readonly string[];
  readonly cleanup: boolean;
  readonly engineFlag: boolean;
}

function probeCall(args: HostCallArgs): ProbeCall {
  const asked = fieldOf(args, 'matchNames') === undefined ? [] : textsOf(args, 'matchNames');
  return { requestId: textOf(args, 'requestId'), matchNames: asked, cleanup: fieldOf(args, 'cleanup') === true, engineFlag: fieldOf(args, 'engine') === true };
}

class EngineMischief {
  private readonly directory: string;
  private readonly options: FakeEngineOptions;
  private hung = false;
  private crashes = 0;
  private silentlyCrashed = false;

  constructor(directory: string, options: FakeEngineOptions) {
    this.directory = directory;
    this.options = options;
  }

  private leaveCrumb(call: ProbeCall, matchName: string): void {
    writeFileSync(join(this.directory, 'catalogue-probe-current.json'), JSON.stringify({ ticket: call.requestId, phase: 'apply', matchName }));
  }

  hang(call: ProbeCall): Outcome | undefined {
    const { hangOn } = this.options;
    if (hangOn === undefined || this.hung || !call.matchNames.includes(hangOn)) return undefined;
    this.hung = true;
    this.leaveCrumb(call, hangOn);
    return { kind: 'lost', reason: 'timeout', sent: true, waitedMs: 25000 };
  }

  crash(call: ProbeCall, engine: FakeEngine, onClose: () => void): Outcome | undefined {
    const { crashOn, crashTimes = 1 } = this.options;
    if (crashOn === undefined || this.crashes >= crashTimes || !call.matchNames.includes(crashOn)) return undefined;
    this.crashes += 1;
    this.leaveCrumb(call, crashOn);
    engine.up = false;
    onClose();
    return lost;
  }

  silentCrash(call: ProbeCall, engine: FakeEngine, closing: Promise<void>): Promise<Outcome> | undefined {
    const { silentCrashOn } = this.options;
    if (silentCrashOn === undefined || this.silentlyCrashed || !call.matchNames.includes(silentCrashOn)) return undefined;
    this.silentlyCrashed = true;
    this.leaveCrumb(call, silentCrashOn);
    engine.up = false;
    return closing.then(() => lost);
  }
}

interface EngineSession {
  readonly engine: FakeEngine;
  readonly closing: Promise<void>;
  readonly onClose: () => void;
  readonly mischief: EngineMischief;
  readonly options: FakeEngineOptions;
}

function failedCensus(): HostCensus {
  const empty = census([]);
  return { ...empty, result: { ...empty.result, completeness: 'failed' } };
}

function censusAnswer(entry: HostEntry, options: FakeEngineOptions): Outcome {
  if (options.modalCensus) return { kind: 'refused', error: { code: 'HOST_MODAL_DIALOG', message: 'A dialog is open.' }, rttMs: 1 };
  return okCall(entry, options.emptyCensus ? failedCensus() : census(installed));
}

async function answerHostCall(session: EngineSession, entry: HostEntry, args: HostCallArgs): Promise<Outcome> {
  const { engine, mischief, options } = session;
  if (!engine.up) return lost;
  if (entry === 'aeHostCensus') return censusAnswer(entry, options);
  const call = probeCall(args);
  if (call.cleanup) return okCall(entry, cleanupPage(call.requestId, PAGE_HOST_VERSION));
  assert.equal(call.engineFlag, true, 'every probe page carries the engine flag');
  return mischief.silentCrash(call, engine, session.closing)
    ?? mischief.hang(call)
    ?? mischief.crash(call, engine, session.onClose)
    ?? okCall(entry, probePage(call.requestId, PAGE_HOST_VERSION, call.matchNames));
}

function endpointAnswering(neverStarts: boolean): EngineEndpoint {
  return (_path, pid) => (neverStarts ? undefined : { path: 'x', port: 1, token: 't', pid: pid ?? null, pluginVersion: '0.1.0', aeVersion: '26.2' });
}

function closingSignal(): { closing: Promise<void>; close: () => void } {
  let close = (): void => undefined;
  const closing = new Promise<void>(resolve => { close = resolve; });
  return { closing, close };
}

export function fakeEngines(h: CollectorHarness, options: FakeEngineOptions = {}): EngineFakes {
  const launched: FakeEngine[] = [];
  const mischief = new EngineMischief(h.directory, options);
  const connect: EngineConnect = async ({ endpoint: found, onClose }) => {
    const { closing, close } = closingSignal();
    const session: EngineSession = { engine: engineAt(launched, found.pid), closing, mischief, options, onClose: () => onClose('reset') };
    return fakeClient(found, (entry, args) => answerHostCall(session, entry, args), close);
  };
  return { launched, launch: launcherOf(launched, 1000), endpoint: endpointAnswering(options.neverStarts === true), connect };
}

export function engineFor(h: CollectorHarness, fakes: EngineFakes, extra: Partial<CatalogueEngineDeps> = {}): CatalogueEngine {
  return new CatalogueEngine({
    catalogue: h.collector, log: (event, fields) => h.events.push({ event, ...fields }), now: () => Date.now(),
    acceptCensus: async reading => {
      const decoded = decode(hostCensus, reading);
      if (!decoded.ok) return { outcome: 'refused' };
      h.graph.observeCensus(decoded.value, h.clock.now);
      h.collector.onCensus(decoded.value);
      return { outcome: 'succeeded' };
    },
    discoveryPath: join(h.directory, 'native-engine.json'), logPath: join(h.directory, 'engine.log'),
    hosts: () => [{ year: '2026', appPath: '/fake/Adobe After Effects 2026.app' }], userOpen: () => false,
    launch: fakes.launch, connect: fakes.connect, endpoint: fakes.endpoint,
    limits: { pollMs: 5, startMs: 200, idleMs: 200 }, ...extra,
  });
}
