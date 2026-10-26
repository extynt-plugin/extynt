// The Windows launcher's restart loop: back-off, reset after a healthy run, the crash-loop cap, the stop marker and exit 0.
import assert from "node:assert/strict";
import test from "node:test";
import { SUPERVISOR_POLICY, superviseSidecar, type SupervisorPorts } from "../src/windows-supervisor.js";

interface Harness {
  readonly ports: SupervisorPorts;
  readonly sleeps: number[];
  readonly logs: string[];
}

function harness(runs: readonly { code: number; ranMs: number }[], stopAfterRuns = Infinity): Harness {
  let clockMs = 0;
  let started = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const ports: SupervisorPorts = {
    runSidecar: async () => {
      const run = runs[Math.min(started, runs.length - 1)] ?? { code: 0, ranMs: 0 };
      started += 1;
      clockMs += run.ranMs;
      return run.code;
    },
    nowMs: () => clockMs,
    sleep: async (durationMs) => { sleeps.push(durationMs); clockMs += durationMs; },
    stopRequested: () => started >= stopAfterRuns,
    log: (line) => logs.push(line),
  };
  return { ports, sleeps, logs };
}

test("a crash restarts after 2, 4, 8 then 16 s, and exit 0 stops the loop", async () => {
  const fast = { code: 1, ranMs: 100 };
  const { ports, sleeps } = harness([fast, fast, fast, fast, fast, { code: 0, ranMs: 10 }]);
  assert.equal(await superviseSidecar(ports), 0);
  assert.deepEqual(sleeps, [2_000, 4_000, 8_000, 16_000, 16_000]);
});

test("a run of a minute resets the back-off and the failure count", async () => {
  const fast = { code: 1, ranMs: 100 };
  const { ports, sleeps } = harness([fast, fast, fast, { code: 1, ranMs: 60_000 }, fast, { code: 0, ranMs: 0 }]);
  assert.equal(await superviseSidecar(ports), 0);
  assert.deepEqual(sleeps, [2_000, 4_000, 8_000, 2_000, 4_000]);
});

test("a crash loop gives up after the cap, logging the reason once and the restarts before it", async () => {
  const { ports, sleeps, logs } = harness([{ code: -1073741502, ranMs: 5 }]);
  assert.equal(await superviseSidecar(ports), 1);
  assert.equal(sleeps.length, SUPERVISOR_POLICY.maxFastFailures);
  assert.equal(logs.filter((line) => line.includes("giving up")).length, 1);
  assert.match(logs.at(-1) ?? "", /giving up/);
  assert.match(logs[0] ?? "", /exited with code -1073741502, restarting in 2 s/);
});

test("failures separated by healthy runs never reach the cap", async () => {
  const runs = Array.from({ length: 20 }, () => ({ code: 1, ranMs: 61_000 }));
  const { ports, sleeps } = harness([...runs, { code: 0, ranMs: 0 }]);
  assert.equal(await superviseSidecar(ports), 0);
  assert.equal(sleeps.length, 20);
  assert.ok(sleeps.every((durationMs) => durationMs === 2_000));
});

test("the stop marker ends the loop instead of restarting, and the sidecar is not started again", async () => {
  const { ports, sleeps, logs } = harness([{ code: 1, ranMs: 10 }], 1);
  assert.equal(await superviseSidecar(ports), 0);
  assert.deepEqual(sleeps, []);
  assert.match(logs.at(-1) ?? "", /task was ended/);
});

test("a stop marker already present means the sidecar is never started", async () => {
  const { ports, logs } = harness([{ code: 1, ranMs: 10 }], 0);
  assert.equal(await superviseSidecar(ports), 0);
  assert.equal(logs.length, 1);
});
