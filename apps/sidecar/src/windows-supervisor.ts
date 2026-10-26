// The restart loop of the Windows sidecar launcher: pure logic over injected ports, so a test drives it without Node or a clock.
// It restarts the sidecar after a crash with a growing back-off, forgets old failures after a healthy run, and gives up on a crash loop.

interface SupervisorPolicy {
  readonly firstDelayMs: number;
  readonly longestDelayMs: number;
  readonly healthyRunMs: number;
  readonly maxFastFailures: number;
}

/** Back-off 2, 4, 8 then 16 s; a run of a minute counts as healthy; the seventh failure in a row ends the loop. */
export const SUPERVISOR_POLICY: SupervisorPolicy = {
  firstDelayMs: 2_000,
  longestDelayMs: 16_000,
  healthyRunMs: 60_000,
  maxFastFailures: 6,
};

/** The effects the loop needs; each is a plain function so a test supplies fakes. */
export interface SupervisorPorts {
  runSidecar(): Promise<number>;
  nowMs(): number;
  sleep(durationMs: number): Promise<void>;
  stopRequested(): boolean;
  log(line: string): void;
}

interface Streak {
  failures: number;
  delayMs: number;
}

function afterExit(streak: Streak, ranMs: number, policy: SupervisorPolicy): Streak {
  const healthy = ranMs >= policy.healthyRunMs;
  return { failures: (healthy ? 0 : streak.failures) + 1, delayMs: healthy ? policy.firstDelayMs : streak.delayMs };
}

/** Runs the sidecar until it exits 0 (returns 0), the stop marker appears (returns 0) or it keeps failing fast (returns 1). */
export async function superviseSidecar(ports: SupervisorPorts, policy: SupervisorPolicy = SUPERVISOR_POLICY): Promise<number> {
  let streak: Streak = { failures: 0, delayMs: policy.firstDelayMs };
  while (!ports.stopRequested()) {
    const startedMs = ports.nowMs();
    const code = await ports.runSidecar();
    if (code === 0) return 0;
    streak = afterExit(streak, ports.nowMs() - startedMs, policy);
    if (streak.failures > policy.maxFastFailures) {
      ports.log(`extynt supervisor: sidecar failed ${streak.failures} times in a row (last exit code ${code}); giving up`);
      return 1;
    }
    if (ports.stopRequested()) break;
    ports.log(`extynt supervisor: sidecar exited with code ${code}, restarting in ${streak.delayMs / 1000} s`);
    await ports.sleep(streak.delayMs);
    streak = { ...streak, delayMs: Math.min(streak.delayMs * 2, policy.longestDelayMs) };
  }
  ports.log("extynt supervisor: the task was ended; not restarting the sidecar");
  return 0;
}
