/** The no-output window a streaming call is judged by, the overall cap for a call that cannot stream, and the caller's abort signal linked into the controller both reasons share. */

export const STALL_TIMEOUT_MS = 90_000;

export const AGENT_STEP_TIMEOUT_FLOOR_MS = 300_000;

/** What aborted a call: no output for the window (`stalled: no output for 90 s`), or, for a call that cannot stream, the overall cap. */
export class ProviderStallError extends Error {
  public constructor(public readonly kind: "stall" | "cap", public readonly milliseconds: number) {
    super(kind === "stall" ? `stalled: no output for ${Math.round(milliseconds / 1000)} s` : `no response within ${Math.round(milliseconds / 1000)} s (this call cannot stream)`);
    this.name = "ProviderStallError";
  }
}

/** Starts one timer and answers the function that cancels it. */
export interface StallTimers {
  start(run: () => void, milliseconds: number): () => void;
}

/** A call is abandoned when `touch` has not been called for the window: a streamed chunk of any kind starts it over. `cap` replaces the window with one overall limit for a request that cannot stream, until `touch` is called again. `fired` is the error the guard aborted with, if it did. */
export interface StallGuard {
  touch(): void;
  cap(milliseconds: number): void;
  readonly fired: ProviderStallError | undefined;
  stop(): void;
}

const realTimers: StallTimers = {
  start: (run, milliseconds) => {
    const handle = setTimeout(run, milliseconds);
    return () => clearTimeout(handle);
  },
};

/** Aborts `controller` when nothing has been streamed for `windowMs`. A request that cannot stream shows no progress until it finishes, so a stall window cannot judge it: it keeps one overall cap, five minutes whatever `requestTimeoutMs` says (one step may write a whole plan as a single tool call). Starts armed, so a call that never produces its first chunk stalls too; the user's own wall-clock and spend limits are the only other bounds. */
export function startStallGuard(controller: AbortController, windowMs: number = STALL_TIMEOUT_MS, timers: StallTimers = realTimers): StallGuard {
  let cancel: (() => void) | undefined;
  let fired: ProviderStallError | undefined;
  let stopped = false;
  const disarm = (): void => {
    cancel?.();
    cancel = undefined;
  };
  const arm = (milliseconds: number, kind: "stall" | "cap"): void => {
    if (stopped || fired) return;
    disarm();
    cancel = timers.start(() => {
      fired = new ProviderStallError(kind, milliseconds);
      controller.abort(fired);
    }, milliseconds);
  };
  arm(windowMs, "stall");
  return {
    touch: () => arm(windowMs, "stall"),
    cap: (milliseconds) => arm(milliseconds, "cap"),
    get fired() { return fired; },
    stop: () => {
      stopped = true;
      disarm();
    },
  };
}

/** Forwards the caller's cancellation into the controller the timeout owns, so both reasons to stop abort the same fetch. Returns the release function: call it in the same `finally` that clears the timeout, or a long-lived caller signal accumulates one listener per step. */
export function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const onAbort = (): void => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}
