/** Tests that the runtime ships no control evidence and loads none from disk. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as catalogue from '../packages/capability-catalogue/dist/src/index.js';
import { ReadOnlySidecar } from '../apps/sidecar/dist/src/server.js';
import type { HostProfileEntry } from '../packages/capability-catalogue/dist/src/index.js';
import { census, prop } from './catalogue-support.ts';
import { present, probeResult } from './effect-notes-support.ts';

function sources(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (['node_modules', 'dist', 'tests', '.git'].includes(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) sources(path, found); else if (/\.(ts|mjs|js|json)$/.test(name)) found.push(path);
  }
  return found;
}

test('the runtime exposes no loader for shipped control evidence, and no shipped data directory remains', () => {
  assert.equal('loadBundledEffectControlEvidence' in catalogue, false);
  assert.equal(existsSync('packages/capability-catalogue/data'), false);
  assert.equal(existsSync('packages/capability-catalogue/src/ledger'), false);
});

test('no runtime source (apps/*/src, packages/*/src) references the control evidence dump', () => {
  const roots = ['apps/sidecar/src', 'apps/panel/runtime', 'packages/capability-catalogue/src', 'packages/mcp-server/src', 'packages/action-plan/src', 'packages/host-ae/src', 'packages/project-graph/src'];
  for (const root of roots) for (const file of sources(root)) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /effect-controls-ae26|loadBundledEffectControlEvidence|EFFECTS_VENDOR|effects-vendor/, file);
  }
});

test('a sidecar with no probed catalogue builds a host profile with no probed controls; after a probe, a restarted sidecar rebuilds them from the graph alone', async t => {
  const value = census(['ADBE Gaussian Blur 2', 'ADBE Glo2']);
  const directory = mkdtempSync(join(tmpdir(), 'extynt-no-seed-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = new ReadOnlySidecar({ port: 0, token: 'no-seed-token', stateDirectory: directory, quietAgentLog: true });
  t.after(async () => { try { await first.stop(); } catch { } });
  const address = await first.start(), base = `http://${address.host}:${address.port}`;
  const headers = { Authorization: 'Bearer no-seed-token', 'Content-Type': 'application/json', 'X-AE-Panel-Instance': 'p' };
  await fetch(`${base}/v1/pair`, { headers });
  assert.equal((await fetch(`${base}/v1/host-census`, { method: 'POST', headers, body: JSON.stringify(value) })).status, 201);
  const blur = (sidecar: ReadOnlySidecar): HostProfileEntry => present(present(sidecar.hostProfile).entries.find(entry => entry.matchName === 'ADBE Gaussian Blur 2'));
  assert.notEqual(blur(first).probeState, 'probed'); assert.ok(!blur(first).evidence.includes('probed'));
  first.collection.writeCatalogueProbe([{ hostKey: 'After Effects:26.2:macOS', runId: 'run-1', observedAt: 5, hostBuild: '2', version: 'v1', effect: probeResult('ADBE Gaussian Blur 2', [prop('ADBE Gaussian Blur 2-0001', { name: 'Blurriness', defaultValue: 4, hasMin: true, min: 0, hasMax: true, max: 1000 })]) }]);
  await first.stop();
  const second = new ReadOnlySidecar({ port: 0, token: 'no-seed-token', stateDirectory: directory, quietAgentLog: true });
  t.after(() => second.collection.close());
  assert.equal(blur(second).probeState, 'probed'); assert.deepEqual((blur(second).controls ?? []).slice(0, 1).map(control => [control.matchName, control.defaultValue, control.min, control.max]), [['ADBE Gaussian Blur 2-0001', 4, 0, 1000]]);
  assert.notEqual(present(present(second.hostProfile).entries.find(entry => entry.matchName === 'ADBE Glo2')).probeState, 'probed', 'only what was probed here');
  assert.match(blur(second).provenance, /live-probed on AE 26\.2/);
});
