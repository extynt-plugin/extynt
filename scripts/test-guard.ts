// Preloaded (`--import`) into every test file's process by scripts/run-tests.ts.  It replaces `--test-force-exit`.
// That flag ended a file's process before its last results reached the parent, so a finished test was neither passed
// nor failed (mcp-server: 387-392 of 399 tests reported in 2 of 40 runs).  Without it a file ends when its event loop
// drains, so every result is delivered, and this guard turns the two ways a file can still go wrong into a loud failure
// that names the file:
//  - LEAK: the tests finished but a handle (a listening server whose t.after never ran) keeps the process alive.
//  - TRUNCATED: the process exited, even with code 0 (a stray process.exit), before the root tests finished.
// Both exit nonzero, which node reports as a failed file.  A third bound covers a file hung outside any test.

import { isMainThread } from "node:worker_threads";
import { after } from "node:test";

export const LEAK_GRACE_MS = Number(process.env.EXTYNT_TEST_LEAK_GRACE_MS) || 10_000;
export const FILE_BUDGET_MS = Number(process.env.EXTYNT_TEST_FILE_BUDGET_MS) || 15 * 60_000;

const OWNER = "EXTYNT_TEST_GUARD";
const active = isMainThread && Boolean(process.env.NODE_TEST_CONTEXT) && !process.env[OWNER];

function fail(message: string): never {
  process.stderr.write(`\nTEST FILE ${process.argv[1] ?? "(unknown)"}: ${message}\n`);
  process.exit(1);
}

function holders(): string {
  const counts = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo()) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${kind}x${count}`).join(", ");
}

function bound(ms: number, message: string): void {
  setTimeout(() => fail(`${message}; active handles: ${holders()}`), ms).unref();
}

if (active) {
  process.env[OWNER] = String(process.pid);
  let finished = false;
  bound(FILE_BUDGET_MS, `still running after ${FILE_BUDGET_MS / 1000}s (hung outside any test); its handles were never released`);
  after(() => {
    finished = true;
    bound(LEAK_GRACE_MS, `tests finished but the process is still alive ${LEAK_GRACE_MS / 1000}s later: a handle was leaked (a listening server or timer whose cleanup never ran)`);
  });
  process.on("exit", (code) => {
    if (finished) return;
    process.stderr.write(`\nTEST FILE ${process.argv[1] ?? "(unknown)"}: process exited (code ${code}) before its tests finished; the results are incomplete\n`);
    process.exitCode = 1;
  });
}
