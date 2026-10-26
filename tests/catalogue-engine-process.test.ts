/**
 * The engine process seam: finding installed After Effects versions, recognising and reaping engines by command line,
 * and launching one on macOS and Windows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChildProcess } from 'node:child_process';
import type { SpawnOptions, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineHost } from '../apps/sidecar/dist/src/catalogue-engine-process.js';
import {
  engineApplications, engineDiscoveryPid, engineLeftovers, installedEngineHosts, launchEngine, reapLeftoverEngines, userAfterEffectsOpen, wmicListing,
} from '../apps/sidecar/dist/src/catalogue-engine-process.js';
import type { DiscoveryResult, PluginEndpoint } from '../packages/host-native/dist/src/index.js';

const MAC_APP = '/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app';
const macHost: EngineHost = { year: '2026', appPath: MAC_APP };
const winAdobe = 'C:\\Program Files\\Adobe', winRoot = `${winAdobe}\\Adobe After Effects 2026`;
const winExe = `${winRoot}\\Support Files\\AfterFX.exe`;
const winHost: EngineHost = { year: '2026', appPath: winRoot, executable: winExe };
const winListing = [
  `1010 "${winExe}" -m -noui -extynt_engine`,
  `1011 "${winExe}"`,
  '1012 "C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe" -m -noui -extynt_engine',
  '1013 "C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe" -extynt_engine',
  `1014 cmd.exe /c echo "${winExe}" -extynt_engine`,
  `1015 ${winExe.toUpperCase()} -noui -extynt_engine`,
].join('\r\n');

const withoutLine = (listing: string, separator: string, pidText: string): string =>
  listing.split(separator).filter(line => !line.includes(pidText)).join(separator);

const endpointOf = (pid: number | null): PluginEndpoint => ({ path: 'x', port: 1, token: 't', pid, pluginVersion: null, aeVersion: null });

test('engines a killed sidecar left behind are stopped at the next start: only After Effects started with the engine flag', () => {
  const listing = [
    `  101 ${MAC_APP}/Contents/MacOS/After Effects -noui -extynt_engine`,
    `  102 ${MAC_APP}/Contents/MacOS/After Effects`,
    '  103 /Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app/Contents/MacOS/Adobe Photoshop 2026 -extynt_engine',
    `  104 /bin/zsh -c echo ${MAC_APP}/Contents/MacOS/After Effects -extynt_engine`,
  ].join('\n');
  const killed: number[] = [];
  const count = reapLeftoverEngines([macHost], () => listing, pid => { killed.push(pid); });
  assert.equal(count, 1);
  assert.deepEqual(killed, [101], 'never the user\'s After Effects, never another Adobe app');
  assert.equal(reapLeftoverEngines([macHost], () => { throw new Error('no ps'); }), 0);
  assert.equal(userAfterEffectsOpen(macHost, () => listing), true);
  assert.equal(userAfterEffectsOpen(macHost, () => withoutLine(listing, '\n', ' 102 ')), false);
});

test('a test sidecar points the engine search at a folder of its own, so it never starts the real After Effects', () => {
  assert.equal(engineApplications({}), '/Applications');
  assert.equal(engineApplications({ EXTYNT_ENGINE_APPLICATIONS: '/tmp/home' }), '/tmp/home');
});

test('Windows discovery: each Adobe After Effects 2025 or later with an AfterFX.exe, newest first; nothing else', () => {
  const adobe = mkdtempSync(join(tmpdir(), 'extynt-adobe-'));
  try {
    const folders = ['Adobe After Effects 2025', 'Adobe After Effects 2026', 'Adobe After Effects 2024', 'Adobe After Effects 2027', 'Adobe After Effects (Beta)', 'Adobe Photoshop 2026'];
    for (const folder of folders) {
      mkdirSync(join(adobe, folder, 'Support Files'), { recursive: true });
      if (folder !== 'Adobe After Effects 2027') writeFileSync(join(adobe, folder, 'Support Files', 'AfterFX.exe'), '');
    }
    const hosts = installedEngineHosts(adobe, 'win32');
    assert.deepEqual(hosts.map(host => host.year), ['2026', '2025'], '2024 is below the supported release, 2027 has no AfterFX.exe, a beta folder has no year');
    assert.equal(hosts[0]?.executable, join(adobe, 'Adobe After Effects 2026', 'Support Files', 'AfterFX.exe'));
    assert.deepEqual(installedEngineHosts(adobe, 'linux'), []);
    assert.deepEqual(installedEngineHosts(join(adobe, 'missing'), 'win32'), []);
  } finally { rmSync(adobe, { recursive: true, force: true }); }
});

test('Windows searches Program Files\\Adobe unless the test override names a folder', () => {
  assert.equal(engineApplications({ ProgramW6432: 'D:\\Programs' }, 'win32').replaceAll('/', '\\'), 'D:\\Programs\\Adobe');
  assert.equal(engineApplications({}, 'win32').replaceAll('/', '\\'), 'C:\\Program Files\\Adobe');
  assert.equal(engineApplications({ EXTYNT_ENGINE_APPLICATIONS: '/tmp/empty' }, 'win32'), '/tmp/empty');
});

test('Windows listing: only this version\'s AfterFX.exe started with the engine flag is an engine; the user\'s own is the user\'s', () => {
  const killed: number[] = [];
  assert.equal(reapLeftoverEngines([winHost], () => winListing, pid => { killed.push(pid); }), 2);
  assert.deepEqual(killed, [1010, 1015], 'quoted or not, any case; never the user\'s AfterFX, another year, another Adobe app or a shell that mentions it');
  assert.equal(userAfterEffectsOpen(winHost, () => winListing), true);
  assert.equal(userAfterEffectsOpen(winHost, () => withoutLine(winListing, '\r\n', '1011 ')), false);
  assert.equal(userAfterEffectsOpen(winHost, () => { throw new Error('no powershell'); }), false);
});

test('Windows listing: After Effects rewrites a started engine\'s command line to "-m"; the pid its discovery file names is still the engine', () => {
  const rewritten = [`6000 "${winExe}" -m`, `1011 "${winExe}"`, `6001 "${winExe}" -m`].join('\r\n');
  const killed: number[] = [];
  const kill = (pid: number): void => { killed.push(pid); };
  assert.equal(reapLeftoverEngines([winHost], () => rewritten, kill), 0, 'no discovery pid: nothing is taken for an engine');
  assert.equal(reapLeftoverEngines([winHost], () => rewritten, kill, 6000), 1);
  assert.deepEqual(killed, [6000], 'never a -m After Effects the discovery file does not name');
  assert.equal(userAfterEffectsOpen(winHost, () => `6000 "${winExe}" -m`, 6000), false, 'the running engine is not the user\'s After Effects');
  assert.equal(userAfterEffectsOpen(winHost, () => `6000 "${winExe}" -m -open x.aep`, 6000), true, 'only the bare rewritten line');
  assert.equal(userAfterEffectsOpen(winHost, () => `6000 "${winExe}" -m`), true, 'without the discovery pid it is counted as the user\'s');
});

test('the engine discovery pid is the live endpoint\'s, and none when the file is missing or stale', () => {
  const live = (pid: number | null): DiscoveryResult => ({ ok: true, endpoint: endpointOf(pid) });
  const stale: DiscoveryResult = { ok: false, code: 'DISCOVERY_STALE', message: 'the engine is gone' };
  assert.equal(engineDiscoveryPid('x', () => live(6000)), 6000);
  assert.equal(engineDiscoveryPid('x', () => live(null)), undefined);
  assert.equal(engineDiscoveryPid('x', () => stale), undefined);
});

test('a crashed Windows engine\'s leftovers are its children from its own After Effects folder only', () => {
  const children = (pid: number): string => (pid === 6000 ? [
    `7001 ${winExe.replace('AfterFX.exe', 'crashpad_handler.exe')}`,
    `7002 ${winRoot.toUpperCase()}\\Support Files\\AdobeCrashReport.exe`,
    '7003 C:\\Windows\\System32\\conhost.exe',
    '7004 C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\crashpad_handler.exe',
    `7005 ${winRoot} Beta\\Support Files\\x.exe`,
  ].join('\r\n') : '');
  assert.deepEqual(engineLeftovers(6000, winHost, children), [7001, 7002]);
  assert.deepEqual(engineLeftovers(6001, winHost, children), []);
  assert.deepEqual(engineLeftovers(6000, winHost, () => { throw new Error('no powershell'); }), []);
});

test('wmic rows become the same pid and command line lines, commas in the command line included', () => {
  const csv = `\r\r\nNode,CommandLine,ProcessId\r\r\nPC,"${winExe}" -m -noui -extynt_engine,1010\r\r\nPC,"${winExe}" -open "a,b.aep",1011\r\r\n`;
  assert.equal(wmicListing(csv), `1010 "${winExe}" -m -noui -extynt_engine\n1011 "${winExe}" -open "a,b.aep"`);
});

class FakeChild extends ChildProcess {
  declare readonly stdin: never;
  declare readonly stdout: never;
  declare readonly stderr: never;
  declare readonly stdio: [never, never, never, undefined, undefined];
  override readonly pid: number;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

const isArguments = (given: readonly string[] | SpawnOptions | undefined): given is readonly string[] => Array.isArray(given);

function spawnReturning(child: FakeChild, calls: SpawnCall[], onSpawn: () => void): typeof spawn {
  return (command: string, second?: readonly string[] | SpawnOptions, third?: SpawnOptions) => {
    const args = isArguments(second) ? second : [];
    calls.push({ command, args, options: (isArguments(second) ? third : second) ?? {} });
    onSpawn();
    return child;
  };
}

function launchedWindows(directory: string, listing: () => string, spawnFake: typeof spawn, killed: number[]): ReturnType<typeof launchEngine> {
  return launchEngine(winHost, join(directory, 'engine.log'), listing, { platform: 'win32', kill: pid => killed.push(pid), isAlive: () => true, spawn: spawnFake });
}

function assertHiddenDetachedLaunch(call: SpawnCall | undefined): void {
  assert.equal(call?.command, winExe);
  assert.deepEqual(call?.args, ['-m', '-noui'], 'a script (-s) would end the instance at once, a bare flag is imported as a file');
  assert.equal(call?.options.windowsHide, true);
  assert.equal(call?.options.detached, true);
  assert.equal(call?.options.env?.EXTYNT_ENGINE, '1', 'the plugin reads engine mode from the environment');
  assert.equal(process.env.EXTYNT_ENGINE, undefined, 'never set in the sidecar\'s own environment');
}

test('Windows launch: a hidden, detached second instance with -m -noui; its pid comes from the listing and it is stopped by pid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-launch-'));
  try {
    const calls: SpawnCall[] = [], killed: number[] = [];
    let started = false;
    const running = `5000 "${winExe}" -m -noui -extynt_engine\n1011 "${winExe}"\n1010 "${winExe}" -m -noui -extynt_engine`;
    const list = (): string => (started ? running : `1010 "${winExe}" -m -noui -extynt_engine`);
    const engine = launchedWindows(directory, list, spawnReturning(new FakeChild(4242), calls, () => { started = true; }), killed);
    assert.equal(calls.length, 1);
    assertHiddenDetachedLaunch(calls[0]);
    assert.equal(engine.pid, 5000, 'the new engine pid, not the one a previous run left behind');
    assert.equal(engine.alive(), true);
    engine.stop();
    assert.deepEqual(killed, [5000]);
    assert.equal(engine.alive(), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Windows launch: a child that ends before it can be listed is a dead engine; one the listing cannot show is known by its own pid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-launch-'));
  try {
    const dead = new FakeChild(77), killed: number[] = [];
    const gone = launchedWindows(directory, () => '', spawnReturning(dead, [], () => undefined), killed);
    assert.equal(gone.alive(), true, 'still starting');
    dead.emit('exit', 1);
    assert.equal(gone.alive(), false);
    assert.equal(gone.pid, undefined);
    const blind = new FakeChild(88);
    const unlisted = launchedWindows(directory, () => { throw new Error('no powershell'); }, spawnReturning(blind, [], () => undefined), killed);
    assert.equal(unlisted.pid, 88);
    unlisted.stop();
    assert.deepEqual(killed, [88]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Windows listing: an After Effects whose command line this sidecar cannot read (started as administrator) is still the user\'s, by its window title', () => {
  const open = (title: string): string => `7000 unreadable:${title}`;
  assert.equal(userAfterEffectsOpen(winHost, () => open('Adobe After Effects 2026 - Untitled Project.aep')), true);
  assert.equal(userAfterEffectsOpen(winHost, () => open('Adobe After Effects 2025 - a.aep')), false, 'another year');
  assert.equal(userAfterEffectsOpen(winHost, () => open('')), true, 'no title yet: it may be any version');
  assert.equal(reapLeftoverEngines([winHost], () => open(''), () => undefined, 7000), 0, 'never taken for an engine');
});
