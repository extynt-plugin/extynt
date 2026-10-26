// Only a mutation lease is journaled durably: a read lease costs no fsync (F_FULLFSYNC on macOS), and an empty journal
// left by a lost unsynced write reads as no journal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NativeBridgeLease } from '../apps/sidecar/dist/src/native-bridge-lease.js';
import { textOf } from '../apps/sidecar/dist/tests/http-json.js';

const MODULE_URL = new URL('../apps/sidecar/dist/src/native-bridge-lease.js', import.meta.url).href;

function fixture(body: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'extynt-bridge-durability-'));
  try { body(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function fsyncsFor(directory: string, kind: 'read' | 'mutation'): number {
  const code = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
let count = 0; const sync = fs.fsyncSync; fs.fsyncSync = function (...a) { count += 1; return sync(...a); };
syncBuiltinESMExports(); const {NativeBridgeLease} = await import(${JSON.stringify(MODULE_URL)});
const lease = new NativeBridgeLease(${JSON.stringify(directory)}); const {lease: held} = lease.reserve('p', {requestId: 'r', kind: ${JSON.stringify(kind)}});
lease.settle('p', {lease: held, outcome: 'callback-received'}); process.stdout.write(String(count));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return Number(child.stdout);
}

test('a leased read is never fsynced and a leased mutation is fsynced for its file and directory on both reserve and settle', () => {
  fixture((directory: string) => assert.equal(fsyncsFor(directory, 'read'), 0));
  fixture((directory: string) => assert.equal(fsyncsFor(directory, 'mutation'), 4));
});

test('a read lease still reaches the journal file, so another manager sees it and settles it like any other', () => {
  fixture((directory: string) => {
    const first = new NativeBridgeLease(directory), { lease } = first.reserve('p', { requestId: 'r', kind: 'read' });
    const second = new NativeBridgeLease(directory);
    assert.equal(second.activeRequestMatches('r'), true);
    assert.equal(second.settle('p', { lease, outcome: 'callback-received' }).idempotent, false);
    assert.equal(first.settledRequestMatches('p', 'r'), true);
  });
});

test('an empty journal file is no journal: access stays open and the next reservation writes a fresh one', () => {
  fixture((directory: string) => {
    writeFileSync(join(directory, 'native-bridge-lease.json'), '', { mode: 0o600 });
    const bridge = new NativeBridgeLease(directory);
    assert.equal(bridge.accessQuarantine(), null);
    assert.ok(bridge.reserve('p', { requestId: 'r', kind: 'mutation' }).lease.leaseId);
    assert.equal(textOf(new NativeBridgeLease(directory).accessQuarantine(), 'accessKind'), 'mutation');
  });
});
