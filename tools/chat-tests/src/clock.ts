/**
 * Wall-clock readings for the harness's own timings, guarded the way the panel guards a host hop.
 */

const MAX_ELAPSED_MS = 600_000;

/** Elapsed milliseconds since `startedAt`; a backwards or non-finite reading is no measurement at all. */
export function boundedElapsedMs(startedAt: number): number | undefined {
  const elapsed = Date.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(Math.floor(elapsed), MAX_ELAPSED_MS) : undefined;
}

/** Elapsed seconds as the messages spell it; a missing reading says so rather than printing a negative. */
export function elapsedSecondsText(durationMs: number | undefined, digits: number): string {
  return durationMs === undefined ? "an unknown duration" : `${(durationMs / 1000).toFixed(digits)}s`;
}
