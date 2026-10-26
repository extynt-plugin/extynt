// Durations the sidecar reports: clamped so a clock that moved backwards or an absurd hop is never shown as a measurement.

/** How long a turn's authoring may be reported as taking; host waits are far shorter. */
export const AUTHORING_MS_CEILING = 3_600_000;

function boundedMs(value: number, ceiling: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? Math.min(ceiling, Math.floor(value)) : undefined;
}

/** The whole milliseconds of an authoring duration, or undefined when it is not a usable reading. */
export function boundedAuthoringMs(value: number): number | undefined {
  return boundedMs(value, AUTHORING_MS_CEILING);
}

/** The milliseconds since `startedAt`, clamped to the ceiling, or undefined when the clock moved backwards. */
export function boundedElapsedMs(startedAt: number, ceiling: number): number | undefined {
  return boundedMs(Date.now() - startedAt, ceiling);
}

/** The seconds left of a wait after `spentMs` have been used, never negative. */
export function remainingWaitSeconds(waitSeconds: number, spentMs: number): number {
  return Math.max(0, waitSeconds - Math.max(0, spentMs) / 1000);
}
