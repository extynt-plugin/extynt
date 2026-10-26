// Workspace test entry point: `node scripts/run-tests.ts <test-file...>`.
// Every package's `test` script and scripts/check.ts route through here so the
// failures-only reporter is the only test output anyone sees.  Passing tests
// are not printed; see docs/coding-rules.md, "Test output protocol".
// The child always runs from the repository root: the suites read repo-relative
// paths (`apps/panel/main.js`, `packages/llm/src/provider-config.ts`), so a
// package-invoked run must see the same working directory as the gate run.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { pruneStaleBuild } from "./prune-stale-build.ts";
import { expandTestPatterns, LIVE_TEST_PATTERNS, ROOT_TEST_PATTERNS, WORKSPACE_TEST_PATTERNS } from "./test-targets.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(SCRIPTS_DIR, "..");
export const REPORTER = join(SCRIPTS_DIR, "test-reporter.ts");

function missingDirectory(): string {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "extynt-no-evidence-"));
  rmSync(directory, { recursive: true, force: true });
  return directory;
}

const JEV_ENV_FILE = join(homedir(), ".config", "extynt", "jev.env");

/** The variable that carries the developer's TypeSafe key to the live decision tests only, so the ordinary suites keep their fake models. */
export const LIVE_KEY_VARIABLE = "EXTYNT_LIVE_TYPESAFE_API_KEY";

const DECISION_VARIABLES: ReadonlyArray<string> = ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_MODEL", "EXTYNT_DECISION_MODELS"];

/** The mode of a test run: `offline` is the gate and every ordinary suite, `live` is the opt-in run of the Jev decision tests. */
export type TestMode = "offline" | "live";

/** The live variable of a test process: an exported TypeSafe key moves into it, otherwise the key in the developer's jev.env; never printed. */
export function liveKeyEnvironment(base: NodeJS.ProcessEnv, jevEnvFile: string = JEV_ENV_FILE): NodeJS.ProcessEnv {
  const exported = base.TYPESAFE_API_KEY ?? "";
  if (exported !== "") return { [LIVE_KEY_VARIABLE]: exported };
  if (!existsSync(jevEnvFile)) return {};
  const key = parseEnv(readFileSync(jevEnvFile, "utf8")).TYPESAFE_API_KEY ?? "";
  return key === "" ? {} : { [LIVE_KEY_VARIABLE]: key };
}

/**
 * Environment every offline test process runs in, and the one the gate uses.  TMPDIR is the canonical temp path: macOS's
 * `/var/folders/...` sits behind the `/var` symlink, which the native-bridge lease refuses on purpose, so a test sidecar
 * could never store its journal.  EXTYNT_EFFECT_CONTROLS names a file that does not exist, so an inherited probe-output
 * path can never make tests see "probed" effects.  No live key is ever set here, so the live decision tests skip and the gate makes no model calls.
 */
export function testEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const evidence = join(missingDirectory(), "probe-effects-state.json");
  const inherited = Object.fromEntries(Object.entries(base).filter(([name]) => !DECISION_VARIABLES.includes(name) && name !== LIVE_KEY_VARIABLE));
  return { ...inherited, TMPDIR: realpathSync(tmpdir()), EXTYNT_EFFECT_CONTROLS: evidence };
}

/** The environment of `pnpm test:live`: the offline environment plus the developer's TypeSafe key, which only the live suites read. */
export function liveTestEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...testEnvironment(base), ...liveKeyEnvironment(base) };
}

// --no-sparkplug, as the installed sidecar runs: Node 24.21's V8 can crash (SIGSEGV) in a full GC with Sparkplug frames on
// the stack, and the test children inherit the flag.
// A test waiting on an event that never comes fails after this instead of holding the run open forever.
// There is deliberately no --test-force-exit: it ended a file's process before its last results reached the parent, so a
// finished test was neither passed nor failed (2 of 40 mcp-server runs reported 387 or 392 of 399).  The leak it guarded
// against, a listening server that never reached its t.after, is caught by test-guard.ts instead, which fails the file
// by name; the same guard fails a file whose process exits before its tests finish.
export const TEST_TIMEOUT_MS = 60_000;
export const GUARD = join(SCRIPTS_DIR, "test-guard.ts");

export function testArguments(targets: ReadonlyArray<string>, reporter: string = REPORTER): string[] {
  return ["--no-sparkplug", "--test", `--import=${GUARD}`, `--test-timeout=${TEST_TIMEOUT_MS}`, `--test-reporter=${reporter}`, ...targets];
}

// Package scripts pass shell-expanded paths relative to their own directory;
// resolve them before switching the child to the repository root.
export function resolveTargets(targets: ReadonlyArray<string>, from: string): string[] {
  return targets.map((target) => resolve(from, target));
}

export function selectTargets(args: ReadonlyArray<string>, from: string): string[] {
  if (args[0] === "--all" || args[0] === "--root" || args[0] === "--live") {
    if (args.length !== 1) throw new Error("Use --all, --root or --live without additional targets.");
    pruneStaleBuild(ROOT);
    return expandTestPatterns(patternsOf(args[0]), ROOT);
  }
  return resolveTargets(args, from);
}

function patternsOf(selector: string): ReadonlyArray<string> {
  if (selector === "--live") return LIVE_TEST_PATTERNS;
  return selector === "--all" ? [...WORKSPACE_TEST_PATTERNS, ...ROOT_TEST_PATTERNS] : ROOT_TEST_PATTERNS;
}

// A renamed or deleted test source leaves its compiled twin in dist/.  The build and the --all/--root runs prune those
// (prune-stale-build.ts); this stays as the safety net for explicitly named targets, so a stale suite can never
// inflate a green run.
export function staleCompiledTests(targets: ReadonlyArray<string>): string[] {
  return targets.filter((target) => {
    const match = /^(.*)[/\\]dist[/\\]tests[/\\]([^/\\]+)\.test\.js$/.exec(target);
    if (!match) return false;
    return !existsSync(join(match[1] ?? "", "tests", `${match[2] ?? ""}.test.ts`));
  });
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && entry !== "" && import.meta.url === pathToFileURL(entry).href;
}

function validateTargets(targets: ReadonlyArray<string>): void {
  if (!targets.length) throw new Error("usage: node scripts/run-tests.ts <test-file...> | --all | --root | --live");
  const missing = targets.filter((target) => !existsSync(target) || !statSync(target).isFile());
  if (missing.length) throw new Error(`Missing test files: ${missing.join(", ")}`);
  const stale = staleCompiledTests(targets);
  if (stale.length) throw new Error(`STALE compiled test${stale.length > 1 ? "s" : ""} with no source (rebuild from clean): ${stale.map((file) => file.replace(`${ROOT}/`, "")).join(", ")}`);
}

/** A live run prints every suite's accuracy line, which the failures-only reporter would hide when the suite passes, so it uses the spec reporter. */
export function runTests(targets: ReadonlyArray<string>, mode: TestMode = "offline"): number {
  validateTargets(targets);
  const live = mode === "live";
  const environment = live ? liveTestEnvironment(process.env) : testEnvironment(process.env);
  const result = spawnSync(process.execPath, testArguments(targets, live ? "spec" : REPORTER), { cwd: ROOT, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (invokedDirectly()) {
  try {
    const args = process.argv.slice(2);
    process.exitCode = runTests(selectTargets(args, process.cwd()), args[0] === "--live" ? "live" : "offline");
  }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
