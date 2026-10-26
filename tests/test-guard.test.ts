/** Tests the test guard: complete files pass, truncated or leaking files fail by name. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { ROOT, testArguments } from '../scripts/run-tests.ts';

const fixtures = {
  'ok.test.mjs': `import { test } from 'node:test'; test('ok a', () => {}); test('ok b', () => {});`,
  'failing.test.mjs': `import { test } from 'node:test'; test('boom', () => { throw new Error('boom'); });`,
  'leak.test.mjs': `import { test } from 'node:test'; import http from 'node:http'; test('passes', () => {}); http.createServer().listen(0);`,
  'truncated.test.mjs': `import { test } from 'node:test'; test('first', () => {}); test('exits', () => { process.exit(0); }); test('never reported', () => {});`,
  'no-tests.test.mjs': `console.log('no tests');`,
  'fork.test.mjs': `import { test } from 'node:test'; import { fork } from 'node:child_process'; test('child exits early', async () => { await new Promise((done) => fork(new URL('child.mjs', import.meta.url)).on('exit', done)); });`,
  'child.mjs': `process.exit(0);`,
};

function run(t: TestContext, names: readonly string[], extra: Readonly<Record<string, string>> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT; delete env.EXTYNT_TEST_GUARD;
  const dir = mkdtempSync(join(tmpdir(), 'extynt-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(fixtures)) writeFileSync(join(dir, name), source);
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/run-tests.ts'), ...names.map((name: string) => join(dir, name))], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, text: result.stdout + result.stderr, ms: Date.now() - started, dir };
}

test('the runner no longer force-exits files, so no tail of results can be cut off', () => {
  assert.ok(!testArguments(['x']).includes('--test-force-exit'));
});

test('complete files pass with every test counted', t => {
  const result = run(t, ['ok.test.mjs', 'no-tests.test.mjs', 'fork.test.mjs']);
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /tests=4 pass=4 fail=0/);
});

test('a failing test still fails the run', t => {
  const result = run(t, ['ok.test.mjs', 'failing.test.mjs']);
  assert.notEqual(result.status, 0);
  assert.match(result.text, /boom/);
});

test('a file that leaks a listening server fails by name within the grace period instead of hanging', t => {
  const result = run(t, ['ok.test.mjs', 'leak.test.mjs'], { EXTYNT_TEST_LEAK_GRACE_MS: '1000' });
  assert.notEqual(result.status, 0);
  assert.match(result.text, /leak\.test\.mjs/);
  assert.match(result.text, /handle was leaked/);
  assert.ok(result.ms < 20000, `took ${result.ms}ms`);
});

test('a file whose process exits before its tests finish fails by name even with exit code 0', t => {
  const result = run(t, ['ok.test.mjs', 'truncated.test.mjs']);
  assert.notEqual(result.status, 0);
  assert.match(result.text, /truncated\.test\.mjs/);
  assert.match(result.text, /results are incomplete/);
});

test('a file hung outside any test is bounded by the file budget', t => {
  const result = run(t, ['leak.test.mjs'], { EXTYNT_TEST_LEAK_GRACE_MS: '600000', EXTYNT_TEST_FILE_BUDGET_MS: '1000' });
  assert.notEqual(result.status, 0);
  assert.match(result.text, /still running after 1s/);
});
