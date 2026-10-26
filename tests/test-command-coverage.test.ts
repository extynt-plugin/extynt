/** Tests that the default test commands cover every workspace and root suite through the failures-only reporter. */
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { SpawnSyncReturns } from 'node:child_process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GUARD, ROOT, resolveTargets, selectTargets, TEST_TIMEOUT_MS, testArguments } from '../scripts/run-tests.ts';
import { array, decodeOrThrow, object, string } from '../packages/decode/dist/src/index.js';
import type { Decoder } from '../packages/decode/dist/src/index.js';
import { parseJson } from '../apps/sidecar/dist/tests/http-json.js';
import { expandTestPatterns, ROOT_TEST_PATTERNS, WORKSPACE_TEST_PATTERNS } from '../scripts/test-targets.ts';

interface Harness {
  readonly root: string;
  readonly marker: string;
  readonly env: NodeJS.ProcessEnv;
}

const PACKAGE = object({ scripts: object({ test: string(), 'test:root': string() }) });
const TSCONFIG = object({ references: array(object({ path: string() })) });
const readDecoded = <T>(file: string, decoder: Decoder<T>) => decodeOrThrow(decoder, parseJson(readFileSync(join(ROOT, file), 'utf8')));
const scripts = readDecoded('package.json', PACKAGE).scripts;
const NON_WORKSPACE_PROJECTS: ReadonlySet<string> = new Set(['scripts', 'tests', 'plugin', 'tools/native-spike']);
const workspaces = readDecoded('tsconfig.json', TSCONFIG).references.map(entry => entry.path.replace(/^\.\//, '')).filter(path => !NON_WORKSPACE_PROJECTS.has(path));
const FIRST_WORKSPACE = workspaces[0] ?? '';
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixtureTest(name: string, fail = false) {
  return `import test from 'node:test'; import assert from 'node:assert/strict'; import { appendFileSync } from 'node:fs';
appendFileSync(process.env.RUN_MARKER, ${JSON.stringify(name + '\n')});
test(${JSON.stringify(name)}, () => { assert.equal(process.cwd(), process.env.RUN_EXPECTED_ROOT); assert.equal(${!fail}, true, ${JSON.stringify(name + '_FAILURE')}); });\n`;
}
function fixture(t: TestContext): Harness {
  const root = mkdtempSync(join(tmpdir(), 'extynt-test-command-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  for (const name of ['run-tests.ts', 'test-targets.ts', 'test-reporter.ts', 'test-guard.ts', 'prune-stale-build.ts']) copyFileSync(join(ROOT, 'scripts', name), join(root, 'scripts', name));
  put(join(root, 'package.json'), '{"type":"module"}\n');
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  for (const workspace of workspaces) {
    put(join(root, workspace, 'dist/tests/fixture.test.js'), fixtureTest(workspace));
    put(join(root, workspace, 'tests/fixture.test.ts'), '// Maintained source fixture.\n');
  }
  put(join(root, 'tests/root.test.ts'), fixtureTest('ROOT_FIRST') + fixtureTest('ROOT_SECOND').replace(/^import .*\n/, ''));
  put(join(root, 'tests/helper.ts'), 'throw new Error("HELPER_MUST_NOT_RUN");\n');
  put(join(root, 'tests/nested/outside.test.ts'), 'throw new Error("NESTED_MUST_NOT_RUN");\n');
  put(join(root, 'bin/pnpm'), '#!/bin/sh\ncase "$*" in\n  "build"|"--filter @extynt/action-plan build"|"--filter @extynt/llm build") exit 0 ;;\n  *) exit 91 ;;\nesac\n');
  chmodSync(join(root, 'bin/pnpm'), 0o755);
  const marker = join(root, 'executed');
  const env: NodeJS.ProcessEnv = { ...process.env, RUN_MARKER: marker, RUN_EXPECTED_ROOT: root, PATH: join(root, 'bin') + ':' + dirname(process.execPath) + ':' + (process.env.PATH ?? '') };
  delete env.NODE_TEST_CONTEXT; delete env.EXTYNT_TEST_GUARD;
  return { root, marker, env };
}
function runFixture(h: Harness, args: readonly string[], cwd = h.root) {
  return checkedResult(spawnSync(process.execPath, [join(h.root, 'scripts/run-tests.ts'), ...args], { cwd, env: h.env, encoding: 'utf8', timeout: 15000 }));
}
function runDefault(h: Harness, script = scripts.test) {
  return checkedResult(spawnSync('/bin/sh', ['-c', script], { cwd: h.root, env: h.env, encoding: 'utf8', timeout: 15000 }));
}
function checkedResult(result: SpawnSyncReturns<string>) { assert.equal(result.error, undefined, result.error?.message); return result; }
function output(result: SpawnSyncReturns<string>) { return result.stdout + result.stderr; }

test('default commands retain every compiled workspace and include all maintained root suites', () => {
  assert.deepEqual([...WORKSPACE_TEST_PATTERNS].sort(), workspaces.map(path => path + '/dist/tests/*.test.js').sort());
  assert.match(
    scripts.test,
    /^pnpm build && pnpm --filter @extynt\/action-plan build && pnpm --filter @extynt\/llm build && node scripts\/run-tests\.ts --all$/,
  );
  assert.match(scripts['test:root'], /pnpm build .*node scripts\/run-tests\.ts --root$/);
  assert.match(readFileSync(join(ROOT, 'scripts/lib/command-stages.ts'), 'utf8'), /"workspace-tests": pnpmStage\("test"\)/);
  const expected = readdirSync(join(ROOT, 'tests')).filter(name => name.endsWith('.test.ts')).map(name => join(ROOT, 'tests', name)).sort();
  assert.deepEqual(selectTargets(['--root'], ROOT), expected);
  assert.ok(expected.includes(join(ROOT, 'tests/panel-memory.test.ts')));
  assert.deepEqual(testArguments(['target']), ['--no-sparkplug', '--test', `--import=${GUARD}`, `--test-timeout=${TEST_TIMEOUT_MS}`, '--test-reporter=' + join(ROOT, 'scripts/test-reporter.ts'), 'target']);
});

test('default test script executes workspace and root cases with the failures-only reporter', t => {
  const h = fixture(t), result = runDefault(h);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), new RegExp(`tests=${workspaces.length + 2} pass=${workspaces.length + 2} fail=0`));
  assert.doesNotMatch(output(result), /ROOT_FIRST|ROOT_SECOND|HELPER_MUST_NOT_RUN|NESTED_MUST_NOT_RUN/);
  assert.equal(readFileSync(h.marker, 'utf8').trim().split('\n').length, workspaces.length + 2);
});

test('standalone root command rebuilds first and selects only root cases', t => {
  const h = fixture(t), result = runDefault(h, scripts['test:root']);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /tests=2 pass=2 fail=0/);
  assert.deepEqual(readFileSync(h.marker, 'utf8').trim().split('\n'), ['ROOT_FIRST', 'ROOT_SECOND']);
});

test('a root regression failure makes the default command fail and reports the failed case', t => {
  const h = fixture(t); put(join(h.root, 'tests/root.test.ts'), fixtureTest('ROOT_FIRST') + fixtureTest('ROOT_SECOND', true).replace(/^import .*\n/, ''));
  const result = runDefault(h);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /ROOT_SECOND_FAILURE/);
  assert.match(output(result), /fail=1/);
  assert.doesNotMatch(output(result), /✔|\bok ROOT_FIRST\b/);
});

