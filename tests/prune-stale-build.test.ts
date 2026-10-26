/**
 * Tests that the build prune removes compiled files whose source is gone and keeps every compiled file that has one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneStaleBuild } from '../scripts/prune-stale-build.ts';

function touch(root: string, file: string) {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), '');
}

test('pruneStaleBuild removes compiled tests and sources with no TypeScript file and keeps the rest', t => {
  const root = mkdtempSync(join(tmpdir(), 'extynt-prune-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['packages/a/tsconfig.json', 'packages/a/tests/kept.test.ts', 'packages/a/src/kept.ts',
    'packages/a/dist/tests/kept.test.js', 'packages/a/dist/tests/kept.test.d.ts', 'packages/a/dist/src/kept.js',
    'packages/a/dist/tests/gone.test.js', 'packages/a/dist/tests/gone.test.js.map', 'packages/a/dist/src/gone.d.ts']) touch(root, file);
  const removed = pruneStaleBuild(root).sort();
  assert.deepEqual(removed, ['packages/a/dist/src/gone.d.ts', 'packages/a/dist/tests/gone.test.js', 'packages/a/dist/tests/gone.test.js.map']);
  assert.ok(existsSync(join(root, 'packages/a/dist/tests/kept.test.js')));
  assert.ok(existsSync(join(root, 'packages/a/dist/src/kept.js')));
});