test('a compiled workspace failure still makes the default command fail', t => {
  const h = fixture(t); put(join(h.root, FIRST_WORKSPACE, 'dist/tests/fixture.test.js'), fixtureTest('WORKSPACE', true));
  const result = runDefault(h);
  assert.equal(result.status, 1, output(result));
  assert.match(output(result), /WORKSPACE_FAILURE/);
});

test('a missing root category fails before any selected suite executes', t => {
  const h = fixture(t); rmSync(join(h.root, 'tests/root.test.ts'));
  const result = runFixture(h, ['--all']);
  assert.equal(result.status, 2, output(result));
  assert.match(output(result), /Test pattern matched no file: tests\/\*\.test\.ts/);
  assert.equal(existsSync(h.marker), false);
});

test('a missing compiled category fails even when root suites exist', t => {
  const h = fixture(t); rmSync(join(h.root, FIRST_WORKSPACE, 'dist/tests/fixture.test.js'));
  const result = runFixture(h, ['--all']);
  assert.equal(result.status, 2, output(result));
  assert.match(output(result), /Test pattern matched no file:/);
  assert.equal(existsSync(h.marker), false);
});

test('root selection cannot bypass the existing stale compiled source safeguard', t => {
  const h = fixture(t); rmSync(join(h.root, FIRST_WORKSPACE, 'tests/fixture.test.ts'));
  const result = runFixture(h, ['--all']);
  assert.equal(result.status, 2, output(result));
  assert.match(output(result), /STALE compiled test.*no source/);
  assert.equal(existsSync(h.marker), false);
});

test('package-relative explicit targets still execute at repository root', t => {
  const h = fixture(t), cwd = join(h.root, FIRST_WORKSPACE);
  const result = runFixture(h, ['dist/tests/fixture.test.js'], cwd);
  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /tests=1 pass=1 fail=0/);
  assert.deepEqual(resolveTargets(['dist/tests/fixture.test.js'], cwd), [join(cwd, 'dist/tests/fixture.test.js')]);
});

test('empty patterns, empty targets, missing files and mixed selectors cannot produce a green run', t => {
  assert.throws(() => expandTestPatterns([], ROOT), /No test patterns/);
  assert.deepEqual(expandTestPatterns([...ROOT_TEST_PATTERNS, ...ROOT_TEST_PATTERNS], ROOT), selectTargets(['--root'], ROOT));
  const h = fixture(t);
  for (const args of [[], ['missing.test.ts'], ['--all', 'tests/root.test.ts'], ['tests']]) {
    const result = runFixture(h, args);
    assert.equal(result.status, 2, output(result));
  }
  assert.equal(existsSync(h.marker), false);
});
